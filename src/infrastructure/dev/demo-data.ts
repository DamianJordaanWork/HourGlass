import type { IsoDate } from '@domain/common/types';
import type { WorkItem } from '@domain/work-items/work-item';
import type { Meeting } from '@domain/calendar/meeting';
import type { MappingRule } from '@domain/templates/mapping';
import type { QuickTemplate } from '@domain/templates/quick-template';
import type { LocalRepositories } from '@infrastructure/persistence/local-repositories';

const CONN = 'demo';

export const demoWorkItems: WorkItem[] = [
  { id: 4821, title: 'Fix login redirect loop', workItemType: 'Bug', state: 'Active', project: 'LetsDrive', iterationPath: 'LetsDrive\\Sprint 12', areaPath: 'LetsDrive\\Web\\Auth', assignedTo: 'Damian', tags: ['frontend', 'urgent'], connectionId: CONN, url: 'https://dev.azure.com/agile-bridge/LetsDrive/_workitems/edit/4821' },
  { id: 4830, title: 'Driver onboarding wizard — step 3 validation', workItemType: 'User Story', state: 'Active', project: 'LetsDrive', iterationPath: 'LetsDrive\\Sprint 12', areaPath: 'LetsDrive\\Web', assignedTo: 'Damian', tags: ['frontend'], connectionId: CONN, url: 'https://dev.azure.com/agile-bridge/LetsDrive/_workitems/edit/4830' },
  { id: 5102, title: 'TFN payment reconciliation job', workItemType: 'User Story', state: 'New', project: 'TFN Project', iterationPath: 'TFN Project\\Sprint 8', areaPath: 'TFN Project\\Backend', assignedTo: 'Damian', tags: ['backend'], connectionId: CONN, url: 'https://dev.azure.com/agile-bridge/TFN%20Project/_workitems/edit/5102' },
  { id: 6001, title: 'Grad 2026 — mentor pairing algorithm', workItemType: 'Task', state: 'Active', project: 'Grad2026', iterationPath: 'Grad2026\\Onboarding', areaPath: 'Grad2026', assignedTo: 'Damian', tags: [], connectionId: CONN, url: 'https://dev.azure.com/agile-bridge/Grad2026/_workitems/edit/6001' },
];

export function demoMeetings(date: IsoDate): Meeting[] {
  const at = (h: number, m = 0) => `${date}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`;
  return [
    { id: `m-${date}-standup`, calendarAccountId: 'demo-outlook', calendarName: 'Work (Outlook)', externalUid: 'standup', title: 'Daily Standup', organizer: 'Scrum Master', start: at(9), end: at(9, 15), date, isAllDay: false, status: 'Active' },
    { id: `m-${date}-review`, calendarAccountId: 'demo-outlook', calendarName: 'Work (Outlook)', externalUid: 'review', title: 'LetsDrive Sprint Review', organizer: 'PO', start: at(14), end: at(15), date, isAllDay: false, status: 'Active' },
    { id: `m-${date}-1on1`, calendarAccountId: 'demo-gmail', calendarName: 'Personal (Gmail)', externalUid: '1on1', title: '1:1 with Lead', organizer: 'Team Lead', start: at(16, 30), end: at(17), date, isAllDay: false, status: 'Active' },
  ];
}

const demoMappingRules: MappingRule[] = [
  { id: 'rule-letsdrive', name: 'LetsDrive → Development', ruleType: 'WorkItem', priority: 10, enabled: true, conditions: [{ field: 'project', operator: 'equals', value: 'LetsDrive' }], target: { harvestProjectId: 1001, harvestTaskId: 10 } },
  { id: 'rule-tfn', name: 'TFN → Development', ruleType: 'WorkItem', priority: 20, enabled: true, conditions: [{ field: 'project', operator: 'equals', value: 'TFN Project' }], target: { harvestProjectId: 1002, harvestTaskId: 10 } },
  { id: 'rule-standup', name: 'Standups → Meetings', ruleType: 'Meeting', priority: 10, enabled: true, conditions: [{ field: 'title', operator: 'regex', value: 'standup|stand-up|scrum' }], target: { harvestProjectId: 1001, harvestTaskId: 20 } },
  { id: 'rule-review', name: 'Reviews → Meetings', ruleType: 'Meeting', priority: 20, enabled: true, conditions: [{ field: 'title', operator: 'contains', value: 'review' }], target: { harvestProjectId: 1001, harvestTaskId: 20 } },
];

const demoQuickTemplates: QuickTemplate[] = [
  { id: 'qt-pr', label: 'PR Reviews', icon: '🔍', color: '#6366F1', harvestProjectId: 1001, harvestTaskId: 30, defaultNotes: 'Reviewing pull requests', sortOrder: 1, enabled: true },
  { id: 'qt-standup', label: 'Standup', icon: '🗣️', color: '#14B8A6', harvestProjectId: 1001, harvestTaskId: 20, defaultNotes: 'Daily standup', sortOrder: 2, enabled: true },
  { id: 'qt-admin', label: 'Admin / Email', icon: '✉️', color: '#F59E0B', harvestProjectId: 1003, harvestTaskId: 40, defaultNotes: '', sortOrder: 3, enabled: true },
];

/** Seed mapping rules + quick templates the first time (so the rail is meaningful). */
export async function seedDemo(repos: LocalRepositories): Promise<void> {
  if ((await repos.mappingRules.list()).length === 0) {
    for (const r of demoMappingRules) await repos.mappingRules.upsert(r);
  }
  if ((await repos.quickTemplates.list()).length === 0) {
    for (const t of demoQuickTemplates) await repos.quickTemplates.upsert(t);
  }
}

const DEMO_RULE_IDS = new Set(demoMappingRules.map((r) => r.id));
const DEMO_TEMPLATE_IDS = new Set(demoQuickTemplates.map((t) => t.id));
/** Placeholder Harvest project ids used by the seeded samples (never real). */
const PLACEHOLDER_HARVEST_IDS = new Set<number>([
  ...demoMappingRules.map((r) => r.target.harvestProjectId),
  ...demoQuickTemplates.map((t) => t.harvestProjectId).filter((id): id is number => id !== undefined),
]);

/**
 * Remove seeded sample rules/templates that still point at placeholder Harvest
 * ids. Runs once a real connection exists so live tracking never tries to sync
 * to a non-existent Harvest project (which Harvest rejects with a 422). Rules
 * the user has re-targeted to a real project id are left untouched.
 */
export async function clearBrokenDemoSeed(repos: LocalRepositories): Promise<number> {
  let removed = 0;
  for (const r of await repos.mappingRules.list()) {
    if (DEMO_RULE_IDS.has(r.id) && PLACEHOLDER_HARVEST_IDS.has(r.target.harvestProjectId)) {
      await repos.mappingRules.delete(r.id);
      removed++;
    }
  }
  for (const t of await repos.quickTemplates.list()) {
    if (DEMO_TEMPLATE_IDS.has(t.id) && t.harvestProjectId !== undefined && PLACEHOLDER_HARVEST_IDS.has(t.harvestProjectId)) {
      await repos.quickTemplates.delete(t.id);
      removed++;
    }
  }
  return removed;
}

/** Map a demo Harvest project id → a friendly name for display. */
export const demoProjectNames: Record<number, { project: string; tasks: Record<number, string> }> = {
  1001: { project: 'LetsDrive', tasks: { 10: 'Development', 20: 'Meetings', 30: 'Code Review' } },
  1002: { project: 'TFN Project', tasks: { 10: 'Development' } },
  1003: { project: 'Internal', tasks: { 40: 'Admin' } },
};
