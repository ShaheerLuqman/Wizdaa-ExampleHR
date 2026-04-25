import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';

type ErrorBody = {
  code?: string;
  message?: string | string[];
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { correlationId?: string }>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException
        ? (exception.getResponse() as ErrorBody | string)
        : undefined;

    const normalized = this.normalizeBody(body, status);

    response.status(status).json({
      error: {
        code: normalized.code,
        message: normalized.message,
        correlationId: request.correlationId ?? '',
      },
    });
  }

  private normalizeBody(
    body: ErrorBody | string | undefined,
    status: number,
  ): { code: string; message: string } {
    if (typeof body === 'object' && body !== null) {
      const message = Array.isArray(body.message)
        ? body.message.join('; ')
        : body.message;

      return {
        code: body.code ?? this.defaultCode(status),
        message: message ?? 'Unexpected error',
      };
    }

    return {
      code: this.defaultCode(status),
      message: typeof body === 'string' ? body : 'Unexpected error',
    };
  }

  private defaultCode(status: number): string {
    if (status === HttpStatus.BAD_REQUEST) {
      return 'VALIDATION_ERROR';
    }

    if (status === HttpStatus.CONFLICT) {
      return 'VERSION_CONFLICT';
    }

    return status >= 500 ? 'INTERNAL_ERROR' : 'VALIDATION_ERROR';
  }
}
