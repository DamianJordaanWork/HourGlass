import { create } from 'zustand';
import { addWeeks, parseISO } from 'date-fns';
import { toIsoDate } from '@presentation/lib/format';
import type { IsoDate } from '@domain/common/types';

function todayIso(): IsoDate {
  return toIsoDate(new Date());
}

interface SelectedDayState {
  date: IsoDate;
  setDate: (date: IsoDate) => void;
  shiftWeek: (delta: number) => void;
  goToday: () => void;
}

export const useSelectedDay = create<SelectedDayState>((set, get) => ({
  date: todayIso(),
  setDate: (date) => set({ date }),
  shiftWeek: (delta) => set({ date: toIsoDate(addWeeks(parseISO(get().date), delta)) }),
  goToday: () => set({ date: todayIso() }),
}));
