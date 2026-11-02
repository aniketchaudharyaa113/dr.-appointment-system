import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiErrorResponse } from '@medibook/shared';
import { logger } from '../logger/pino-logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    const requestId =
      (request.headers['x-request-id'] as string) ||
      (request as any).id ||
      'unknown';

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let error: string | undefined;
    let details: unknown;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
      } else if (typeof res === 'object' && res !== null) {
        const resObj = res as Record<string, any>;
        message = resObj.message || message;
        error = resObj.error;
        details = resObj.details || resObj;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
      error = exception.name;
      logger.error(
        { err: exception, requestId, url: request.url },
        'Unhandled server error',
      );
    }

    const errorPayload: ApiErrorResponse = {
      statusCode,
      message,
      error,
      requestId,
      timestamp: new Date().toISOString(),
      details,
    };

    response.status(statusCode).send(errorPayload);
  }
}
