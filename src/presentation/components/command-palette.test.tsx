import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { Command } from '@presentation/lib/commands';
import { screen, userEvent } from '@test/render';
import { CommandPalette } from './command-palette';

function makeCommands(): Command[] {
  return [
    { id: 'a', title: 'Start timer', run: vi.fn() },
    { id: 'b', title: 'Add note', run: vi.fn() },
    { id: 'c', title: 'Open settings', run: vi.fn() },
  ];
}

describe('CommandPalette', () => {
  it('renders nothing when closed', () => {
    const commands = makeCommands();
    const { container } = render(<CommandPalette open={false} onClose={vi.fn()} commands={commands} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the given commands when open', () => {
    const commands = makeCommands();
    render(<CommandPalette open onClose={vi.fn()} commands={commands} />);
    expect(screen.getByText('Start timer')).toBeInTheDocument();
    expect(screen.getByText('Add note')).toBeInTheDocument();
    expect(screen.getByText('Open settings')).toBeInTheDocument();
  });

  it('typing filters the command list', async () => {
    const user = userEvent.setup();
    const commands = makeCommands();
    render(<CommandPalette open onClose={vi.fn()} commands={commands} />);

    await user.type(screen.getByLabelText('Search commands'), 'note');

    expect(screen.getByText('Add note')).toBeInTheDocument();
    expect(screen.queryByText('Start timer')).not.toBeInTheDocument();
    expect(screen.queryByText('Open settings')).not.toBeInTheDocument();
  });

  it('ArrowDown + Enter runs the highlighted command and closes the palette', async () => {
    const user = userEvent.setup();
    const commands = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);

    const input = screen.getByLabelText('Search commands');
    await user.click(input);
    await user.keyboard('{ArrowDown}{Enter}');

    expect(commands[1].run).toHaveBeenCalledTimes(1);
    expect(commands[0].run).not.toHaveBeenCalled();
    expect(commands[2].run).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes the palette without running a command', async () => {
    const user = userEvent.setup();
    const commands = makeCommands();
    const onClose = vi.fn();
    render(<CommandPalette open onClose={onClose} commands={commands} />);

    await user.click(screen.getByLabelText('Search commands'));
    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(commands.every((c) => (c.run as ReturnType<typeof vi.fn>).mock.calls.length === 0)).toBe(true);
  });
});
