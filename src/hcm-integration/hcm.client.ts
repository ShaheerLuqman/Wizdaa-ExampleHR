import { Injectable } from '@nestjs/common';
import { HcmBalanceResult, HcmDebitResult } from './hcm.types';

export type HcmSimulationMode =
  | 'success'
  | 'insufficient'
  | 'invalid'
  | 'transient_error';

@Injectable()
export class HcmClient {
  private readonly baseUrl = process.env.HCM_BASE_URL ?? 'http://localhost:4001';

  async debitTimeOff(input: {
    tenantId: string;
    employeeId: string;
    locationId: string;
    daysRequested: number;
    idempotencyKey: string;
    correlationId?: string;
    hcmMode?: HcmSimulationMode;
  }): Promise<HcmDebitResult> {
    const url = this.withMode(
      `${this.baseUrl}/v1/hcm/time-off/debit`,
      input.hcmMode,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': input.idempotencyKey,
          ...(input.hcmMode ? { 'x-hcm-mode': input.hcmMode } : {}),
          ...(input.correlationId
            ? { 'x-correlation-id': input.correlationId }
            : {}),
        },
        body: JSON.stringify(input),
      });

      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (response.ok) {
        return {
          ok: true,
          remainingDays: Number(body.remainingDays),
        };
      }

      return {
        ok: false,
        classification: response.status >= 500 ? 'TRANSIENT' : 'TERMINAL',
        code: String(body.code ?? 'HCM_ERROR'),
        message: String(body.message ?? 'HCM rejected the debit request'),
      };
    } catch (error) {
      return {
        ok: false,
        classification: 'TRANSIENT',
        code: 'HCM_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'HCM unavailable',
      };
    }
  }

  async getBalance(input: {
    tenantId: string;
    employeeId: string;
    locationId: string;
    correlationId?: string;
    hcmMode?: HcmSimulationMode;
  }): Promise<HcmBalanceResult> {
    const params = new URLSearchParams({
      tenantId: input.tenantId,
      employeeId: input.employeeId,
      locationId: input.locationId,
    });
    if (input.hcmMode) {
      params.set('mode', input.hcmMode);
    }

    try {
      const response = await fetch(`${this.baseUrl}/v1/hcm/balances?${params}`, {
        headers: {
          ...(input.correlationId
            ? { 'x-correlation-id': input.correlationId }
            : {}),
          ...(input.hcmMode ? { 'x-hcm-mode': input.hcmMode } : {}),
        },
      });
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;

      if (response.ok) {
        return {
          ok: true,
          availableDays: Number(body.availableDays),
        };
      }

      return {
        ok: false,
        classification: response.status >= 500 ? 'TRANSIENT' : 'TERMINAL',
        code: String(body.code ?? 'HCM_ERROR'),
        message: String(body.message ?? 'HCM rejected the balance lookup'),
      };
    } catch (error) {
      return {
        ok: false,
        classification: 'TRANSIENT',
        code: 'HCM_UNAVAILABLE',
        message: error instanceof Error ? error.message : 'HCM unavailable',
      };
    }
  }

  private withMode(url: string, mode?: HcmSimulationMode): string {
    if (!mode) {
      return url;
    }

    return `${url}?mode=${encodeURIComponent(mode)}`;
  }
}
