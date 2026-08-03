import { create } from 'zustand';

export type View = 'timesheet' | 'insights' | 'notes' | 'templates' | 'settings';

interface ViewState {
  view: View;
  setView: (view: View) => void;
}

export const useView = create<ViewState>((set) => ({
  view: 'timesheet',
  setView: (view) => set({ view }),
}));
