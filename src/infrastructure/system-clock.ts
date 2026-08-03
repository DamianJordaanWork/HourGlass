import type { IClock } from '@domain/common/clock';
import type { IsoDate, IsoDateTime } from '@domain/common/types';

export class SystemClock implements IClock {
  now(): Date {
    return new Date();
  }
  nowIso(): IsoDateTime {
    return new Date().toISOString();
  }
  today(): IsoDate {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
