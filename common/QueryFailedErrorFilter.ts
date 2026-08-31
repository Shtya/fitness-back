import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Response } from 'express';

/**
 * Postgres driver text names tables, constraints and sometimes the offending
 * values. That is useful locally and is reconnaissance material in production,
 * so `details` is only attached outside production. The full driver message is
 * always logged server-side, so nothing is lost for debugging.
 */
@Catch(QueryFailedError)
export class QueryFailedErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(QueryFailedErrorFilter.name);

  private get exposeDriverDetails() {
    return process.env.NODE_ENV !== 'production';
  }

  private withDetails(body: Record<string, unknown>, details?: string | null) {
    if (!this.exposeDriverDetails || !details) return body;
    return { ...body, details };
  }

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const code = exception.driverError?.code || exception.code;
    const driverMessage = String(exception.driverError?.message || exception.message || '');

    if (code === '23503') {
      this.logger.warn(driverMessage);
      response.status(HttpStatus.BAD_REQUEST).json(
        this.withDetails(
          {
            statusCode: HttpStatus.BAD_REQUEST,
            message:
              'This record cannot be deleted or modified because it is referenced by other data.',
            error: exception.driverError?.error || 'Foreign Key Constraint Violation',
          },
          exception.driverError?.detail || driverMessage,
        ),
      );
      return;
    }

    if (code === '42P01') {
      this.logger.error(driverMessage);
      const missing =
        driverMessage.match(/relation "([^"]+)" does not exist/i)?.[1] ||
        driverMessage.match(/FROM-clause entry for table "([^"]+)"/i)?.[1];
      // The table name is a schema hint, so it stays behind the same gate.
      const message =
        missing && this.exposeDriverDetails
          ? `Database is missing "${missing}". Restart the backend so schema updates can apply, then refresh.`
          : 'The database schema is out of date. Restart the backend, then refresh.';
      response.status(HttpStatus.BAD_REQUEST).json(
        this.withDetails(
          { statusCode: HttpStatus.BAD_REQUEST, message, error: 'Missing table' },
          driverMessage,
        ),
      );
      return;
    }

    if (code === '23505') {
      this.logger.warn(driverMessage);
      response.status(HttpStatus.CONFLICT).json(
        this.withDetails(
          {
            statusCode: HttpStatus.CONFLICT,
            message:
              'This reaction was already saved. Refresh and try again if it does not appear.',
            error: 'Unique Constraint Violation',
          },
          exception.driverError?.detail || driverMessage,
        ),
      );
      return;
    }

    this.logger.error(driverMessage);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json(
      this.withDetails(
        {
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'An unexpected database error has occurred.',
          error: 'Database Error',
        },
        driverMessage,
      ),
    );
  }
}
