import { describe, it, expect } from 'vitest';
import {
  TemplateMatcher,
  type MappingRule,
  type MappingCondition,
  type MatchContext,
} from './mapping';

function rule(partial: Partial<MappingRule> & { conditions: MappingCondition[] }): MappingRule {
  return {
    id: partial.id ?? 'r1',
    name: partial.name ?? 'rule',
    ruleType: partial.ruleType ?? 'WorkItem',
    priority: partial.priority ?? 100,
    enabled: partial.enabled ?? true,
    conditions: partial.conditions,
    target: partial.target ?? { harvestProjectId: 1, harvestTaskId: 2 },
  };
}

const ctx: MatchContext = {
  project: 'LetsDrive',
  iterationPath: 'LetsDrive\\Sprint 12',
  areaPath: 'LetsDrive/Web/Auth',
  workItemType: 'User Story',
  state: 'Active',
  tags: ['frontend', 'urgent'],
  title: 'Fix login redirect',
  assignedTo: 'Damian',
  id: '4821',
};

describe('TemplateMatcher — operators', () => {
  it('equals is case-insensitive', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'project', operator: 'equals', value: 'letsdrive' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'project', operator: 'equals', value: 'other' }] }), ctx)).toBe(false);
  });

  it('contains matches substrings', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'title', operator: 'contains', value: 'login' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'title', operator: 'contains', value: 'logout' }] }), ctx)).toBe(false);
  });

  it('startsWith matches prefixes', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'title', operator: 'startsWith', value: 'Fix' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'title', operator: 'startsWith', value: 'redirect' }] }), ctx)).toBe(false);
  });

  it('regex matches case-insensitively and survives bad patterns', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'title', operator: 'regex', value: 'log(in|out)' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'title', operator: 'regex', value: '^(unclosed' }] }), ctx)).toBe(false);
  });

  it('in checks membership of a comma list', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'state', operator: 'in', value: 'New, Active, Resolved' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'state', operator: 'in', value: 'New, Closed' }] }), ctx)).toBe(false);
  });

  it('underPath respects path boundaries and both separators', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'iterationPath', operator: 'underPath', value: 'LetsDrive' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'areaPath', operator: 'underPath', value: 'LetsDrive/Web' }] }), ctx)).toBe(true);
    // partial segment name must not match
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'project', operator: 'underPath', value: 'Lets' }] }), ctx)).toBe(false);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'areaPath', operator: 'underPath', value: 'LetsDrive/Api' }] }), ctx)).toBe(false);
  });
});

describe('TemplateMatcher — arrays, negate, AND', () => {
  it('array field matches if ANY element satisfies the operator', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'tags', operator: 'equals', value: 'urgent' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'tags', operator: 'contains', value: 'front' }] }), ctx)).toBe(true);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'tags', operator: 'equals', value: 'backend' }] }), ctx)).toBe(false);
  });

  it('negate inverts a single condition', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'state', operator: 'equals', value: 'Closed', negate: true }] }), ctx)).toBe(true);
  });

  it('all conditions must match (AND)', () => {
    const r = rule({
      conditions: [
        { field: 'project', operator: 'equals', value: 'LetsDrive' },
        { field: 'workItemType', operator: 'equals', value: 'Bug' },
      ],
    });
    expect(TemplateMatcher.ruleMatches(r, ctx)).toBe(false);
  });

  it('missing field never matches (unless negated)', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'nope', operator: 'equals', value: 'x' }] }), ctx)).toBe(false);
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [{ field: 'nope', operator: 'equals', value: 'x', negate: true }] }), ctx)).toBe(true);
  });

  it('empty conditions match everything', () => {
    expect(TemplateMatcher.ruleMatches(rule({ conditions: [] }), ctx)).toBe(true);
  });
});

describe('TemplateMatcher — resolve', () => {
  it('returns first match by ascending priority', () => {
    const rules: MappingRule[] = [
      rule({ id: 'low', priority: 200, conditions: [{ field: 'project', operator: 'equals', value: 'LetsDrive' }], target: { harvestProjectId: 9, harvestTaskId: 9 } }),
      rule({ id: 'high', priority: 10, conditions: [{ field: 'project', operator: 'equals', value: 'LetsDrive' }], target: { harvestProjectId: 1, harvestTaskId: 1 } }),
    ];
    expect(TemplateMatcher.resolve('WorkItem', ctx, rules)?.rule.id).toBe('high');
  });

  it('ignores disabled rules and the wrong rule type', () => {
    const rules: MappingRule[] = [
      rule({ id: 'disabled', priority: 1, enabled: false, conditions: [] }),
      rule({ id: 'meeting', priority: 2, ruleType: 'Meeting', conditions: [] }),
      rule({ id: 'ok', priority: 3, conditions: [] }),
    ];
    expect(TemplateMatcher.resolve('WorkItem', ctx, rules)?.rule.id).toBe('ok');
  });

  it('returns null when nothing matches', () => {
    const rules: MappingRule[] = [rule({ conditions: [{ field: 'project', operator: 'equals', value: 'Nope' }] })];
    expect(TemplateMatcher.resolve('WorkItem', ctx, rules)).toBeNull();
  });
});
