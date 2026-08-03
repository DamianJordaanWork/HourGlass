import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme, type ThemePref } from '@presentation/state/theme';
import { useView, type View } from '@presentation/state/view';
import { ContainerProvider, useContainer } from '@presentation/container-context';
import { TimesheetPane } from '@presentation/components/timesheet';
import { SourceRail } from '@presentation/components/source-rail';
import { InsightsPane } from '@presentation/components/insights';
import { NotesPane } from '@presentation/components/notes';
import { TemplatesPane } from '@presentation/components/templates';
import { SettingsPane } from '@presentation/components/settings';
import { EntryModal } from '@presentation/components/entry-modal';
import { useConnectionStatus } from '@presentation/hooks/use-connections';
import { useEntryModalStore } from '@presentation/state/entry-modal';
import { useSelectedDay } from '@presentation/state/selected-day';

export function App() {
  return (
    <ContainerProvider>
      <Shell />
    </ContainerProvider>
  );
}

function Shell() {
  const container = useContainer();
  const qc = useQueryClient();
  const view = useView((s) => s.view);
  const { date } = useSelectedDay();
  const prefill = useEntryModalStore((s) => s.prefill);
  const closeEntryModal = useEntryModalStore((s) => s.close);

  useEffect(() => {
    void container.ready.then(() => qc.invalidateQueries());
  }, [container, qc]);

  return (
    <div className="flex h-full flex-col bg-canvas text-ink">
      <TopBar />
      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto p-6">
          {view === 'timesheet' && <TimesheetPane />}
          {view === 'insights' && <InsightsPane />}
          {view === 'notes' && <NotesPane />}
          {view === 'templates' && <TemplatesPane />}
          {view === 'settings' && <SettingsPane />}
        </main>
        {view === 'timesheet' && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-hidden border-l border-hairline bg-surface p-4">
            <SourceRail />
          </aside>
        )}
      </div>
      {/* Global: opened whenever a Start/Log has no resolved Harvest mapping yet. */}
      {prefill && <EntryModal mode="new" date={date} prefill={prefill} onClose={closeEntryModal} />}
    </div>
  );
}

function TopBar() {
  const pref = useTheme((s) => s.pref);
  const cycle = useTheme((s) => s.cycle);
  const view = useView((s) => s.view);
  const setView = useView((s) => s.setView);
  const { data: status } = useConnectionStatus();
  const label: Record<ThemePref, string> = { system: 'System', light: 'Light', dark: 'Dark' };
  const views: { id: View; label: string }[] = [
    { id: 'timesheet', label: 'Timesheet' },
    { id: 'insights', label: 'Insights' },
    { id: 'notes', label: 'Notes' },
    { id: 'templates', label: 'Templates' },
    { id: 'settings', label: 'Settings' },
  ];

  return (
    <header className="flex items-center gap-3 border-b border-hairline bg-surface px-5 py-3">
      <img src="/hourglass.svg" alt="" className="h-6 w-6" />
      <span className="text-[15px] font-semibold tracking-tight">Hourglass</span>
      <nav className="ml-4 flex gap-1">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setView(v.id)}
            className={
              'rounded-md px-3 py-1.5 text-sm font-medium transition-colors ' +
              (view === v.id ? 'bg-primary-soft text-primary-soft-text' : 'text-muted hover:text-ink')
            }
          >
            {v.label}
          </button>
        ))}
      </nav>
      {status?.configured ? (
        <button
          onClick={() => setView('settings')}
          className="ml-2 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-soft-text"
        >
          Connected
        </button>
      ) : (
        <button
          onClick={() => setView('settings')}
          className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-soft-text"
          title="No connections configured — showing demo data. Click to set up."
        >
          Demo data
        </button>
      )}
      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={cycle}
          className="rounded-md border border-hairline bg-canvas px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-ink"
        >
          Theme: {label[pref]}
        </button>
      </div>
    </header>
  );
}
