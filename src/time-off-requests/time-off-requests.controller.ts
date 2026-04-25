import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { Tenant } from '../auth/tenant.decorator';
import { TenantContext } from '../auth/tenant-context';
import { TenantGuard } from '../auth/tenant.guard';
import { HcmSimulationMode } from '../hcm-integration/hcm.client';
import { CreateTimeOffRequestDto } from './dto/create-time-off-request.dto';
import { DecisionDto } from './dto/decision.dto';
import { TimeOffRequestsService } from './time-off-requests.service';

@Controller('v1/time-off-requests')
@UseGuards(TenantGuard)
export class TimeOffRequestsController {
  constructor(private readonly requestsService: TimeOffRequestsService) {}

  @Post()
  async create(
    @Tenant() tenant: TenantContext,
    @Body() dto: CreateTimeOffRequestDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.requestsService.createPendingRequest({
      tenantId: tenant.tenantId,
      dto,
    });
    response.status(result.statusCode);
    return result.body;
  }

  @Get(':requestId')
  getRequest(
    @Tenant() tenant: TenantContext,
    @Param('requestId') requestId: string,
  ) {
    return this.requestsService.getRequest({
      tenantId: tenant.tenantId,
      requestId,
    });
  }

  @Post(':requestId/approve')
  approve(
    @Tenant() tenant: TenantContext,
    @Param('requestId') requestId: string,
    @Req() request: Request & { correlationId?: string },
    @Query('mode') mode?: HcmSimulationMode,
  ) {
    return this.requestsService.approve({
      tenantId: tenant.tenantId,
      requestId,
      correlationId: request.correlationId,
      hcmMode: mode ?? (request.header('x-hcm-mode') as HcmSimulationMode),
    });
  }

  @Post(':requestId/reject')
  reject(
    @Tenant() tenant: TenantContext,
    @Param('requestId') requestId: string,
    @Body() dto: DecisionDto,
  ) {
    return this.requestsService.reject({
      tenantId: tenant.tenantId,
      requestId,
      reason: dto.reason,
    });
  }
}
