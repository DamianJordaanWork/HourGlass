/** A single command-palette entry. Pure registry type — no store access here. */
export interface Command {
  readonly id: string;
  readonly title: string;
  readonly hint?: string;
  readonly run: () => void;
}

/**
 * Case-insensitive substring match on `title`. Empty query returns all
 * commands unchanged (stable order); no match returns an empty array.
 */
export function filterCommands(commands: readonly Command[], query: string): Command[] {
  const q = query.trim().toLowerCase();
  if (q === '') return [...commands];
  return commands.filter((c) => c.title.toLowerCase().includes(q));
}
