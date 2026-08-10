/**
 * SQLite schema v1 — 10 tables reconciled 1:1 against the REAL domain
 * entities (not the original master-plan sketch). See ADR-013 for the list
 * of corrections made during reconciliation.
 *
 * Conventions: booleans -> INTEGER 0/1; uuid Id -> TEXT; Harvest ids ->
 * INTEGER; ISO dates/datetimes -> TEXT; nested objects -> TEXT (JSON).
 */

export const SCHEMA_V1: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS time_interval (
    id TEXT PRIMARY KEY,
    date TEXT NOT NULL,
    harvest_project_id INTEGER,
    harvest_task_id INTEGER,
    project_name TEXT,
    task_name TEXT,
    notes TEXT NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT,
    is_manual INTEGER NOT NULL,
    harvest_time_entry_id INTEGER,
    synced_hours REAL,
    source TEXT NOT NULL,
    work_item_ref TEXT,
    template_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_time_interval_date ON time_interval (date)`,
  `CREATE INDEX IF NOT EXISTS idx_time_interval_running ON time_interval (end_time) WHERE end_time IS NULL`,

  `CREATE TABLE IF NOT EXISTS mapping_rule (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    rule_type TEXT NOT NULL,
    priority INTEGER NOT NULL,
    enabled INTEGER NOT NULL,
    harvest_project_id INTEGER NOT NULL,
    harvest_task_id INTEGER NOT NULL,
    note_template TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS mapping_condition (
    rule_id TEXT NOT NULL REFERENCES mapping_rule(id) ON DELETE CASCADE,
    seq INTEGER NOT NULL,
    field TEXT NOT NULL,
    operator TEXT NOT NULL,
    value TEXT NOT NULL,
    negate INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (rule_id, seq)
  )`,

  `CREATE TABLE IF NOT EXISTS quick_template (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    icon TEXT,
    color TEXT,
    harvest_project_id INTEGER,
    harvest_task_id INTEGER,
    default_notes TEXT,
    ado_query TEXT,
    sort_order INTEGER NOT NULL,
    enabled INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS calendar_account (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    email TEXT,
    color TEXT,
    enabled INTEGER NOT NULL,
    ics_url TEXT,
    last_synced_at TEXT
  )`,

  `CREATE TABLE IF NOT EXISTS meeting (
    id TEXT PRIMARY KEY,
    calendar_account_id TEXT NOT NULL REFERENCES calendar_account(id) ON DELETE CASCADE,
    calendar_name TEXT NOT NULL,
    external_uid TEXT NOT NULL,
    title TEXT NOT NULL,
    organizer TEXT,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    date TEXT NOT NULL,
    is_all_day INTEGER NOT NULL,
    status TEXT NOT NULL,
    UNIQUE (calendar_account_id, external_uid, date)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meeting_date ON meeting (date)`,

  `CREATE TABLE IF NOT EXISTS note (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    color TEXT NOT NULL,
    is_wip INTEGER NOT NULL,
    is_done INTEGER NOT NULL,
    sort_order INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS note_status (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS ado_connection (
    id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    org_url TEXT NOT NULL,
    iteration_path TEXT,
    enabled INTEGER NOT NULL
  )`,

  `CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    work_day_start TEXT NOT NULL,
    work_day_end TEXT NOT NULL,
    break_minutes INTEGER NOT NULL,
    min_dead_time_minutes INTEGER NOT NULL,
    weekly_goal_hours INTEGER NOT NULL,
    refresh_interval_minutes INTEGER NOT NULL,
    theme TEXT NOT NULL,
    harvest_account_id TEXT,
    microsoft_client_id TEXT,
    default_project_id INTEGER,
    default_task_id INTEGER,
    auto_stop_on_switch INTEGER NOT NULL,
    aggregate_same_task_per_day INTEGER NOT NULL,
    embed_metadata INTEGER NOT NULL,
    hg1_scheme TEXT NOT NULL
  )`,
];
