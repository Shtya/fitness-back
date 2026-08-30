import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Response } from 'express';

@Catch(QueryFailedError)
export class QueryFailedErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger(QueryFailedErrorFilter.name);

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const code = exception.driverError?.code || exception.code;
    const driverMessage = String(exception.driverError?.message || exception.message || '');

    if (code === '23503') {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "This record cannot be deleted or modified because it is referenced by other data.",
        error: exception.driverError?.error || 'Foreign Key Constraint Violation',
        details: exception.driverError?.detail || driverMessage,
      });
      return;
    }

    if (code === '42P01') {
      this.logger.error(driverMessage);
      const missing = driverMessage.match(/relation "([^"]+)" does not exist/i)?.[1]
        || driverMessage.match(/FROM-clause entry for table "([^"]+)"/i)?.[1];
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: missing
          ? `Database is missing "${missing}". Restart the backend so schema updates can apply, then refresh.`
          : driverMessage || "The referenced table does not exist in the database.",
        error: 'Missing table',
        details: driverMessage,
      });
      return;
    }

    if (code === '23505') {
      response.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message: 'This reaction was already saved. Refresh and try again if it does not appear.',
        error: 'Unique Constraint Violation',
        details: exception.driverError?.detail || driverMessage,
      });
      return;
    }

    this.logger.error(driverMessage);
    response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "An unexpected database error has occurred.",
      error: 'Database Error',
      details: driverMessage,
    });
  }
}
