import type { HarvestProjectId, HarvestTaskId, Id } from '@domain/common/types';

/**
 * The templating engine — the headline feature. A MappingRule maps an Azure
 * DevOps work item or a calendar meeting onto a Harvest project/task when its
 * conditions match. Pure and deterministic; no I/O.
 */

export type RuleType = 'WorkItem' | 'Meeting';

export type ConditionOperator =
  | 'equals' // exact, case-insensitive
  | 'contains' // substring, case-insensitive
  | 'startsWith' // prefix, case-insensitive
  | 'regex' // JS regex, case-insensitive by default
  | 'in' // field ∈ comma-separated list (case-insensitive, trimmed)
  | 'underPath'; // field is at or below a `\` / `/` delimited path (iteration/area)

export interface MappingCondition {
  /** Context field name (see WorkItem/Meeting field constants below). */
  readonly field: string;
  readonly operator: ConditionOperator;
  readonly value: string;
  /** Invert the result of this single condition. */
  readonly negate?: boolean;
}

export interface MappingTarget {
  readonly harvestProjectId: HarvestProjectId;
  readonly harvestTaskId: HarvestTaskId;
  /** Optional note prefilled when this rule matches. */
  readonly noteTemplate?: string;
}

export interface MappingRule {
  readonly id: Id;
  readonly name: string;
  readonly ruleType: RuleType;
  /** Lower number = evaluated first. First fully-matching rule wins. */
  readonly priority: number;
  readonly enabled: boolean;
  /** ALL conditions must match (logical AND). Empty = matches everything. */
  readonly conditions: readonly MappingCondition[];
  readonly target: MappingTarget;
}

/** Field name → value(s). Arrays (e.g. tags) match if ANY element satisfies the operator. */
export type MatchContext = Readonly<Record<string, string | readonly string[] | undefined>>;

/** Canonical context field names. */
export const WorkItemField = {
  project: 'project',
  iterationPath: 'iterationPath',
  areaPath: 'areaPath',
  workItemType: 'workItemType',
  state: 'state',
  tags: 'tags',
  title: 'title',
  assignedTo: 'assignedTo',
  id: 'id',
} as const;

export const MeetingField = {
  title: 'title',
  calendarName: 'calendarName',
  organizer: 'organizer',
} as const;

export interface MappingMatch {
  readonly rule: MappingRule;
  readonly target: MappingTarget;
}

const norm = (s: string): string => s.trim().toLowerCase();

/** Split an ADO path on either separator and drop empty segments. */
const segments = (path: string): string[] =>
  path
    .split(/[\\/]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

function matchesUnderPath(fieldValue: string, target: string): boolean {
  const f = segments(fieldValue).map(norm);
  const t = segments(target).map(norm);
  if (t.length === 0) return true;
  if (t.length > f.length) return false;
  return t.every((seg, i) => seg === f[i]);
}

function matchesScalar(op: ConditionOperator, fieldValue: string, condValue: string): boolean {
  switch (op) {
    case 'equals':
      return norm(fieldValue) === norm(condValue);
    case 'contains':
      return norm(fieldValue).includes(norm(condValue));
    case 'startsWith':
      return norm(fieldValue).startsWith(norm(condValue));
    case 'in':
      return condValue
        .split(',')
        .map(norm)
        .filter((v) => v.length > 0)
        .includes(norm(fieldValue));
    case 'underPath':
      return matchesUnderPath(fieldValue, condValue);
    case 'regex':
      try {
        return new RegExp(condValue, 'i').test(fieldValue);
      } catch {
        // A malformed pattern never matches (validation surfaces the error elsewhere).
        return false;
      }
  }
}

function conditionMatches(condition: MappingCondition, context: MatchContext): boolean {
  const raw = context[condition.field];
  let result: boolean;
  if (raw === undefined) {
    result = false;
  } else if (Array.isArray(raw)) {
    result = raw.some((v) => matchesScalar(condition.operator, v, condition.value));
  } else {
    result = matchesScalar(condition.operator, raw as string, condition.value);
  }
  return condition.negate ? !result : result;
}

export const TemplateMatcher = {
  /** True if every condition matches (empty conditions ⇒ true). */
  ruleMatches(rule: MappingRule, context: MatchContext): boolean {
    return rule.conditions.every((c) => conditionMatches(c, context));
  },

  /**
   * Resolve the first enabled rule of `ruleType` (by ascending priority) whose
   * conditions all match. Returns null when nothing matches.
   */
  resolve(ruleType: RuleType, context: MatchContext, rules: readonly MappingRule[]): MappingMatch | null {
    const candidates = rules
      .filter((r) => r.enabled && r.ruleType === ruleType)
      .slice()
      .sort((a, b) => a.priority - b.priority);
    for (const rule of candidates) {
      if (this.ruleMatches(rule, context)) return { rule, target: rule.target };
    }
    return null;
  },
} as const;
