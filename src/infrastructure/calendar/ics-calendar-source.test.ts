import { describe, it, expect } from 'vitest';
import { IcsCalendarSource } from './ics-calendar-source';
import { FakeTransport } from '@test/fake-transport';
import type { CalendarAccount } from '@domain/calendar/meeting';

const ACCOUNT: CalendarAccount = {
  id: 'acct-1',
  provider: 'Ics',
  displayName: 'Work (Outlook)',
  enabled: true,
  icsUrl: 'https://example.com/calendar.ics',
};

const ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//EN
X-WR-CALNAME:Work Calendar
BEGIN:VEVENT
UID:single-event@example.com
DTSTAMP:20260803T090000Z
DTSTART:20260803T090000Z
DTEND:20260803T093000Z
SUMMARY:One-off sync
ORGANIZER:mailto:lead@example.com
END:VEVENT
BEGIN:VEVENT
UID:daily-standup@example.com
DTSTAMP:20260801T090000Z
DTSTART:20260801T090000Z
DTEND:20260801T091500Z
RRULE:FREQ=DAILY;COUNT=10
SUMMARY:Daily Standup
END:VEVENT
BEGIN:VEVENT
UID:all-day-offsite@example.com
DTSTAMP:20260803T000000Z
DTSTART;VALUE=DATE:20260803
DTEND;VALUE=DATE:20260804
SUMMARY:Company Offsite
END:VEVENT
BEGIN:VEVENT
UID:other-day@example.com
DTSTAMP:20260805T090000Z
DTSTART:20260805T090000Z
DTEND:20260805T100000Z
SUMMARY:Not today
END:VEVENT
END:VCALENDAR
`;

describe('IcsCalendarSource', () => {
  it('maps a single event, an expanded recurring instance, and an all-day event on the requested day', async () => {
    const transport = new FakeTransport().on('GET', 'calendar.ics', ICS);
    const source = new IcsCalendarSource(transport);

    const meetings = await source.fetchDay(ACCOUNT, '2026-08-03');
    const titles = meetings.map((m) => m.title).sort();

    expect(titles).toEqual(['Company Offsite', 'Daily Standup', 'One-off sync']);

    const single = meetings.find((m) => m.title === 'One-off sync')!;
    expect(single.calendarName).toBe('Work Calendar');
    expect(single.organizer).toBe('lead@example.com');
    expect(single.isAllDay).toBe(false);
    expect(single.date).toBe('2026-08-03');

    const allDay = meetings.find((m) => m.title === 'Company Offsite')!;
    expect(allDay.isAllDay).toBe(true);

    const recurring = meetings.find((m) => m.title === 'Daily Standup')!;
    expect(recurring.isAllDay).toBe(false);
    expect(recurring.externalUid).toContain('daily-standup@example.com');
  });

  it('does not include events from other days', async () => {
    const transport = new FakeTransport().on('GET', 'calendar.ics', ICS);
    const source = new IcsCalendarSource(transport);
    // The daily standup recurs 2026-08-01..10, so it's still present on the 5th;
    // only the truly single-instance events from other days are excluded.
    const meetings = await source.fetchDay(ACCOUNT, '2026-08-05');
    expect(meetings.map((m) => m.title).sort()).toEqual(['Daily Standup', 'Not today']);
  });

  it('returns nothing for an account with no ICS URL', async () => {
    const source = new IcsCalendarSource(new FakeTransport());
    const meetings = await source.fetchDay({ ...ACCOUNT, icsUrl: undefined }, '2026-08-03');
    expect(meetings).toEqual([]);
  });
});
