import { HttpStatus } from '@nestjs/common';
import { ApiErrorException } from '../common/api-error.exception';

export const RequestStatus = {
  Pending: 'PENDING',
  Approved: 'APPROVED',
  Rejected: 'REJECTED',
  FailedSync: 'FAILED_SYNC',
  Cancelled: 'CANCELLED',
} as const;

export type RequestStatusValue =
  (typeof RequestStatus)[keyof typeof RequestStatus];

const allowedTransitions: Record<string, string[]> = {
  [RequestStatus.Pending]: [
    RequestStatus.Approved,
    RequestStatus.Rejected,
    RequestStatus.FailedSync,
  ],
  [RequestStatus.FailedSync]: [RequestStatus.Approved],
};

export function assertTransitionAllowed(
  current: string,
  next: RequestStatusValue,
): void {
  if (!allowedTransitions[current]?.includes(next)) {
    throw new ApiErrorException(
      'INVALID_STATE_TRANSITION',
      `Cannot transition request from ${current} to ${next}`,
      HttpStatus.UNPROCESSABLE_ENTITY,
    );
  }
}
