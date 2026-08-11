import { describe, expect, it, vi } from 'vitest';
import type { Note } from '@domain/notes/note';
import { makeFakeContainer, renderWithProviders, screen, userEvent, waitFor } from '@test/render';
import { NotesPane } from './notes';

function seedNote(overrides: Partial<Note> = {}): Note {
  return {
    id: 'n1',
    content: 'Follow up with Bob',
    color: 'none',
    isWip: false,
    isDone: false,
    sortOrder: 1,
    createdAt: '2026-08-11T09:00:00.000Z',
    ...overrides,
  };
}

describe('NotesPane', () => {
  it('renders the empty state when there are no notes', async () => {
    const container = makeFakeContainer({
      repos: {
        ...makeFakeContainer().repos,
        notes: { list: async () => [], upsert: vi.fn(), delete: vi.fn() },
      },
    });
    renderWithProviders(<NotesPane />, { fakeContainer: container });

    expect(await screen.findByText('No notes yet.')).toBeInTheDocument();
  });

  it('renders existing notes and adds a new one via the input', async () => {
    const notes: Note[] = [seedNote()];
    const upsert = vi.fn(async (note: Note) => {
      notes.push(note);
    });
    const container = makeFakeContainer({
      newId: () => 'n2',
      clock: { ...makeFakeContainer().clock, nowIso: () => '2026-08-11T10:00:00.000Z' },
      repos: {
        ...makeFakeContainer().repos,
        notes: { list: async () => [...notes], upsert, delete: vi.fn() },
      },
    });
    renderWithProviders(<NotesPane />, { fakeContainer: container });

    expect(await screen.findByText('Follow up with Bob')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('Add a note or WIP task…'), 'Buy milk');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ id: 'n2', content: 'Buy milk' }));
    expect(await screen.findByText('Buy milk')).toBeInTheDocument();
  });
});
