import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { ApiErrorException } from '../common/api-error.exception';
import { TenantContext } from './tenant-context';

@Injectable()
export class TenantGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<
      Request & { tenant?: TenantContext }
    >();
    const authorization = request.header('authorization');

    if (!authorization?.startsWith('Bearer ')) {
      throw new ApiErrorException(
        'UNAUTHENTICATED',
        'Missing bearer token',
        HttpStatus.BAD_REQUEST,
      );
    }

    const payload = this.decodePayload(authorization.slice('Bearer '.length));
    if (!payload.tenantId || !payload.sub) {
      throw new ApiErrorException(
        'UNAUTHENTICATED',
        'JWT must include tenantId and sub claims',
        HttpStatus.BAD_REQUEST,
      );
    }

    request.tenant = {
      tenantId: String(payload.tenantId),
      subject: String(payload.sub),
    };

    return true;
  }

  private decodePayload(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length < 2) {
      throw new ApiErrorException(
        'UNAUTHENTICATED',
        'Invalid bearer token',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const payload = Buffer.from(parts[1], 'base64url').toString('utf8');
      return JSON.parse(payload) as Record<string, unknown>;
    } catch {
      throw new ApiErrorException(
        'UNAUTHENTICATED',
        'Invalid bearer token payload',
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
