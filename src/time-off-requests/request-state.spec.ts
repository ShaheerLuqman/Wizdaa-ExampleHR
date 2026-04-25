import { HttpStatus } from '@nestjs/common';
import { ApiErrorException } from '../common/api-error.exception';
import { assertTransitionAllowed, RequestStatus } from './request-state';

describe('request state transitions', () => {
  it('allows pending requests to be approved, rejected, or marked failed sync', () => {
    expect(() =>
      assertTransitionAllowed(RequestStatus.Pending, RequestStatus.Approved),
    ).not.toThrow();
    expect(() =>
      assertTransitionAllowed(RequestStatus.Pending, RequestStatus.Rejected),
    ).not.toThrow();
    expect(() =>
      assertTransitionAllowed(RequestStatus.Pending, RequestStatus.FailedSync),
    ).not.toThrow();
  });

  it('allows failed sync requests to approve after retry success', () => {
    expect(() =>
      assertTransitionAllowed(RequestStatus.FailedSync, RequestStatus.Approved),
    ).not.toThrow();
  });

  it('rejects unsupported transitions', () => {
    expect(() =>
      assertTransitionAllowed(RequestStatus.Approved, RequestStatus.Rejected),
    ).toThrow(ApiErrorException);

    try {
      assertTransitionAllowed(RequestStatus.Approved, RequestStatus.Rejected);
    } catch (error) {
      expect((error as ApiErrorException).getStatus()).toBe(
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
  });
});
