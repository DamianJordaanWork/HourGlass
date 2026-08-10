import ICAL from 'ical.js';
import type { IsoDate } from '@domain/common/types';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { ICalendarSource, IHttpTransport } from '@domain/ports';

/** Parses a published `.ics` URL (Outlook/Google style) and expands recurrences. */
export class IcsCalendarSource implements ICalendarSource {
  readonly provider = 'Ics' as const;

  constructor(private readonly http: IHttpTransport) {}

  async fetchDay(account: CalendarAccount, date: IsoDate): Promise<Meeting[]> {
    if (!account.icsUrl) return [];
    const res = await this.http.send({ method: 'GET', url: account.icsUrl });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`ICS fetch failed (${res.status}) for ${account.displayName}`);
    }

    const jcal = ICAL.parse(res.body);
    const comp = new ICAL.Component(jcal);
    const calendarName = comp.getFirstPropertyValue('x-wr-calname') as string | null;

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(`${date}T00:00:00`);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const meetings: Meeting[] = [];
    for (const vevent of comp.getAllSubcomponents('vevent')) {
      const event = new ICAL.Event(vevent);
      if (event.isRecurring()) {
        meetings.push(...this.expandRecurring(event, account, calendarName, date, dayStart, dayEnd));
      } else {
        const meeting = this.toMeetingIfInDay(event, event.startDate, event.endDate, account, calendarName, date, dayStart, dayEnd);
        if (meeting) meetings.push(meeting);
      }
    }
    return meetings;
  }

  private expandRecurring(
    event: ICAL.Event,
    account: CalendarAccount,
    calendarName: string | null,
    date: IsoDate,
    dayStart: Date,
    dayEnd: Date,
  ): Meeting[] {
    const meetings: Meeting[] = [];
    const iterator = event.iterator();
    let next: ICAL.Time | null;
    // Recurrences are yielded in order; stop once we're past the day window.
    while ((next = iterator.next())) {
      const occurrenceStart = next.toJSDate();
      if (occurrenceStart >= dayEnd) break;
      if (occurrenceStart < dayStart) continue;
      const details = event.getOccurrenceDetails(next);
      const meeting = this.toMeetingIfInDay(
        event,
        details.startDate,
        details.endDate,
        account,
        calendarName,
        date,
        dayStart,
        dayEnd,
        next.toString(),
      );
      if (meeting) meetings.push(meeting);
    }
    return meetings;
  }

  private toMeetingIfInDay(
    event: ICAL.Event,
    start: ICAL.Time,
    end: ICAL.Time,
    account: CalendarAccount,
    calendarName: string | null,
    date: IsoDate,
    dayStart: Date,
    dayEnd: Date,
    recurrenceId?: string,
  ): Meeting | null {
    const startJs = start.toJSDate();
    const endJs = end.toJSDate();
    if (endJs <= dayStart || startJs >= dayEnd) return null;
    return {
      id: `ics-${account.id}-${event.uid}${recurrenceId ? `-${recurrenceId}` : ''}`,
      calendarAccountId: account.id,
      calendarName: calendarName ?? account.displayName,
      externalUid: recurrenceId ? `${event.uid}:${recurrenceId}` : event.uid,
      title: event.summary || '(No title)',
      organizer: event.organizer ? event.organizer.replace(/^mailto:/i, '') : undefined,
      start: startJs.toISOString(),
      end: endJs.toISOString(),
      date,
      isAllDay: start.isDate,
      status: 'Active',
    };
  }
}
