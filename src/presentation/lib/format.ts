import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import type { IsoDate } from '@domain/common/types';

/** "1h 30m" / "0m" for day and entry totals. */
export function formatHours(hours: number): string {
  const totalMin = Math.round(hours * 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, '0')}m`;
}

/** "1:24:07" ticking clock for a running timer. */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

export function formatTimeRange(startIso: string, endIso?: string): string {
  const t = (iso: string) => format(parseISO(iso), 'HH:mm');
  return endIso ? `${t(startIso)}–${t(endIso)}` : `${t(startIso)}–…`;
}

export const toIsoDate = (d: Date): IsoDate => format(d, 'yyyy-MM-dd');

export function weekDays(anchor: IsoDate): IsoDate[] {
  const monday = startOfWeek(parseISO(anchor), { weekStartsOn: 1 });
  return Array.from({ length: 7 }, (_, i) => toIsoDate(addDays(monday, i)));
}

export const dayLabelShort = (date: IsoDate): string => format(parseISO(date), 'EEE');
export const dayNumber = (date: IsoDate): string => format(parseISO(date), 'd');
export const longDayLabel = (date: IsoDate): string => format(parseISO(date), 'EEEE, d MMM');
