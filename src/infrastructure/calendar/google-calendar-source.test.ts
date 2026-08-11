import { describe, it, expect } from 'vitest';
import { GoogleCalendarSource } from './google-calendar-source';
import { FakeTransport } from '@test/fake-transport';
import type { CalendarAccount } from '@domain/calendar/meeting';

const ACCOUNT: CalendarAccount = {
  id: 'acct-gcal',
  provider: 'Google',
  displayName: 'Personal (Gmail)',
  email: 'damian@gmail.com',
  enabled: true,
};

const EVENTS_RESPONSE = {
  items: [
    {
      id: 'evt-1',
      iCalUID: 'evt-1@google.com',
      summary: 'Sprint Planning',
      organizer: { displayName: 'PO', email: 'po@example.com' },
      start: { dateTime: '2026-08-03T09:00:00Z' },
      end: { dateTime: '2026-08-03T10:00:00Z' },
      status: 'confirmed',
    },
    {
      id: 'evt-2',
      summary: 'Company Holiday',
      start: { date: '2026-08-03' },
      end: { date: '2026-08-04' },
      status: 'confirmed',
    },
    {
      id: 'evt-3',
      summary: 'Cancelled sync',
      start: { dateTime: '2026-08-03T14:00:00Z' },
      end: { dateTime: '2026-08-03T14:30:00Z' },
      status: 'cancelled',
    },
    {
      id: 'evt-4',
      start: { dateTime: '2026-08-03T15:00:00Z' },
      end: { dateTime: '2026-08-03T15:30:00Z' },
      status: 'confirmed',
    },
  ],
};

describe('GoogleCalendarSource', () => {
  it('maps events to Meetings, including all-day and cancelled', async () => {
    const transport = new FakeTransport().on('GET', '/calendars/primary/events', EVENTS_RESPONSE);
    const source = new GoogleCalendarSource(transport, async () => ({ accessToken: 'tok-123' }));

    const meetings = await source.fetchDay(ACCOUNT, '2026-08-03');

    expect(meetings).toHaveLength(4);

    const planning = meetings.find((m) => m.title === 'Sprint Planning')!;
    expect(planning.isAllDay).toBe(false);
    expect(planning.status).toBe('Active');
    expect(planning.organizer).toBe('PO');
    expect(planning.start).toBe('2026-08-03T09:00:00Z');
    expect(planning.externalUid).toBe('evt-1@google.com');

    const holiday = meetings.find((m) => m.title === 'Company Holiday')!;
    expect(holiday.isAllDay).toBe(true);
    expect(holiday.start).toBe('2026-08-03T00:00:00');
    expect(holiday.externalUid).toBe('evt-2');

    const cancelled = meetings.find((m) => m.title === 'Cancelled sync')!;
    expect(cancelled.status).toBe('Cancelled');

    const noTitle = meetings.find((m) => m.id === `gcal-${ACCOUNT.id}-evt-4`)!;
    expect(noTitle.title).toBe('(No title)');
    expect(noTitle.organizer).toBeUndefined();

    expect(transport.lastRequest().headers?.Authorization).toBe('Bearer tok-123');
    const url = transport.lastRequest().url;
    expect(url).toContain('singleEvents=true');
    expect(url).toContain('orderBy=startTime');
    expect(url).toContain('timeMin=2026-08-03T00%3A00%3A00Z');
    expect(url).toContain('timeMax=2026-08-03T23%3A59%3A59Z');
    expect(url).toContain('maxResults=250');
  });

  it('throws when no access token can be resolved for the account', async () => {
    const source = new GoogleCalendarSource(new FakeTransport(), async () => null);
    await expect(source.fetchDay(ACCOUNT, '2026-08-03')).rejects.toThrow(/access token/i);
  });

  it('throws with status/body when the request fails', async () => {
    const transport = new FakeTransport().on('GET', '/calendars/primary/events', { error: 'unauthorized' }, 401);
    const source = new GoogleCalendarSource(transport, async () => ({ accessToken: 'tok-bad' }));
    await expect(source.fetchDay(ACCOUNT, '2026-08-03')).rejects.toThrow(/Google Calendar events failed/);
  });
});
