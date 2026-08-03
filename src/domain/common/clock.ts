import type { IsoDate, IsoDateTime } from './types';

/** Injected time source so domain/application logic stays deterministic in tests. */
export interface IClock {
  now(): Date;
  nowIso(): IsoDateTime;
  today(): IsoDate;
}
