/**
 * Per-entity snake_case row shapes + bidirectional mappers between SQLite rows
 * and domain entities. Conventions: NULL <-> undefined; INTEGER 0/1 <-> boolean;
 * nested objects <-> JSON TEXT. Kept isolated from the repos so the SQL/domain
 * boundary has one obvious place to look (resolves F2 open q#5).
 */
import type { TimeInterval, WorkItemRef } from '@domain/time/time-interval';
import type { MappingCondition, MappingRule } from '@domain/templates/mapping';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { Note } from '@domain/notes/note';
import type { AdoConnection } from '@domain/connections/connection';
import type { Settings } from '@domain/settings/settings';
import type { SqlParam } from '@infrastructure/persistence/sql/sql-database';

export function nullToUndef<T>(v: T | null | undefined): T | undefined {
  return v === null || v === undefined ? undefined : v;
}

export function undefToNull<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

export function intToBool(v: number): boolean {
  return v !== 0;
}

export function boolToInt(v: boolean): number {
  return v ? 1 : 0;
}

function parseJson<T>(raw: string | null): T | undefined {
  return raw === null ? undefined : (JSON.parse(raw) as T);
}

function stringifyJson<T>(value: T | undefined): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

// ── TimeInterval ─────────────────────────────────────────────────────────

export interface TimeIntervalRow {
  readonly id: string;
  readonly date: string;
  readonly harvest_project_id: number | null;
  readonly harvest_task_id: number | null;
  readonly project_name: string | null;
  readonly task_name: string | null;
  readonly notes: string;
  readonly start_time: string;
  readonly end_time: string | null;
  readonly is_manual: number;
  readonly harvest_time_entry_id: number | null;
  readonly synced_hours: number | null;
  readonly source: string;
  readonly work_item_ref: string | null;
  readonly template_id: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export function rowToTimeInterval(row: TimeIntervalRow): TimeInterval {
  return {
    id: row.id,
    date: row.date,
    harvestProjectId: nullToUndef(row.harvest_project_id),
    harvestTaskId: nullToUndef(row.harvest_task_id),
    projectName: nullToUndef(row.project_name),
    taskName: nullToUndef(row.task_name),
    notes: row.notes,
    start: row.start_time,
    end: nullToUndef(row.end_time),
    isManual: intToBool(row.is_manual),
    harvestTimeEntryId: nullToUndef(row.harvest_time_entry_id),
    syncedHours: nullToUndef(row.synced_hours),
    source: row.source as TimeInterval['source'],
    workItemRef: parseJson<WorkItemRef>(row.work_item_ref),
    templateId: nullToUndef(row.template_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function timeIntervalParams(i: TimeInterval): readonly SqlParam[] {
  return [
    i.id,
    i.date,
    undefToNull(i.harvestProjectId),
    undefToNull(i.harvestTaskId),
    undefToNull(i.projectName),
    undefToNull(i.taskName),
    i.notes,
    i.start,
    undefToNull(i.end),
    boolToInt(i.isManual),
    undefToNull(i.harvestTimeEntryId),
    undefToNull(i.syncedHours),
    i.source,
    stringifyJson(i.workItemRef),
    undefToNull(i.templateId),
    i.createdAt,
    i.updatedAt,
  ];
}

// ── MappingRule / MappingCondition ──────────────────────────────────────

export interface MappingRuleRow {
  readonly id: string;
  readonly name: string;
  readonly rule_type: string;
  readonly priority: number;
  readonly enabled: number;
  readonly harvest_project_id: number;
  readonly harvest_task_id: number;
  readonly note_template: string | null;
}

export interface MappingConditionRow {
  readonly rule_id: string;
  readonly seq: number;
  readonly field: string;
  readonly operator: string;
  readonly value: string;
  readonly negate: number;
}

export function rowToMappingRule(row: MappingRuleRow, conditionRows: readonly MappingConditionRow[]): MappingRule {
  return {
    id: row.id,
    name: row.name,
    ruleType: row.rule_type as MappingRule['ruleType'],
    priority: row.priority,
    enabled: intToBool(row.enabled),
    conditions: conditionRows
      .slice()
      .sort((a, b) => a.seq - b.seq)
      .map(rowToMappingCondition),
    target: {
      harvestProjectId: row.harvest_project_id,
      harvestTaskId: row.harvest_task_id,
      noteTemplate: nullToUndef(row.note_template),
    },
  };
}

export function mappingRuleParams(r: MappingRule): readonly SqlParam[] {
  return [
    r.id,
    r.name,
    r.ruleType,
    r.priority,
    boolToInt(r.enabled),
    r.target.harvestProjectId,
    r.target.harvestTaskId,
    undefToNull(r.target.noteTemplate),
  ];
}

export function rowToMappingCondition(row: MappingConditionRow): MappingCondition {
  return {
    field: row.field,
    operator: row.operator as MappingCondition['operator'],
    value: row.value,
    negate: row.negate !== 0 ? true : undefined,
  };
}

export function mappingConditionParams(ruleId: string, seq: number, c: MappingCondition): readonly SqlParam[] {
  return [ruleId, seq, c.field, c.operator, c.value, boolToInt(c.negate ?? false)];
}

// ── CalendarAccount ──────────────────────────────────────────────────────

export interface CalendarAccountRow {
  readonly id: string;
  readonly provider: string;
  readonly display_name: string;
  readonly email: string | null;
  readonly color: string | null;
  readonly enabled: number;
  readonly ics_url: string | null;
  readonly last_synced_at: string | null;
}

export function rowToCalendarAccount(row: CalendarAccountRow): CalendarAccount {
  return {
    id: row.id,
    provider: row.provider as CalendarAccount['provider'],
    displayName: row.display_name,
    email: nullToUndef(row.email),
    color: nullToUndef(row.color),
    enabled: intToBool(row.enabled),
    icsUrl: nullToUndef(row.ics_url),
    lastSyncedAt: nullToUndef(row.last_synced_at),
  };
}

export function calendarAccountParams(a: CalendarAccount): readonly SqlParam[] {
  return [
    a.id,
    a.provider,
    a.displayName,
    undefToNull(a.email),
    undefToNull(a.color),
    boolToInt(a.enabled),
    undefToNull(a.icsUrl),
    undefToNull(a.lastSyncedAt),
  ];
}

// ── Meeting ──────────────────────────────────────────────────────────────

export interface MeetingRow {
  readonly id: string;
  readonly calendar_account_id: string;
  readonly calendar_name: string;
  readonly external_uid: string;
  readonly title: string;
  readonly organizer: string | null;
  readonly start_time: string;
  readonly end_time: string;
  readonly date: string;
  readonly is_all_day: number;
  readonly status: string;
}

export function rowToMeeting(row: MeetingRow): Meeting {
  return {
    id: row.id,
    calendarAccountId: row.calendar_account_id,
    calendarName: row.calendar_name,
    externalUid: row.external_uid,
    title: row.title,
    organizer: nullToUndef(row.organizer),
    start: row.start_time,
    end: row.end_time,
    date: row.date,
    isAllDay: intToBool(row.is_all_day),
    status: row.status as Meeting['status'],
  };
}

export function meetingParams(m: Meeting): readonly SqlParam[] {
  return [
    m.id,
    m.calendarAccountId,
    m.calendarName,
    m.externalUid,
    m.title,
    undefToNull(m.organizer),
    m.start,
    m.end,
    m.date,
    boolToInt(m.isAllDay),
    m.status,
  ];
}

// ── QuickTemplate ────────────────────────────────────────────────────────

export interface QuickTemplateRow {
  readonly id: string;
  readonly label: string;
  readonly icon: string | null;
  readonly color: string | null;
  readonly harvest_project_id: number | null;
  readonly harvest_task_id: number | null;
  readonly default_notes: string | null;
  readonly ado_query: string | null;
  readonly sort_order: number;
  readonly enabled: number;
}

export function rowToQuickTemplate(row: QuickTemplateRow): QuickTemplate {
  return {
    id: row.id,
    label: row.label,
    icon: nullToUndef(row.icon),
    color: nullToUndef(row.color),
    harvestProjectId: nullToUndef(row.harvest_project_id),
    harvestTaskId: nullToUndef(row.harvest_task_id),
    defaultNotes: nullToUndef(row.default_notes),
    adoQuery: nullToUndef(row.ado_query),
    sortOrder: row.sort_order,
    enabled: intToBool(row.enabled),
  };
}

export function quickTemplateParams(t: QuickTemplate): readonly SqlParam[] {
  return [
    t.id,
    t.label,
    undefToNull(t.icon),
    undefToNull(t.color),
    undefToNull(t.harvestProjectId),
    undefToNull(t.harvestTaskId),
    undefToNull(t.defaultNotes),
    undefToNull(t.adoQuery),
    t.sortOrder,
    boolToInt(t.enabled),
  ];
}

// ── Note ─────────────────────────────────────────────────────────────────

export interface NoteRow {
  readonly id: string;
  readonly content: string;
  readonly color: string;
  readonly is_wip: number;
  readonly is_done: number;
  readonly sort_order: number;
  readonly created_at: string;
}

export function rowToNote(row: NoteRow): Note {
  return {
    id: row.id,
    content: row.content,
    color: row.color as Note['color'],
    isWip: intToBool(row.is_wip),
    isDone: intToBool(row.is_done),
    sortOrder: row.sort_order,
    createdAt: row.created_at,
  };
}

export function noteParams(n: Note): readonly SqlParam[] {
  return [n.id, n.content, n.color, boolToInt(n.isWip), boolToInt(n.isDone), n.sortOrder, n.createdAt];
}

// ── AdoConnection ────────────────────────────────────────────────────────

export interface AdoConnectionRow {
  readonly id: string;
  readonly label: string;
  readonly org_url: string;
  readonly iteration_path: string | null;
  readonly enabled: number;
  readonly harvest_guid: string | null;
}

export function rowToAdoConnection(row: AdoConnectionRow): AdoConnection {
  return {
    id: row.id,
    label: row.label,
    orgUrl: row.org_url,
    iterationPath: nullToUndef(row.iteration_path),
    enabled: intToBool(row.enabled),
    harvestGuid: nullToUndef(row.harvest_guid),
  };
}

export function adoConnectionParams(c: AdoConnection): readonly SqlParam[] {
  return [c.id, c.label, c.orgUrl, undefToNull(c.iterationPath), boolToInt(c.enabled), undefToNull(c.harvestGuid)];
}

// ── Settings ─────────────────────────────────────────────────────────────

export interface SettingsRow {
  readonly id: number;
  readonly work_day_start: string;
  readonly work_day_end: string;
  readonly break_minutes: number;
  readonly min_dead_time_minutes: number;
  readonly weekly_goal_hours: number;
  readonly refresh_interval_minutes: number;
  readonly theme: string;
  readonly harvest_account_id: string | null;
  readonly microsoft_client_id: string | null;
  readonly google_client_id: string | null;
  readonly default_project_id: number | null;
  readonly default_task_id: number | null;
  readonly auto_stop_on_switch: number;
  readonly aggregate_same_task_per_day: number;
  readonly embed_metadata: number;
  readonly hg1_scheme: string;
}

export function rowToSettings(row: SettingsRow): Settings {
  return {
    workDayStart: row.work_day_start,
    workDayEnd: row.work_day_end,
    breakMinutes: row.break_minutes,
    minDeadTimeMinutes: row.min_dead_time_minutes,
    weeklyGoalHours: row.weekly_goal_hours,
    refreshIntervalMinutes: row.refresh_interval_minutes,
    theme: row.theme as Settings['theme'],
    harvestAccountId: nullToUndef(row.harvest_account_id),
    microsoftClientId: nullToUndef(row.microsoft_client_id),
    googleClientId: nullToUndef(row.google_client_id),
    defaultProjectId: nullToUndef(row.default_project_id),
    defaultTaskId: nullToUndef(row.default_task_id),
    autoStopOnSwitch: intToBool(row.auto_stop_on_switch),
    aggregateSameTaskPerDay: intToBool(row.aggregate_same_task_per_day),
    embedMetadata: intToBool(row.embed_metadata),
    hg1Scheme: row.hg1_scheme as Settings['hg1Scheme'],
  };
}

export function settingsParams(s: Settings): readonly SqlParam[] {
  return [
    1,
    s.workDayStart,
    s.workDayEnd,
    s.breakMinutes,
    s.minDeadTimeMinutes,
    s.weeklyGoalHours,
    s.refreshIntervalMinutes,
    s.theme,
    undefToNull(s.harvestAccountId),
    undefToNull(s.microsoftClientId),
    undefToNull(s.googleClientId),
    undefToNull(s.defaultProjectId),
    undefToNull(s.defaultTaskId),
    boolToInt(s.autoStopOnSwitch),
    boolToInt(s.aggregateSameTaskPerDay),
    boolToInt(s.embedMetadata),
    s.hg1Scheme,
  ];
}
