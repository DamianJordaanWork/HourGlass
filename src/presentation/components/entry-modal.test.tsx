import { describe, expect, it, vi } from 'vitest';
import type { HarvestProject } from '@domain/harvest/harvest-types';
import { makeFakeContainer, renderWithProviders, screen, userEvent, waitFor } from '@test/render';
import { EntryModal } from './entry-modal';

const projects: HarvestProject[] = [
  { id: 1, name: 'Acme', tasks: [{ id: 10, name: 'Development' }, { id: 11, name: 'QA' }] },
];

describe('EntryModal — ADR-010 mapping invariant', () => {
  it('disables the primary action until a project + task are chosen', async () => {
    const container = makeFakeContainer({ harvestProjectOptions: () => projects });
    renderWithProviders(<EntryModal mode="new" date="2026-08-11" onClose={vi.fn()} />, { fakeContainer: container });

    // Options load asynchronously via react-query even for a synchronous facade.
    await waitFor(() => expect(screen.getByRole('option', { name: 'Acme' })).toBeInTheDocument());

    const primary = screen.getByRole('button', { name: 'Start timer' });
    expect(primary).toBeDisabled();
    expect(screen.getByText(/pick a project and task before saving/i)).toBeInTheDocument();

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Harvest project'), 'Acme');

    // Choosing a project auto-selects its first task, satisfying the mapping.
    await waitFor(() => expect(primary).not.toBeDisabled());
    expect(screen.queryByText(/pick a project and task before saving/i)).not.toBeInTheDocument();
  });

  it('cancel calls onClose without requiring a mapping', async () => {
    const container = makeFakeContainer({ harvestProjectOptions: () => projects });
    const onClose = vi.fn();
    renderWithProviders(<EntryModal mode="new" date="2026-08-11" onClose={onClose} />, { fakeContainer: container });

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
