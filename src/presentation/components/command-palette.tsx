import { useEffect, useRef, useState } from 'react';
import { filterCommands, type Command } from '@presentation/lib/commands';

/** Ctrl/Cmd+K overlay: fuzzy-filters `commands` by title, runs the highlighted one. */
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: readonly Command[];
}) {
  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query + highlight, then focus the input, whenever the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setHighlight(0);
    inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const filtered = filterCommands(commands, query);
  const clampedHighlight = filtered.length === 0 ? 0 : Math.min(highlight, filtered.length - 1);

  const runAt = (index: number) => {
    const command = filtered[index];
    if (!command) return;
    command.run();
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, Math.max(filtered.length - 1, 0)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runAt(clampedHighlight);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[15vh]" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-md overflow-hidden rounded-xl border border-hairline bg-surface shadow-[var(--shadow-card)]"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          aria-label="Search commands"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
          placeholder="Type a command…"
          className="w-full border-b border-hairline bg-transparent px-4 py-3 text-sm text-ink outline-none placeholder:text-muted"
        />
        <ul className="max-h-80 overflow-auto p-1">
          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-muted">No matching commands.</li>
          ) : (
            filtered.map((command, i) => (
              <li key={command.id}>
                <button
                  onClick={() => runAt(i)}
                  onMouseEnter={() => setHighlight(i)}
                  className={
                    'flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors ' +
                    (i === clampedHighlight ? 'bg-primary text-on-primary' : 'text-ink hover:bg-elevated')
                  }
                >
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  {command.hint && (
                    <span className={'shrink-0 text-xs ' + (i === clampedHighlight ? 'text-on-primary/80' : 'text-muted')}>
                      {command.hint}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
