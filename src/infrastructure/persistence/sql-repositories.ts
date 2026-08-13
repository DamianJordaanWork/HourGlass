import type { Id, IsoDate } from '@domain/common/types';
import type {
  IAdoConnectionRepository,
  ICalendarAccountRepository,
  IMappingRuleRepository,
  IMeetingRepository,
  INoteRepository,
  IQuickTemplateRepository,
  ISettingsRepository,
  ITimeIntervalRepository,
  IWorkItemSectionRepository,
} from '@domain/ports';
import type { TimeInterval } from '@domain/time/time-interval';
import type { MappingRule } from '@domain/templates/mapping';
import type { WorkItemSection } from '@domain/work-items/work-item-section';
import type { CalendarAccount, Meeting } from '@domain/calendar/meeting';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { Note } from '@domain/notes/note';
import type { AdoConnection } from '@domain/connections/connection';
import { DEFAULT_SETTINGS, type Settings } from '@domain/settings/settings';
import type { ISqlDatabase, ISqlExecutor } from '@infrastructure/persistence/sql/sql-database';
import type { AppRepositories } from '@infrastructure/persistence/app-repositories';
import {
  type AdoConnectionRow,
  adoConnectionParams,
  type CalendarAccountRow,
  calendarAccountParams,
  type MappingConditionRow,
  mappingConditionParams,
  type MappingRuleRow,
  mappingRuleParams,
  type MeetingRow,
  meetingParams,
  type NoteRow,
  noteParams,
  type QuickTemplateRow,
  quickTemplateParams,
  rowToAdoConnection,
  rowToCalendarAccount,
  rowToMappingRule,
  rowToMeeting,
  rowToNote,
  rowToQuickTemplate,
  rowToSettings,
  rowToTimeInterval,
  rowToWorkItemSection,
  type SettingsRow,
  settingsParams,
  type TimeIntervalRow,
  timeIntervalParams,
  type WorkItemSectionConditionRow,
  type WorkItemSectionRow,
  workItemSectionParams,
} from '@infrastructure/persistence/sql/sql-mappers';

class SqlTimeIntervalRepository implements ITimeIntervalRepository {
  constructor(private readonly db: ISqlExecutor) {}

  async listByDate(date: IsoDate): Promise<TimeInterval[]> {
    const rows = await this.db.query<TimeIntervalRow>('SELECT * FROM time_interval WHERE date = ? ORDER BY start_time', [date]);
    return rows.map(rowToTimeInterval);
  }

  async listByRange(from: IsoDate, to: IsoDate): Promise<TimeInterval[]> {
    const rows = await this.db.query<TimeIntervalRow>(
      'SELECT * FROM time_interval WHERE date >= ? AND date <= ? ORDER BY date, start_time',
      [from, to],
    );
    return rows.map(rowToTimeInterval);
  }

  async getRunning(): Promise<TimeInterval | null> {
    const rows = await this.db.query<TimeIntervalRow>('SELECT * FROM time_interval WHERE end_time IS NULL LIMIT 1');
    return rows[0] ? rowToTimeInterval(rows[0]) : null;
  }

  async get(id: Id): Promise<TimeInterval | null> {
    const rows = await this.db.query<TimeIntervalRow>('SELECT * FROM time_interval WHERE id = ?', [id]);
    return rows[0] ? rowToTimeInterval(rows[0]) : null;
  }

  async upsert(interval: TimeInterval): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO time_interval
        (id, date, harvest_project_id, harvest_task_id, project_name, task_name, notes, start_time, end_time,
         is_manual, harvest_time_entry_id, synced_hours, source, work_item_ref, work_item_refs, template_id,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      timeIntervalParams(interval),
    );
  }

  async delete(id: Id): Promise<void> {
    await this.db.execute('DELETE FROM time_interval WHERE id = ?', [id]);
  }
}

class SqlMappingRuleRepository implements IMappingRuleRepository {
  constructor(private readonly db: ISqlDatabase) {}

  async list(): Promise<MappingRule[]> {
    const rules = await this.db.query<MappingRuleRow>('SELECT * FROM mapping_rule ORDER BY priority');
    const conditions = await this.db.query<MappingConditionRow>('SELECT * FROM mapping_condition ORDER BY seq');
    return rules.map((rule) => rowToMappingRule(rule, conditions.filter((c) => c.rule_id === rule.id)));
  }

  async upsert(rule: MappingRule): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT OR REPLACE INTO mapping_rule
          (id, name, rule_type, priority, enabled, harvest_project_id, harvest_task_id, note_template)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        mappingRuleParams(rule),
      );
      await tx.execute('DELETE FROM mapping_condition WHERE rule_id = ?', [rule.id]);
      let seq = 0;
      for (const condition of rule.conditions) {
        await tx.execute(
          'INSERT INTO mapping_condition (rule_id, seq, field, operator, value, negate) VALUES (?, ?, ?, ?, ?, ?)',
          mappingConditionParams(rule.id, seq, condition),
        );
        seq += 1;
      }
    });
  }

  async delete(id: Id): Promise<void> {
    // mapping_condition rows cascade via ON DELETE CASCADE (PRAGMA foreign_keys=ON).
    await this.db.execute('DELETE FROM mapping_rule WHERE id = ?', [id]);
  }
}

class SqlWorkItemSectionRepository implements IWorkItemSectionRepository {
  constructor(private readonly db: ISqlDatabase) {}

  async list(): Promise<WorkItemSection[]> {
    const sections = await this.db.query<WorkItemSectionRow>('SELECT * FROM work_item_section ORDER BY sort_order');
    const conditions = await this.db.query<WorkItemSectionConditionRow>(
      'SELECT * FROM work_item_section_condition ORDER BY seq',
    );
    return sections.map((s) => rowToWorkItemSection(s, conditions.filter((c) => c.section_id === s.id)));
  }

  async upsert(section: WorkItemSection): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        `INSERT OR REPLACE INTO work_item_section
          (id, label, sort_order, enabled, default_collapsed, nest_under_parent, group_by_parent, sort_by, sort_direction)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        workItemSectionParams(section),
      );
      await tx.execute('DELETE FROM work_item_section_condition WHERE section_id = ?', [section.id]);
      let seq = 0;
      for (const condition of section.conditions) {
        await tx.execute(
          'INSERT INTO work_item_section_condition (section_id, seq, field, operator, value, negate) VALUES (?, ?, ?, ?, ?, ?)',
          mappingConditionParams(section.id, seq, condition),
        );
        seq += 1;
      }
    });
  }

  async delete(id: Id): Promise<void> {
    // work_item_section_condition rows cascade via ON DELETE CASCADE.
    await this.db.execute('DELETE FROM work_item_section WHERE id = ?', [id]);
  }
}

class SqlCalendarAccountRepository implements ICalendarAccountRepository {
  constructor(private readonly db: ISqlExecutor) {}

  async list(): Promise<CalendarAccount[]> {
    const rows = await this.db.query<CalendarAccountRow>('SELECT * FROM calendar_account ORDER BY id');
    return rows.map(rowToCalendarAccount);
  }

  async upsert(account: CalendarAccount): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO calendar_account
        (id, provider, display_name, email, color, enabled, ics_url, last_synced_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      calendarAccountParams(account),
    );
  }

  async delete(id: Id): Promise<void> {
    // meeting rows cascade via ON DELETE CASCADE (PRAGMA foreign_keys=ON).
    await this.db.execute('DELETE FROM calendar_account WHERE id = ?', [id]);
  }
}

class SqlMeetingRepository implements IMeetingRepository {
  constructor(private readonly db: ISqlDatabase) {}

  async listByDate(date: IsoDate): Promise<Meeting[]> {
    const rows = await this.db.query<MeetingRow>('SELECT * FROM meeting WHERE date = ? ORDER BY start_time', [date]);
    return rows.map(rowToMeeting);
  }

  async upsertMany(meetings: readonly Meeting[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      for (const meeting of meetings) {
        await tx.execute(
          `INSERT INTO meeting
            (id, calendar_account_id, calendar_name, external_uid, title, organizer, start_time, end_time, date, is_all_day, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(calendar_account_id, external_uid, date) DO UPDATE SET
             id = excluded.id,
             calendar_name = excluded.calendar_name,
             title = excluded.title,
             organizer = excluded.organizer,
             start_time = excluded.start_time,
             end_time = excluded.end_time,
             is_all_day = excluded.is_all_day,
             status = excluded.status`,
          meetingParams(meeting),
        );
      }
    });
  }
}

class SqlQuickTemplateRepository implements IQuickTemplateRepository {
  constructor(private readonly db: ISqlExecutor) {}

  async list(): Promise<QuickTemplate[]> {
    const rows = await this.db.query<QuickTemplateRow>('SELECT * FROM quick_template ORDER BY sort_order');
    return rows.map(rowToQuickTemplate);
  }

  async upsert(template: QuickTemplate): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO quick_template
        (id, label, icon, color, harvest_project_id, harvest_task_id, default_notes, ado_query, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      quickTemplateParams(template),
    );
  }

  async delete(id: Id): Promise<void> {
    await this.db.execute('DELETE FROM quick_template WHERE id = ?', [id]);
  }
}

class SqlNoteRepository implements INoteRepository {
  constructor(private readonly db: ISqlExecutor) {}

  async list(): Promise<Note[]> {
    const rows = await this.db.query<NoteRow>('SELECT * FROM note ORDER BY sort_order');
    return rows.map(rowToNote);
  }

  async upsert(note: Note): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO note (id, content, color, is_wip, is_done, sort_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      noteParams(note),
    );
  }

  async delete(id: Id): Promise<void> {
    await this.db.execute('DELETE FROM note WHERE id = ?', [id]);
  }
}

class SqlAdoConnectionRepository implements IAdoConnectionRepository {
  constructor(private readonly db: ISqlExecutor) {}

  async list(): Promise<AdoConnection[]> {
    const rows = await this.db.query<AdoConnectionRow>('SELECT * FROM ado_connection ORDER BY label');
    return rows.map(rowToAdoConnection);
  }

  async get(id: Id): Promise<AdoConnection | null> {
    const rows = await this.db.query<AdoConnectionRow>('SELECT * FROM ado_connection WHERE id = ?', [id]);
    return rows[0] ? rowToAdoConnection(rows[0]) : null;
  }

  async upsert(connection: AdoConnection): Promise<void> {
    await this.db.execute(
      `INSERT OR REPLACE INTO ado_connection (id, label, org_url, iteration_path, enabled, harvest_guid) VALUES (?, ?, ?, ?, ?, ?)`,
      adoConnectionParams(connection),
    );
  }

  async delete(id: Id): Promise<void> {
    await this.db.execute('DELETE FROM ado_connection WHERE id = ?', [id]);
  }
}

class SqlSettingsRepository implements ISettingsRepository {
  constructor(private readonly db: ISqlExecutor) {}

  async get(): Promise<Settings> {
    const rows = await this.db.query<SettingsRow>('SELECT * FROM settings WHERE id = 1');
    const row = rows[0];
    return row ? { ...DEFAULT_SETTINGS, ...rowToSettings(row) } : DEFAULT_SETTINGS;
  }

  async save(settings: Settings): Promise<Settings> {
    await this.db.execute(
      `INSERT OR REPLACE INTO settings
        (id, work_day_start, work_day_end, break_minutes, min_dead_time_minutes, weekly_goal_hours,
         refresh_interval_minutes, theme, harvest_account_id, microsoft_client_id, google_client_id,
         default_project_id, default_task_id, auto_stop_on_switch, aggregate_same_task_per_day, embed_metadata,
         hg1_scheme, fetch_parent_work_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      settingsParams(settings),
    );
    return settings;
  }
}

/** Wires the SQL repos against a single `ISqlDatabase`. See ADR-014. */
export function createSqlRepositories(db: ISqlDatabase): AppRepositories {
  return {
    intervals: new SqlTimeIntervalRepository(db),
    mappingRules: new SqlMappingRuleRepository(db),
    workItemSections: new SqlWorkItemSectionRepository(db),
    calendarAccounts: new SqlCalendarAccountRepository(db),
    meetings: new SqlMeetingRepository(db),
    quickTemplates: new SqlQuickTemplateRepository(db),
    notes: new SqlNoteRepository(db),
    settings: new SqlSettingsRepository(db),
    adoConnections: new SqlAdoConnectionRepository(db),
  };
}
