import { Controller, Get, Logger } from '@nestjs/common';

@Controller('v1/health')
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  @Get('live')
  live() {
    this.logger.log('GET /v1/health/live');
    return { status: 'ok' };
  }

  @Get('ready')
  ready() {
    this.logger.log('GET /v1/health/ready');
    return { status: 'ok' };
  }
}
