import { describe, expect, it } from 'vitest';
import { filterCommands, type Command } from './commands';

function cmd(id: string, title: string): Command {
  return { id, title, run: () => {} };
}

function ids(commands: readonly Command[]): string[] {
  return commands.map((c) => c.id);
}

describe('filterCommands', () => {
  const commands: readonly Command[] = [
    cmd('timesheet', 'Go to Timesheet'),
    cmd('insights', 'Go to Insights'),
    cmd('stop', 'Stop running timer'),
    cmd('theme', 'Cycle theme'),
  ];

  it('matches a substring of the title', () => {
    expect(ids(filterCommands(commands, 'timer'))).toEqual(['stop']);
  });

  it('matches case-insensitively', () => {
    expect(ids(filterCommands(commands, 'TIMESHEET'))).toEqual(['timesheet']);
  });

  it('returns all commands, in order, for an empty query', () => {
    expect(ids(filterCommands(commands, ''))).toEqual(ids(commands));
  });

  it('returns all commands for a whitespace-only query', () => {
    expect(ids(filterCommands(commands, '   '))).toEqual(ids(commands));
  });

  it('returns an empty array when nothing matches', () => {
    expect(filterCommands(commands, 'zzz-no-match')).toEqual([]);
  });
});
