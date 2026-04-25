export type HcmErrorClassification = 'TRANSIENT' | 'TERMINAL';

export type HcmDebitSuccess = {
  ok: true;
  remainingDays: number;
};

export type HcmDebitFailure = {
  ok: false;
  classification: HcmErrorClassification;
  code: string;
  message: string;
};

export type HcmDebitResult = HcmDebitSuccess | HcmDebitFailure;

export type HcmBalanceResult =
  | {
      ok: true;
      availableDays: number;
    }
  | HcmDebitFailure;
