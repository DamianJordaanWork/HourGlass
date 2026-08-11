import { useEffect, useMemo, useState } from 'react';
import type { Command } from '@presentation/lib/commands';
import { useView, type View } from '@presentation/state/view';
import { useEntryModalStore } from '@presentation/state/entry-modal';
import { useTheme } from '@presentation/state/theme';
import { useSelectedDay } from '@presentation/state/selected-day';
import { useRunning, useTrackingActions } from '@presentation/hooks/use-tracking';

const VIEWS: { id: View; label: string }[] = [
  { id: 'timesheet', label: 'Timesheet' },
  { id: 'insights', label: 'Insights' },
  { id: 'notes', label: 'Notes' },
  { id: 'templates', label: 'Templates' },
  { id: 'settings', label: 'Settings' },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

/**
 * Owns the command-palette open state, the Ctrl/Cmd+K toggle, and the live
 * Command[] built from the app's stores/mutations (view, entry modal, theme,
 * running-timer stop). The hotkey works even while typing in a field; other
 * shortcuts routed through this hook should not (see `isTypingTarget`).
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  const setView = useView((s) => s.setView);
  const openEntryModal = useEntryModalStore((s) => s.open);
  const cycleTheme = useTheme((s) => s.cycle);
  const { date } = useSelectedDay();
  const { data: running } = useRunning();
  const actions = useTrackingActions(date);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const isPaletteHotkey = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
      if (isPaletteHotkey) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      if (isTypingTarget(e.target)) return;
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = VIEWS.map((v) => ({
      id: `view:${v.id}`,
      title: `Go to ${v.label}`,
      run: () => setView(v.id),
    }));

    list.push({
      id: 'new-entry',
      title: 'New time entry',
      run: () => openEntryModal({ source: 'Manual' }),
    });

    list.push({ id: 'cycle-theme', title: 'Cycle theme', run: () => cycleTheme() });

    if (running) {
      list.push({
        id: 'stop-timer',
        title: 'Stop running timer',
        hint: running.notes || undefined,
        run: () => actions.stop.mutate(running.id),
      });
    }

    return list;
  }, [setView, openEntryModal, cycleTheme, running, actions.stop]);

  return { open, close: () => setOpen(false), commands };
}
