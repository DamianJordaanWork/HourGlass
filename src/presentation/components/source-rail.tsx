import { useState, type ReactNode } from 'react';
import type { WorkItem } from '@domain/work-items/work-item';
import type { Meeting } from '@domain/calendar/meeting';
import { meetingDurationHours } from '@domain/calendar/meeting';
import { useSelectedDay } from '@presentation/state/selected-day';
import { useEntryModalStore } from '@presentation/state/entry-modal';
import {
  useMeetingMapping,
  useMeetings,
  useQuickTemplates,
  useTrackingActions,
  useWorkItemMapping,
  useWorkItems,
} from '@presentation/hooks/use-tracking';
import { formatHours, formatTimeRange } from '@presentation/lib/format';

type Tab = 'work' | 'meetings' | 'templates';

export function SourceRail() {
  const [tab, setTab] = useState<Tab>('work');
  const tabs: { id: Tab; label: string }[] = [
    { id: 'work', label: 'Work Items' },
    { id: 'meetings', label: 'Meetings' },
    { id: 'templates', label: 'Templates' },
  ];
  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex gap-1 rounded-lg bg-elevated p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ' +
              (tab === t.id ? 'bg-surface text-ink shadow-[var(--shadow-card)]' : 'text-muted hover:text-ink')
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'work' && <WorkItemsTab />}
        {tab === 'meetings' && <MeetingsTab />}
        {tab === 'templates' && <TemplatesTab />}
      </div>
    </div>
  );
}

function StartButton({ onClick, label = 'Start' }: { onClick: () => void; label?: string }) {
  return (
    <button onClick={onClick} className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary-hover">
      {label}
    </button>
  );
}

function WorkItemsTab() {
  const { data: items, isLoading } = useWorkItems();
  if (isLoading) return <Hint>Loading work items…</Hint>;
  if (!items?.length) return <Hint>No assigned work items.</Hint>;
  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <WorkItemCard key={item.id} item={item} />
      ))}
    </div>
  );
}

function WorkItemCard({ item }: { item: WorkItem }) {
  const { date } = useSelectedDay();
  const actions = useTrackingActions(date);
  const openEntryModal = useEntryModalStore((s) => s.open);
  const { data: mapping } = useWorkItemMapping(item);

  const start = () => {
    if (mapping) {
      actions.startWorkItem.mutate(item);
    } else {
      // No resolved rule — require the user to pick a Harvest project/task
      // rather than starting an entry that could never be linked (ADR-009).
      openEntryModal({
        source: 'WorkItem',
        notes: item.title,
        workItemRef: { connectionId: item.connectionId, workItemId: item.id, workItemType: item.workItemType, url: item.url },
      });
    }
  };

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3">
      <div className="mb-1 flex items-center gap-1.5">
        <span className="tabular rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted">#{item.id}</span>
        <span className="text-[10px] text-muted">{item.workItemType} · {item.state}</span>
      </div>
      <div className="mb-2 text-sm font-medium leading-snug text-ink">{item.title}</div>
      <div className="flex items-center gap-2">
        {mapping ? (
          <span className="truncate rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary-soft-text">
            → {mapping.projectName ?? 'Mapped'}{mapping.taskName ? ` / ${mapping.taskName}` : ''}
          </span>
        ) : (
          <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">unmapped</span>
        )}
        <span className="ml-auto" />
        <StartButton onClick={start} />
      </div>
    </div>
  );
}

function MeetingsTab() {
  const { date } = useSelectedDay();
  const { data: meetings, isLoading } = useMeetings(date);
  if (isLoading) return <Hint>Loading meetings…</Hint>;
  if (!meetings?.length) return <Hint>No meetings for this day.</Hint>;
  return (
    <div className="flex flex-col gap-2">
      {meetings.map((m: Meeting) => (
        <MeetingCard key={m.id} meeting={m} />
      ))}
    </div>
  );
}

function MeetingCard({ meeting: m }: { meeting: Meeting }) {
  const { date } = useSelectedDay();
  const actions = useTrackingActions(date);
  const openEntryModal = useEntryModalStore((s) => s.open);
  const { data: mapping } = useMeetingMapping(m);

  const start = () => {
    if (mapping) actions.startMeeting.mutate(m);
    else openEntryModal({ source: 'Meeting', notes: m.title });
  };
  const log = () => {
    if (mapping) actions.logMeeting.mutate(m);
    else openEntryModal({ source: 'Meeting', notes: m.title, initialDurationHours: meetingDurationHours(m) });
  };

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3">
      <div className="mb-0.5 text-sm font-medium text-ink">{m.title}</div>
      <div className="tabular mb-2 text-[11px] text-muted">
        {formatTimeRange(m.start, m.end)} · {formatHours(meetingDurationHours(m))} · {m.calendarName}
      </div>
      <div className="flex items-center gap-2">
        {mapping && (
          <span className="truncate rounded bg-primary-soft px-1.5 py-0.5 text-[10px] font-medium text-primary-soft-text">
            → {mapping.projectName ?? 'Mapped'}{mapping.taskName ? ` / ${mapping.taskName}` : ''}
          </span>
        )}
        {m.isAllDay ? (
          <span className="ml-auto rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">All-day — no one-click start</span>
        ) : (
          <>
            <button onClick={log} className="rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink">Log</button>
            <span className="ml-auto" />
            <StartButton onClick={start} />
          </>
        )}
      </div>
    </div>
  );
}

function TemplatesTab() {
  const { date } = useSelectedDay();
  const { data: templates, isLoading } = useQuickTemplates();
  const actions = useTrackingActions(date);
  const openEntryModal = useEntryModalStore((s) => s.open);
  if (isLoading) return <Hint>Loading templates…</Hint>;
  if (!templates?.length) return <Hint>No quick templates yet.</Hint>;
  return (
    <div className="flex flex-col gap-2">
      {templates.map((t) => {
        const mapped = t.harvestProjectId !== undefined && t.harvestTaskId !== undefined;
        const start = () => {
          if (mapped) actions.startTemplate.mutate(t);
          else openEntryModal({ source: 'QuickTemplate', notes: t.defaultNotes, templateId: t.id });
        };
        return (
          <div key={t.id} className="flex items-center gap-2.5 rounded-lg border border-hairline bg-canvas p-3">
            <span className="text-lg" aria-hidden>{t.icon ?? '⏱️'}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-ink">{t.label}</div>
              {t.defaultNotes ? <div className="truncate text-[11px] text-muted">{t.defaultNotes}</div> : null}
              {!mapped && <div className="truncate text-[10px] text-muted">unmapped</div>}
            </div>
            <span className="ml-auto" />
            <StartButton onClick={start} />
          </div>
        );
      })}
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-hairline bg-canvas p-4 text-sm text-muted">{children}</div>;
}
