import { NextFunction, Request, Response } from 'express';
import { RequestLoggingMiddleware } from './request-logging.middleware';

describe('RequestLoggingMiddleware', () => {
  const middleware = new RequestLoggingMiddleware();
  const next = jest.fn() as NextFunction;
  const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    logSpy.mockRestore();
  });

  it('calls next and logs on response finish', () => {
    const listeners: Record<string, () => void> = {};
    const req = {
      method: 'GET',
      originalUrl: '/v1/health/ready',
    } as Request;
    const res = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        listeners[event] = callback;
      }),
    } as unknown as Response;

    middleware.use(req, res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.on).toHaveBeenCalledWith('finish', expect.any(Function));

    listeners.finish();
    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining('[Nest] [HTTP] GET /v1/health/ready 200'),
    );
  });
});
