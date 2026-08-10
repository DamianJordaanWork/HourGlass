import { describe, it, expect } from 'vitest';
import { MicrosoftGraphCalendarSource } from './microsoft-graph-calendar-source';
import { FakeTransport } from '@test/fake-transport';
import type { CalendarAccount } from '@domain/calendar/meeting';

const ACCOUNT: CalendarAccount = {
  id: 'acct-graph',
  provider: 'Microsoft',
  displayName: 'Work (Outlook)',
  email: 'damian@agilebridge.co.za',
  enabled: true,
};

const CALENDAR_VIEW = {
  value: [
    {
      id: 'evt-1',
      subject: 'Sprint Planning',
      start: { dateTime: '2026-08-03T09:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-08-03T10:00:00.0000000', timeZone: 'UTC' },
      isAllDay: false,
      isCancelled: false,
      organizer: { emailAddress: { name: 'PO', address: 'po@example.com' } },
    },
    {
      id: 'evt-2',
      subject: 'Company Holiday',
      start: { dateTime: '2026-08-03T00:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-08-04T00:00:00.0000000', timeZone: 'UTC' },
      isAllDay: true,
      isCancelled: false,
    },
    {
      id: 'evt-3',
      subject: 'Cancelled sync',
      start: { dateTime: '2026-08-03T14:00:00.0000000', timeZone: 'UTC' },
      end: { dateTime: '2026-08-03T14:30:00.0000000', timeZone: 'UTC' },
      isAllDay: false,
      isCancelled: true,
    },
  ],
};

describe('MicrosoftGraphCalendarSource', () => {
  it('maps calendarView events to Meetings, including all-day and cancelled', async () => {
    const transport = new FakeTransport().on('GET', '/me/calendarView', CALENDAR_VIEW);
    const source = new MicrosoftGraphCalendarSource(transport, async () => ({ accessToken: 'tok-123' }));

    const meetings = await source.fetchDay(ACCOUNT, '2026-08-03');

    expect(meetings).toHaveLength(3);
    const planning = meetings.find((m) => m.title === 'Sprint Planning')!;
    expect(planning.organizer).toBe('PO');
    expect(planning.isAllDay).toBe(false);
    expect(planning.status).toBe('Active');
    expect(planning.start).toBe('2026-08-03T09:00:00.0000000Z');

    const holiday = meetings.find((m) => m.title === 'Company Holiday')!;
    expect(holiday.isAllDay).toBe(true);

    const cancelled = meetings.find((m) => m.title === 'Cancelled sync')!;
    expect(cancelled.status).toBe('Cancelled');

    expect(transport.lastRequest().headers?.Authorization).toBe('Bearer tok-123');
  });

  it('throws when no access token can be resolved for the account', async () => {
    const source = new MicrosoftGraphCalendarSource(new FakeTransport(), async () => null);
    await expect(source.fetchDay(ACCOUNT, '2026-08-03')).rejects.toThrow(/access token/i);
  });
});
