import { CallHandler, ExecutionContext, Logger } from '@nestjs/common';
import { of, throwError } from 'rxjs';
import { RequestLoggingInterceptor } from './request-logging.interceptor';

describe('RequestLoggingInterceptor', () => {
  const interceptor = new RequestLoggingInterceptor();
  const loggerSpy = jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
  const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    loggerSpy.mockRestore();
    consoleSpy.mockRestore();
  });

  function createContext(statusCode?: number): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({
          method: 'GET',
          originalUrl: '/v1/health/ready',
          headers: { 'x-correlation-id': 'corr-123' },
        }),
        getResponse: () => ({ statusCode }),
      }),
    } as ExecutionContext;
  }

  it('logs request and success response', (done) => {
    const context = createContext(200);
    const next: CallHandler = { handle: () => of({ status: 'ok' }) };

    interceptor.intercept(context, next).subscribe({
      next: () => {
        expect(Logger.log).toHaveBeenCalledWith(
          expect.stringContaining('[BE] --> GET /v1/health/ready correlationId=corr-123'),
          'RequestLogger',
        );
        expect(Logger.log).toHaveBeenCalledWith(
          expect.stringContaining('[BE] <-- GET /v1/health/ready status=200'),
          'RequestLogger',
        );
        done();
      },
      error: done,
    });
  });

  it('logs request and error response path', (done) => {
    const context = createContext(500);
    const next: CallHandler = {
      handle: () => throwError(() => new Error('boom')),
    };

    interceptor.intercept(context, next).subscribe({
      next: () => done(new Error('Expected stream to fail')),
      error: () => {
        expect(Logger.log).toHaveBeenCalledWith(
          expect.stringContaining('[BE] --> GET /v1/health/ready correlationId=corr-123'),
          'RequestLogger',
        );
        expect(Logger.log).toHaveBeenCalledWith(
          expect.stringContaining('[BE] <-- GET /v1/health/ready status=500'),
          'RequestLogger',
        );
        done();
      },
    });
  });
});
