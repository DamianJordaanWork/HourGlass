import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { WorkItem } from '@domain/work-items/work-item';
import type { Meeting } from '@domain/calendar/meeting';
import { meetingDurationHours } from '@domain/calendar/meeting';
import { partitionIntoSections, type SectionBucket } from '@domain/work-items/work-item-section';
import { countNodes, type WorkItemNode } from '@domain/work-items/work-item-tree';
import { useSelectedDay } from '@presentation/state/selected-day';
import { useEntryModalStore } from '@presentation/state/entry-modal';
import { useWorkItemFilter } from '@presentation/state/work-item-filter';
import { collapseKeys, useWorkItemCollapse } from '@presentation/state/work-item-collapse';
import { useContainer } from '@presentation/container-context';
import {
  useMeetingMapping,
  useMeetings,
  useQuickTemplates,
  useTrackingActions,
  useWorkItemMapping,
  useWorkItems,
} from '@presentation/hooks/use-tracking';
import { useWorkItemSections } from '@presentation/hooks/use-templates';
import { filterWorkItemTree } from '@presentation/lib/work-item-search';
import { toWorkItemLink } from '@presentation/lib/work-item-ref';
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
  const c = useContainer();
  const { data: items, isLoading } = useWorkItems();
  const { data: templates } = useQuickTemplates();
  const { data: sections } = useWorkItemSections();
  const { filterId, setFilter } = useWorkItemFilter();
  const [query, setQuery] = useState('');
  const queryTemplates = (templates ?? []).filter((t) => t.enabled && t.adoQuery?.trim());
  const showFilter = c.isConfigured() && queryTemplates.length > 0;

  const onChange = (value: string) => {
    if (value === '') {
      setFilter(null);
      return;
    }
    const tpl = queryTemplates.find((t) => t.id === value);
    if (tpl?.adoQuery) setFilter({ id: tpl.id, wiql: tpl.adoQuery });
  };

  // Group into sections, then narrow by the search box — searching keeps the
  // ancestors of a match so a hit still reads under its story.
  const buckets = useMemo(() => {
    const grouped = partitionIntoSections(items ?? [], sections ?? []);
    return grouped
      .map((b) => ({ ...b, nodes: filterWorkItemTree(b.nodes, query) }))
      .filter((b) => b.nodes.length > 0);
  }, [items, sections, query]);

  const searching = query.trim() !== '';
  const empty = buckets.length === 0;

  return (
    <div className="flex flex-col gap-2">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search tickets…"
        aria-label="Search work items"
        className="rounded-lg border border-hairline bg-canvas px-2 py-1.5 text-xs text-ink outline-none placeholder:text-muted focus:border-primary"
      />
      {showFilter && (
        <select
          className="rounded-lg border border-hairline bg-canvas px-2 py-1.5 text-xs text-ink outline-none focus:border-primary"
          value={filterId ?? ''}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">Assigned to me</option>
          {queryTemplates.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
          ))}
        </select>
      )}
      {isLoading ? (
        <Hint>Loading work items…</Hint>
      ) : empty ? (
        <Hint>
          {searching
            ? 'No work items match this search.'
            : filterId
              ? 'No work items match this filter.'
              : 'No assigned work items.'}
        </Hint>
      ) : (
        buckets.map((bucket) => <WorkItemSectionGroup key={bucket.section?.id ?? '__other'} bucket={bucket} forceOpen={searching} />)
      )}
    </div>
  );
}

/** One collapsible section: its own header plus the tree that landed in it. */
function WorkItemSectionGroup({ bucket, forceOpen }: { bucket: SectionBucket; forceOpen: boolean }) {
  const key = collapseKeys.section(bucket.section?.id ?? '__other');
  const collapsed = useWorkItemCollapse((s) => s.collapsed.has(key));
  const toggle = useWorkItemCollapse((s) => s.toggle);
  const seed = useWorkItemCollapse((s) => s.seed);
  const open = forceOpen || !collapsed;

  // Apply "collapsed by default" once — after that the user's own toggling wins.
  const defaultCollapsed = bucket.section?.defaultCollapsed ?? false;
  useEffect(() => {
    if (defaultCollapsed) seed(key);
  }, [defaultCollapsed, key, seed]);

  return (
    <section className="flex flex-col gap-2">
      <button
        onClick={() => toggle(key)}
        aria-expanded={open}
        className="flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-[11px] font-semibold uppercase tracking-wide text-muted hover:text-ink"
      >
        <Chevron open={open} />
        <span className="truncate">{bucket.section?.label ?? 'Other'}</span>
        <span className="tabular ml-auto rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium normal-case tracking-normal">
          {countNodes(bucket.nodes)}
        </span>
      </button>
      {open && (
        <div className="flex flex-col gap-2">
          {bucket.nodes.map((node) => (
            <WorkItemTreeRow key={node.item.id} node={node} depth={0} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </section>
  );
}

/** A work item plus, when it has children, its own collapsible subtree. */
function WorkItemTreeRow({ node, depth, forceOpen }: { node: WorkItemNode; depth: number; forceOpen: boolean }) {
  const key = collapseKeys.item(node.item.id);
  const collapsed = useWorkItemCollapse((s) => s.collapsed.has(key));
  const toggle = useWorkItemCollapse((s) => s.toggle);
  const hasChildren = node.children.length > 0;
  const open = forceOpen || !collapsed;

  return (
    <div className="flex flex-col gap-2" style={depth > 0 ? { marginLeft: 12 } : undefined}>
      <WorkItemCard
        item={node.item}
        childCount={hasChildren ? countNodes(node.children) : 0}
        expanded={open}
        onToggle={hasChildren ? () => toggle(key) : undefined}
      />
      {hasChildren && open && (
        <div className="flex flex-col gap-2 border-l border-hairline pl-2">
          {node.children.map((child) => (
            <WorkItemTreeRow key={child.item.id} node={child} depth={depth + 1} forceOpen={forceOpen} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WorkItemCard({
  item,
  childCount = 0,
  expanded,
  onToggle,
}: {
  item: WorkItem;
  childCount?: number;
  expanded?: boolean;
  onToggle?: () => void;
}) {
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
        workItemLinks: [toWorkItemLink(item)],
      });
    }
  };

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-3">
      <div className="mb-1 flex items-center gap-1.5">
        {onToggle && (
          <button
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? `Collapse children of #${item.id}` : `Expand children of #${item.id}`}
            className="-ml-1 rounded p-0.5 text-muted hover:text-ink"
          >
            <Chevron open={expanded ?? true} />
          </button>
        )}
        <span className="tabular rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium text-muted">#{item.id}</span>
        <span className="text-[10px] text-muted">{item.workItemType} · {item.state}</span>
        {childCount > 0 && (
          <span className="tabular ml-auto rounded bg-elevated px-1.5 py-0.5 text-[10px] text-muted">{childCount}</span>
        )}
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

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 12 12"
      aria-hidden
      className={'h-3 w-3 shrink-0 transition-transform ' + (open ? 'rotate-90' : '')}
    >
      <path d="M4 2.5 8 6l-4 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
