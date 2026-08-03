import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { IsoDate } from '@domain/common/types';
import type { WorkItem } from '@domain/work-items/work-item';
import { meetingDurationHours, type Meeting } from '@domain/calendar/meeting';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { HarvestTimeEntry } from '@domain/harvest/harvest-types';
import type { UpdateIntervalInput } from '@application/tracking-service';
import { useContainer } from '@presentation/container-context';

/** Fields the manual-entry modal supplies. */
export interface ManualEntryInput {
  readonly harvestProjectId?: number;
  readonly harvestTaskId?: number;
  readonly projectName?: string;
  readonly taskName?: string;
  readonly notes: string;
}

export function useWorkItems() {
  const c = useContainer();
  return useQuery({ queryKey: ['workItems'], queryFn: () => c.listWorkItems() });
}

export function useMeetings(date: IsoDate) {
  const c = useContainer();
  return useQuery({ queryKey: ['meetings', date], queryFn: () => c.listMeetings(date) });
}

export function useDayIntervals(date: IsoDate) {
  const c = useContainer();
  return useQuery({ queryKey: ['intervals', date], queryFn: () => c.tracking.listDay(date) });
}

export function useRunning() {
  const c = useContainer();
  return useQuery({ queryKey: ['running'], queryFn: () => c.tracking.getRunning() });
}

export function useQuickTemplates() {
  const c = useContainer();
  return useQuery({ queryKey: ['quickTemplates'], queryFn: () => c.repos.quickTemplates.list() });
}

/** Existing Harvest time entries for a date range (empty when unconnected). */
export function useHarvestEntries(from: IsoDate, to: IsoDate) {
  const c = useContainer();
  return useQuery({
    queryKey: ['harvestEntries', from, to],
    queryFn: () => c.listHarvestEntries(from, to),
  });
}

/** Resolve a work item's Harvest mapping (chip on each card). */
export function useWorkItemMapping(item: WorkItem) {
  const c = useContainer();
  return useQuery({
    queryKey: ['wi-map', item.id],
    queryFn: async () => {
      const match = await c.mapping.forWorkItem(item);
      if (!match) return null;
      return { ...match.target, ...c.harvestName(match.target.harvestProjectId, match.target.harvestTaskId) };
    },
  });
}

/** All tracking commands, invalidating the affected queries on success. */
export function useTrackingActions(date: IsoDate) {
  const c = useContainer();
  const qc = useQueryClient();
  const invalidate = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ['intervals'] });
    void qc.invalidateQueries({ queryKey: ['running'] });
    void qc.invalidateQueries({ queryKey: ['week'] });
    void qc.invalidateQueries({ queryKey: ['harvestEntries'] });
  }, [qc]);

  const startWorkItem = useMutation({
    mutationFn: async (item: WorkItem) => {
      const match = await c.mapping.forWorkItem(item);
      const t = match?.target;
      const names = c.harvestName(t?.harvestProjectId, t?.harvestTaskId);
      return c.tracking.startTracking({
        date,
        source: 'WorkItem',
        harvestProjectId: t?.harvestProjectId,
        harvestTaskId: t?.harvestTaskId,
        projectName: names.projectName,
        taskName: names.taskName,
        notes: t?.noteTemplate ?? item.title,
        workItemRef: { connectionId: item.connectionId, workItemId: item.id, workItemType: item.workItemType, url: item.url },
      });
    },
    onSuccess: invalidate,
  });

  const startTemplate = useMutation({
    mutationFn: async (tpl: QuickTemplate) => {
      const names = c.harvestName(tpl.harvestProjectId, tpl.harvestTaskId);
      return c.tracking.startTracking({
        date,
        source: 'QuickTemplate',
        harvestProjectId: tpl.harvestProjectId,
        harvestTaskId: tpl.harvestTaskId,
        projectName: names.projectName,
        taskName: names.taskName,
        notes: tpl.defaultNotes ?? '',
        templateId: tpl.id,
      });
    },
    onSuccess: invalidate,
  });

  const startMeeting = useMutation({
    mutationFn: async (m: Meeting) => {
      const match = await c.mapping.forMeeting(m);
      const t = match?.target;
      const names = c.harvestName(t?.harvestProjectId, t?.harvestTaskId);
      return c.tracking.startTracking({ date, source: 'Meeting', harvestProjectId: t?.harvestProjectId, harvestTaskId: t?.harvestTaskId, projectName: names.projectName, taskName: names.taskName, notes: m.title });
    },
    onSuccess: invalidate,
  });

  const logMeeting = useMutation({
    mutationFn: async (m: Meeting) => {
      const match = await c.mapping.forMeeting(m);
      const t = match?.target;
      const names = c.harvestName(t?.harvestProjectId, t?.harvestTaskId);
      return c.tracking.logManualTime({ date, source: 'Meeting', harvestProjectId: t?.harvestProjectId, harvestTaskId: t?.harvestTaskId, projectName: names.projectName, taskName: names.taskName, notes: m.title, hours: meetingDurationHours(m) });
    },
    onSuccess: invalidate,
  });

  const stop = useMutation({ mutationFn: (id: string) => c.tracking.stopTracking(id), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => c.tracking.deleteInterval(id), onSuccess: invalidate });
  const continueTimer = useMutation({ mutationFn: (id: string) => c.tracking.continueInterval(id), onSuccess: invalidate });

  const startManual = useMutation({
    mutationFn: (i: ManualEntryInput) => c.tracking.startTracking({ date, source: 'Manual', ...i }),
    onSuccess: invalidate,
  });
  const logManual = useMutation({
    mutationFn: (i: ManualEntryInput & { hours: number }) => c.tracking.logManualTime({ date, source: 'Manual', ...i }),
    onSuccess: invalidate,
  });
  const update = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: UpdateIntervalInput }) => c.tracking.updateInterval(id, patch),
    onSuccess: invalidate,
  });

  // ── Harvest-entry first-class ops ─────────────────────────────────────────
  // Continue a Harvest-only entry: adopt it into a local interval, then reopen it
  // so time keeps accruing on that same Harvest entry.
  const continueFromEntry = useMutation({
    mutationFn: async (e: HarvestTimeEntry) => {
      const local = await c.tracking.importHarvestEntry(e);
      return c.tracking.continueInterval(local.id);
    },
    onSuccess: invalidate,
  });
  const editExternal = useMutation({
    mutationFn: async ({ entry, patch }: { entry: HarvestTimeEntry; patch: UpdateIntervalInput }) => {
      const local = await c.tracking.importHarvestEntry(entry);
      return c.tracking.updateInterval(local.id, patch);
    },
    onSuccess: invalidate,
  });
  const linkHarvest = useMutation({
    mutationFn: ({ intervalId, entry }: { intervalId: string; entry: HarvestTimeEntry }) =>
      c.tracking.linkToHarvestEntry(intervalId, entry.id, entry.hours),
    onSuccess: invalidate,
  });
  const deleteHarvestEntry = useMutation({
    mutationFn: (id: number) => c.deleteHarvestEntry(id),
    onSuccess: invalidate,
  });

  return {
    startWorkItem, startTemplate, startMeeting, logMeeting, stop, remove, continueTimer,
    startManual, logManual, update, continueFromEntry, editExternal, linkHarvest, deleteHarvestEntry,
  };
}

/** Re-render every second while `active`, to tick the running timer. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}
