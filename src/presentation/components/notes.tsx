import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Note, NoteColor } from '@domain/notes/note';
import { useContainer } from '@presentation/container-context';
import { useSelectedDay } from '@presentation/state/selected-day';

const COLOR_DOT: Record<NoteColor, string> = {
  none: 'var(--muted)',
  red: 'var(--danger)',
  yellow: 'var(--warning)',
  green: 'var(--success)',
};
const NEXT_COLOR: Record<NoteColor, NoteColor> = { none: 'red', red: 'yellow', yellow: 'green', green: 'none' };

function useNotesData() {
  const c = useContainer();
  return useQuery({ queryKey: ['notes'], queryFn: () => c.repos.notes.list() });
}

function useNoteActions() {
  const c = useContainer();
  const { date } = useSelectedDay();
  const qc = useQueryClient();
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['notes'] });
    void qc.invalidateQueries({ queryKey: ['intervals'] });
    void qc.invalidateQueries({ queryKey: ['running'] });
  };
  const save = (note: Note) => c.repos.notes.upsert(note);

  const add = useMutation({
    mutationFn: (content: string) =>
      save({ id: c.newId(), content, color: 'none', isWip: false, isDone: false, sortOrder: Date.parse(c.clock.nowIso()), createdAt: c.clock.nowIso() }),
    onSuccess: invalidate,
  });
  const update = useMutation({ mutationFn: (note: Note) => save(note), onSuccess: invalidate });
  const remove = useMutation({ mutationFn: (id: string) => c.repos.notes.delete(id), onSuccess: invalidate });
  const startFromNote = useMutation({
    mutationFn: async (note: Note) => {
      await c.tracking.startTracking({ date, source: 'Manual', notes: note.content });
      await save({ ...note, isWip: true });
    },
    onSuccess: invalidate,
  });
  return { add, update, remove, startFromNote };
}

export function NotesPane() {
  const { data: notes } = useNotesData();
  const actions = useNoteActions();
  const [draft, setDraft] = useState('');

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    actions.add.mutate(value);
    setDraft('');
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="mb-4 text-lg font-semibold">Notes</h2>
      <div className="mb-4 flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="Add a note or WIP task…"
          className="flex-1 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary"
        />
        <button onClick={submit} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover">Add</button>
      </div>

      {!notes?.length ? (
        <div className="rounded-lg border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted">No notes yet.</div>
      ) : (
        <div className="flex flex-col gap-2">
          {notes.map((n) => (
            <div key={n.id} className="flex items-center gap-3 rounded-lg border border-hairline bg-surface p-3">
              <button
                onClick={() => actions.update.mutate({ ...n, color: NEXT_COLOR[n.color] })}
                className="h-3 w-3 shrink-0 rounded-full"
                style={{ backgroundColor: COLOR_DOT[n.color] }}
                aria-label="Cycle colour"
              />
              <span className={'min-w-0 flex-1 truncate text-sm ' + (n.isDone ? 'text-muted line-through' : 'text-ink')}>
                {n.content}
              </span>
              {n.isWip && !n.isDone && <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[10px] font-medium text-accent-soft-text">WIP</span>}
              <button onClick={() => actions.startFromNote.mutate(n)} className="rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-on-primary hover:bg-primary-hover" title="Start a timer from this note">Start</button>
              <button onClick={() => actions.update.mutate({ ...n, isDone: !n.isDone })} className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-ink" title="Toggle done">✓</button>
              <button onClick={() => actions.remove.mutate(n.id)} className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-danger" aria-label="Delete note">✕</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
