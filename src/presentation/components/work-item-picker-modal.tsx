import { useEffect, useMemo, useRef, useState } from 'react';
import type { WorkItem } from '@domain/work-items/work-item';
import type { WorkItemLink } from '@domain/time/time-interval';
import { useWorkItems } from '@presentation/hooks/use-tracking';
import { filterWorkItems } from '@presentation/lib/work-item-search';
import { toWorkItemLink } from '@presentation/lib/work-item-ref';

/**
 * Searchable multi-select over the ADO tickets, for attaching them to a time
 * entry after the fact. Deliberately flat (not the rail's tree): you're picking
 * individual tickets, not browsing structure.
 */
export function WorkItemPickerModal({
  onClose,
  onAdd,
  alreadyLinked,
}: {
  onClose: () => void;
  onAdd: (links: readonly WorkItemLink[]) => void;
  alreadyLinked: readonly number[];
}) {
  const { data: items, isLoading } = useWorkItems();
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const [selected, setSelected] = useState<readonly WorkItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const linked = useMemo(() => new Set(alreadyLinked), [alreadyLinked]);
  const results = useMemo(() => filterWorkItems(items ?? [], query), [items, query]);
  const clamped = results.length === 0 ? 0 : Math.min(highlight, results.length - 1);

  const isSelected = (item: WorkItem) => selected.some((s) => s.id === item.id);
  const toggle = (item: WorkItem) => {
    if (linked.has(item.id)) return;
    setSelected((prev) => (prev.some((s) => s.id === item.id) ? prev.filter((s) => s.id !== item.id) : [...prev, item]));
  };

  const confirm = () => {
    if (selected.length === 0) return;
    onAdd(selected.map(toWorkItemLink));
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter picks the highlighted row; Ctrl/Cmd+Enter commits the selection.
      if (e.ctrlKey || e.metaKey) confirm();
      else {
        const item = results[clamped];
        if (item) toggle(item);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-[12vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Add Azure tickets"
        className="flex w-full max-w-lg flex-col overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          aria-label="Search tickets"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Search by id, title, type, state…"
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ul className="max-h-80 overflow-auto p-1">
          {isLoading ? (
            <li className="px-3 py-2 text-sm text-muted">Loading work items…</li>
          ) : results.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No tickets match.</li>
          ) : (
            results.map((item, i) => {
              const already = linked.has(item.id);
              const picked = isSelected(item);
              return (
                <li key={`${item.connectionId}:${item.id}`}>
                  <button
                    type="button"
                    disabled={already}
                    onClick={() => toggle(item)}
                    onMouseEnter={() => setHighlight(i)}
                    aria-pressed={picked}
                    className={
                      'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ' +
                      (already
                        ? 'cursor-not-allowed text-muted opacity-60'
                        : i === clamped
                          ? 'bg-primary text-on-primary'
                          : 'text-ink hover:bg-elevated')
                    }
                  >
                    <span className="w-4 shrink-0 text-center" aria-hidden>
                      {picked ? '✓' : already ? '·' : ''}
                    </span>
                    <span className="tabular shrink-0 text-xs opacity-70">#{item.id}</span>
                    <span className="min-w-0 flex-1 truncate">{item.title}</span>
                    <span className="shrink-0 text-xs opacity-70">
                      {item.workItemType} · {item.state}
                    </span>
                  </button>
                </li>
              );
            })
          )}
        </ul>
        <div className="flex items-center gap-2 border-t border-hairline px-3 py-2">
          <span className="text-xs text-muted">
            {selected.length === 0 ? 'Select one or more tickets' : `${selected.length} selected`}
          </span>
          <span className="ml-auto" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-hairline px-2.5 py-1.5 text-xs font-medium text-muted hover:text-ink"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selected.length === 0}
            className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
