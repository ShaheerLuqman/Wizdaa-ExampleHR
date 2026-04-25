import { HttpException, HttpStatus } from '@nestjs/common';

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHENTICATED'
  | 'INSUFFICIENT_BALANCE'
  | 'INVALID_DIMENSION'
  | 'INVALID_STATE_TRANSITION'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT'
  | 'HCM_TRANSIENT_FAILURE'
  | 'HCM_TERMINAL_FAILURE'
  | 'NOT_FOUND'
  | 'INTERNAL_ERROR';

export class ApiErrorException extends HttpException {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
    status: HttpStatus,
  ) {
    super({ code, message }, status);
  }
}
