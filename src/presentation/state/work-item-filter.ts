import { create } from 'zustand';
import type { Id } from '@domain/common/types';

interface WorkItemFilterState {
  filterId: Id | null;
  wiql: string | null;
  /** Select a saved-query template filter, or pass `null` to reset to "Assigned to me". */
  setFilter: (f: { id: Id; wiql: string } | null) => void;
}

export const useWorkItemFilter = create<WorkItemFilterState>((set) => ({
  filterId: null,
  wiql: null,
  setFilter: (f) => set(f ? { filterId: f.id, wiql: f.wiql } : { filterId: null, wiql: null }),
}));
