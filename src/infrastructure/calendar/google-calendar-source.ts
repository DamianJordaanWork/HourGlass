import type { Id, IsoDate } from '@domain/common/types';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { ICalendarSource, IHttpTransport } from '@domain/ports';

const GOOGLE_EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
}
interface GoogleEventDto {
  id: string;
  iCalUID?: string;
  summary?: string;
  organizer?: { displayName?: string; email?: string };
  start: GoogleEventDateTime;
  end: GoogleEventDateTime;
  status?: string;
}
interface GoogleEventsResponse {
  items: GoogleEventDto[];
}

function toIso(dt: GoogleEventDateTime, isAllDay: boolean): string {
  return isAllDay ? `${dt.date}T00:00:00` : (dt.dateTime as string);
}

function mapEvent(dto: GoogleEventDto, account: CalendarAccount, date: IsoDate): Meeting {
  const isAllDay = dto.start.date !== undefined;
  return {
    id: `gcal-${account.id}-${dto.id}`,
    calendarAccountId: account.id,
    calendarName: account.displayName,
    externalUid: dto.iCalUID ?? dto.id,
    title: dto.summary || '(No title)',
    organizer: dto.organizer?.displayName ?? dto.organizer?.email,
    start: toIso(dto.start, isAllDay),
    end: toIso(dto.end, isAllDay),
    date,
    isAllDay,
    status: dto.status === 'cancelled' ? 'Cancelled' : 'Active',
  };
}

export interface GoogleAccessToken {
  readonly accessToken: string;
}

/** Resolves a calendar account id → its live access token (from secrets, refreshed as needed). */
export type GoogleTokenResolver = (accountId: Id) => Promise<GoogleAccessToken | null>;

/** One instance serves every connected Google account (mirrors `MicrosoftGraphCalendarSource`). */
export class GoogleCalendarSource implements ICalendarSource {
  readonly provider = 'Google' as const;

  constructor(
    private readonly http: IHttpTransport,
    private readonly resolve: GoogleTokenResolver,
  ) {}

  async fetchDay(account: CalendarAccount, date: IsoDate): Promise<Meeting[]> {
    const token = await this.resolve(account.id);
    if (!token) throw new Error(`No access token for calendar account ${account.displayName}`);

    const params = new URLSearchParams({
      singleEvents: 'true',
      orderBy: 'startTime',
      timeMin: `${date}T00:00:00Z`,
      timeMax: `${date}T23:59:59Z`,
      maxResults: '250',
    });
    const res = await this.http.send({
      method: 'GET',
      url: `${GOOGLE_EVENTS_URL}?${params.toString()}`,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Google Calendar events failed (${res.status}): ${res.body}`);
    }
    const dto = JSON.parse(res.body) as GoogleEventsResponse;
    return dto.items.map((e) => mapEvent(e, account, date));
  }
}
