import { create } from 'zustand';
import type { Id, TrackingSource } from '@domain/common/types';
import type { WorkItemLink } from '@domain/time/time-interval';

/**
 * Context carried into the new-entry modal when a Start/Log action has no
 * resolved Harvest mapping. Harvest is the source of truth (ADR-009) — the
 * service layer refuses to persist an entry without a project+task, so these
 * actions route through the modal instead of tracking directly, letting the
 * user pick a mapping without losing the work-item/template/meeting context.
 */
export interface NewEntryPrefill {
  readonly source: TrackingSource;
  readonly notes?: string;
  readonly workItemLinks?: readonly WorkItemLink[];
  readonly templateId?: Id;
  /** Pre-fills the duration (e.g. a meeting's length for "Log"); omitted ⇒ live timer. */
  readonly initialDurationHours?: number;
}

interface EntryModalState {
  readonly prefill: NewEntryPrefill | null;
  open: (prefill: NewEntryPrefill) => void;
  close: () => void;
}

export const useEntryModalStore = create<EntryModalState>((set) => ({
  prefill: null,
  open: (prefill) => set({ prefill }),
  close: () => set({ prefill: null }),
}));
