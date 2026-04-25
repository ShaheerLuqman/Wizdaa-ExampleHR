import { Logger } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  const controller = new HealthController();
  const loggerSpy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

  afterEach(() => {
    jest.clearAllMocks();
  });

  afterAll(() => {
    loggerSpy.mockRestore();
  });

  it('returns ok for live endpoint and logs call', () => {
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(loggerSpy).toHaveBeenCalledWith('GET /v1/health/live');
  });

  it('returns ok for ready endpoint and logs call', () => {
    expect(controller.ready()).toEqual({ status: 'ok' });
    expect(loggerSpy).toHaveBeenCalledWith('GET /v1/health/ready');
  });
});
