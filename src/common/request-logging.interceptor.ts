import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, tap } from 'rxjs';

@Injectable()
export class RequestLoggingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{
      method?: string;
      originalUrl?: string;
      headers?: Record<string, string>;
    }>();

    const method = request?.method ?? 'UNKNOWN';
    const url = request?.originalUrl ?? 'UNKNOWN_URL';
    const correlationId = request?.headers?.['x-correlation-id'] ?? 'n/a';
    const startedAt = Date.now();

    Logger.log(
      `[BE] --> ${method} ${url} correlationId=${correlationId}`,
      'RequestLogger',
    );
    console.log(
      `[RequestLogger] [BE] --> ${method} ${url} correlationId=${correlationId}`,
    );

    return next.handle().pipe(
      tap({
        next: () => {
          const response = http.getResponse<{ statusCode?: number }>();
          const durationMs = Date.now() - startedAt;
          Logger.log(
            `[BE] <-- ${method} ${url} status=${response?.statusCode ?? 200} durationMs=${durationMs} correlationId=${correlationId}`,
            'RequestLogger',
          );
          console.log(
            `[RequestLogger] [BE] <-- ${method} ${url} status=${response?.statusCode ?? 200} durationMs=${durationMs} correlationId=${correlationId}`,
          );
        },
        error: () => {
          const response = http.getResponse<{ statusCode?: number }>();
          const durationMs = Date.now() - startedAt;
          Logger.log(
            `[BE] <-- ${method} ${url} status=${response?.statusCode ?? 500} durationMs=${durationMs} correlationId=${correlationId}`,
            'RequestLogger',
          );
          console.log(
            `[RequestLogger] [BE] <-- ${method} ${url} status=${response?.statusCode ?? 500} durationMs=${durationMs} correlationId=${correlationId}`,
          );
        },
      }),
    );
  }
}
