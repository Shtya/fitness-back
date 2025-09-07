import { Injectable, ValidationPipe, ValidationError, BadRequestException, Logger } from '@nestjs/common';
import { I18nService } from 'nestjs-i18n';

@Injectable()
export class LoggingValidationPipe extends ValidationPipe {
  constructor(private readonly i18n: I18nService) {
    super({
      transform: true,
      exceptionFactory: async (errors: ValidationError[]) => {

		const translatedErrors = await this.translateValidationErrors(errors);

        throw new BadRequestException({
          statusCode: 400,
          message: 'Validation failed',
          errors: translatedErrors,
        });
      },
    });
  }


  
private async translateValidationErrors(errors: ValidationError[]): Promise<{ field: string; messages: string[] }[]> {
    const translatedErrors = [];

    for (const error of errors) {
      // Check if the error is related to a nested property
      if (error.children && error.children.length > 0) {
        // Recursively process the children (nested validation errors)
        const nestedErrors = await this.translateValidationErrors(error.children);

        // Add each nested error to the translated errors array
        nestedErrors.forEach(nestedError => {
          translatedErrors.push({
            field: `name.${nestedError.field}`, // Full path to the nested field
            messages: nestedError.messages.length === 1 ? nestedError.messages[0] : nestedError.messages, // Return as string if only one message
          });
        });
      } else {
        // Translate the constraints for this field
        const constraints = error.constraints || {};

        // Translate each constraint message
        const translatedMessages = await Promise.all(
          Object.values(constraints).map(async (message) => {
            return await this.i18n.translate(message); // Translating using I18n service
          }),
        );

        translatedErrors.push({
          field: error.property, // Field name
          messages: translatedMessages.length === 1 ? translatedMessages[0] : translatedMessages, // Return as string if only one message
        });
      }
    }

    return translatedErrors;
  }

}