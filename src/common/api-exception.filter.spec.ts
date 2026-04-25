import { ArgumentsHost, BadRequestException, HttpException } from '@nestjs/common';
import { ApiExceptionFilter } from './api-exception.filter';

describe('ApiExceptionFilter', () => {
  const filter = new ApiExceptionFilter();

  function makeHost(correlationId?: string): {
    host: ArgumentsHost;
    status: jest.Mock;
    json: jest.Mock;
  } {
    const json = jest.fn();
    const status = jest.fn(() => ({ json }));
    const host = {
      switchToHttp: () => ({
        getRequest: () => ({ correlationId }),
        getResponse: () => ({ status }),
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json };
  }

  it('formats HttpException with object body', () => {
    const { host, status, json } = makeHost('corr-1');
    const exception = new BadRequestException({
      code: 'VALIDATION_ERROR',
      message: ['field is required', 'field must be string'],
    });

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'field is required; field must be string',
        correlationId: 'corr-1',
      },
    });
  });

  it('formats HttpException with string body', () => {
    const { host, status, json } = makeHost();
    const exception = new HttpException('conflict', 409);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(409);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'VERSION_CONFLICT',
        message: 'conflict',
        correlationId: '',
      },
    });
  });

  it('formats unknown exception as internal error', () => {
    const { host, status, json } = makeHost('corr-2');
    filter.catch(new Error('boom'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Unexpected error',
        correlationId: 'corr-2',
      },
    });
  });
});
