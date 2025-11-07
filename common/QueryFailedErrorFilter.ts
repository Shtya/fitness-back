import { ExceptionFilter, Catch, ArgumentsHost, HttpStatus } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { Response } from 'express';

@Catch(QueryFailedError)
export class QueryFailedErrorFilter implements ExceptionFilter {

  catch(exception: any, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    // Foreign key constraint violation (e.g., trying to delete a record that is still referenced)
    if (exception.driverError?.code === '23503') {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "This record cannot be deleted or modified because it is referenced by other data.",
        error: exception.driverError?.error || 'Foreign Key Constraint Violation',
        details: exception.driverError?.detail,
      });
    } 
    // Missing table error
    else if (exception.code === '42P01') {
      response.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: "The referenced table does not exist in the database.",
        error: 'Missing FROM Clause Entry Error',
        details: exception.driverError?.detail,
      });
    }
    // General database error
    else {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: "An unexpected database error has occurred.",
        error: 'Database Error',
        details: exception?.message,
      });
    }
  }
}
