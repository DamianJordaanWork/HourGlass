import type { Id, IsoDateTime } from '@domain/common/types';

export type NoteColor = 'none' | 'red' | 'yellow' | 'green';

/** A lightweight sticky-note / WIP task. Starting a timer from it marks it WIP. */
export interface Note {
  readonly id: Id;
  readonly content: string;
  readonly color: NoteColor;
  readonly isWip: boolean;
  readonly isDone: boolean;
  readonly sortOrder: number;
  readonly createdAt: IsoDateTime;
}
