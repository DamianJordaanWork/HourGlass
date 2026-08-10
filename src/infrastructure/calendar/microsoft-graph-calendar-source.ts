import type { Id, IsoDate } from '@domain/common/types';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { ICalendarSource, IHttpTransport } from '@domain/ports';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

interface GraphAttendee {
  emailAddress?: { name?: string; address?: string };
}
interface GraphDateTimeTimeZone {
  dateTime: string;
  timeZone: string;
}
interface GraphEventDto {
  id: string;
  subject: string;
  start: GraphDateTimeTimeZone;
  end: GraphDateTimeTimeZone;
  isAllDay: boolean;
  isCancelled: boolean;
  organizer?: { emailAddress?: { name?: string; address?: string } };
  attendees?: GraphAttendee[];
}
interface CalendarViewResponse {
  value: GraphEventDto[];
}

/** Graph returns local wall-clock times tagged with a timeZone (not UTC offsets). */
function toIso(dt: GraphDateTimeTimeZone): string {
  const suffix = dt.timeZone === 'UTC' ? 'Z' : '';
  return `${dt.dateTime}${suffix}`;
}

function mapEvent(dto: GraphEventDto, account: CalendarAccount, date: IsoDate): Meeting {
  return {
    id: `graph-${account.id}-${dto.id}`,
    calendarAccountId: account.id,
    calendarName: account.displayName,
    externalUid: dto.id,
    title: dto.subject || '(No title)',
    organizer: dto.organizer?.emailAddress?.name ?? dto.organizer?.emailAddress?.address,
    start: toIso(dto.start),
    end: toIso(dto.end),
    date,
    isAllDay: dto.isAllDay,
    status: dto.isCancelled ? 'Cancelled' : 'Active',
  };
}

export interface GraphAccessToken {
  readonly accessToken: string;
}

/** Resolves a calendar account id → its live access token (from secrets, refreshed as needed). */
export type GraphTokenResolver = (accountId: Id) => Promise<GraphAccessToken | null>;

/** One instance serves every connected Microsoft account (like `AzureDevOpsClient`). */
export class MicrosoftGraphCalendarSource implements ICalendarSource {
  readonly provider = 'Microsoft' as const;

  constructor(
    private readonly http: IHttpTransport,
    private readonly resolve: GraphTokenResolver,
  ) {}

  async fetchDay(account: CalendarAccount, date: IsoDate): Promise<Meeting[]> {
    const token = await this.resolve(account.id);
    if (!token) throw new Error(`No access token for calendar account ${account.displayName}`);

    const start = `${date}T00:00:00`;
    const end = `${date}T23:59:59`;
    const url = `${GRAPH_BASE}/me/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=100`;
    const res = await this.http.send({
      method: 'GET',
      url,
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        Prefer: 'outlook.timezone="UTC"',
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Graph calendarView failed (${res.status}): ${res.body}`);
    }
    const dto = JSON.parse(res.body) as CalendarViewResponse;
    return dto.value.map((e) => mapEvent(e, account, date));
  }
}
