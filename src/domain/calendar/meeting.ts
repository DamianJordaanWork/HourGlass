import type { Id, IsoDate, IsoDateTime } from '@domain/common/types';
import type { MatchContext } from '@domain/templates/mapping';

export type CalendarProvider = 'Microsoft' | 'Google' | 'Ics';
export type MeetingStatus = 'Active' | 'Cancelled';

/** A calendar account the user connected (OAuth) or subscribed to (ICS). */
export interface CalendarAccount {
  readonly id: Id;
  readonly provider: CalendarProvider;
  readonly displayName: string;
  readonly email?: string;
  readonly color?: string;
  readonly enabled: boolean;
  /** ICS provider only. */
  readonly icsUrl?: string;
  readonly lastSyncedAt?: IsoDateTime;
}

/** A meeting/event materialised for a given local day. */
export interface Meeting {
  readonly id: Id;
  readonly calendarAccountId: Id;
  readonly calendarName: string;
  readonly externalUid: string;
  readonly title: string;
  readonly organizer?: string;
  readonly start: IsoDateTime;
  readonly end: IsoDateTime;
  readonly date: IsoDate;
  readonly isAllDay: boolean;
  readonly status: MeetingStatus;
}

export function buildMeetingContext(meeting: Meeting): MatchContext {
  return {
    title: meeting.title,
    calendarName: meeting.calendarName,
    organizer: meeting.organizer,
  };
}

/** Duration in hours (Harvest's unit), rounded to the minute. */
export function meetingDurationHours(meeting: Meeting): number {
  const ms = new Date(meeting.end).getTime() - new Date(meeting.start).getTime();
  return Math.max(0, Math.round(ms / 60000) / 60);
}
