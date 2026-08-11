import { useMemo, useState, type ReactNode } from 'react';
import type { HarvestProject } from '@domain/harvest/harvest-types';
import type {
  ConditionOperator,
  MappingCondition,
  MappingRule,
  RuleType,
} from '@domain/templates/mapping';
import { MeetingField, WorkItemField } from '@domain/templates/mapping';
import type { QuickTemplate } from '@domain/templates/quick-template';
import { HarvestPicker } from '@presentation/components/harvest-picker';
import {
  useHarvestOptions,
  useMappingRules,
  useTemplateActions,
  useTemplatesData,
} from '@presentation/hooks/use-templates';

const OPERATORS: ConditionOperator[] = ['equals', 'contains', 'startsWith', 'regex', 'in', 'underPath'];

const inputCls =
  'rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary';
const selectCls = inputCls + ' cursor-pointer';
const primaryBtn =
  'rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50';
const ghostBtn = 'rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-muted hover:text-ink';
const smallGhost = 'rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-ink';

export function TemplatesPane() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <h2 className="text-lg font-semibold">Templates &amp; mapping</h2>
      <MappingRulesSection />
      <QuickTemplatesSection />
    </div>
  );
}

function Card({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function labelCls(text: string) {
  return <span className="text-xs font-medium text-muted">{text}</span>;
}

// ── Mapping rules ───────────────────────────────────────────────────────────
function conditionSummary(rule: MappingRule): string {
  if (rule.conditions.length === 0) return 'matches everything';
  return rule.conditions
    .map((c) => `${c.negate ? 'NOT ' : ''}${c.field} ${c.operator} "${c.value}"`)
    .join(' AND ');
}

function MappingRulesSection() {
  const { data: rules } = useMappingRules();
  const { data: options } = useHarvestOptions();
  const actions = useTemplateActions();
  const [editing, setEditing] = useState<MappingRule | null>(null);
  const opts = options ?? [];

  const blank = (): MappingRule => ({
    id: actions.newId(),
    name: '',
    ruleType: 'WorkItem',
    priority: (rules?.length ?? 0) * 10 + 10,
    enabled: true,
    conditions: [],
    target: { harvestProjectId: opts[0]?.id ?? 0, harvestTaskId: opts[0]?.tasks[0]?.id ?? 0 },
  });

  return (
    <Card
      title="Mapping rules"
      subtitle="First enabled rule (by priority) whose conditions all match wins. Empty conditions match everything."
      action={
        !editing && (
          <button className={primaryBtn} onClick={() => setEditing(blank())}>
            New rule
          </button>
        )
      }
    >
      {editing ? (
        <RuleEditor
          key={editing.id}
          initial={editing}
          options={opts}
          onCancel={() => setEditing(null)}
          onSave={(rule) => {
            actions.saveRule.mutate(rule, { onSuccess: () => setEditing(null) });
          }}
        />
      ) : !rules?.length ? (
        <Empty>No mapping rules yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas px-3 py-2">
              <span className="w-8 shrink-0 text-center text-xs tabular text-muted">{r.priority}</span>
              <span className={'shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ' + (r.ruleType === 'WorkItem' ? 'bg-primary-soft text-primary-soft-text' : 'bg-accent-soft text-accent-soft-text')}>
                {r.ruleType}
              </span>
              <div className="min-w-0 flex-1">
                <div className={'truncate text-sm font-medium ' + (r.enabled ? 'text-ink' : 'text-muted line-through')}>{r.name || '(unnamed)'}</div>
                <div className="truncate text-xs text-muted">{conditionSummary(r)}</div>
              </div>
              <button className={smallGhost} onClick={() => actions.saveRule.mutate({ ...r, enabled: !r.enabled })} title="Toggle enabled">
                {r.enabled ? 'On' : 'Off'}
              </button>
              <button className={smallGhost} onClick={() => setEditing(r)}>Edit</button>
              <button className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-danger" onClick={() => actions.deleteRule.mutate(r.id)} aria-label="Delete rule">✕</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RuleEditor({
  initial,
  options,
  onSave,
  onCancel,
}: {
  initial: MappingRule;
  options: HarvestProject[];
  onSave: (rule: MappingRule) => void;
  onCancel: () => void;
}) {
  const [rule, setRule] = useState<MappingRule>(initial);
  const fields = useMemo(
    () => Object.values(rule.ruleType === 'WorkItem' ? WorkItemField : MeetingField),
    [rule.ruleType],
  );
  const set = (patch: Partial<MappingRule>) => setRule((r) => ({ ...r, ...patch }));
  const setCondition = (i: number, patch: Partial<MappingCondition>) =>
    set({ conditions: rule.conditions.map((c, idx) => (idx === i ? { ...c, ...patch } : c)) });
  const addCondition = () =>
    set({ conditions: [...rule.conditions, { field: fields[0]!, operator: 'equals', value: '' }] });
  const removeCondition = (i: number) => set({ conditions: rule.conditions.filter((_, idx) => idx !== i) });

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-hairline p-4">
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          {labelCls('Name')}
          <input className={inputCls} value={rule.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. LetsDrive → Development" />
        </label>
        <label className="flex flex-col gap-1">
          {labelCls('Applies to')}
          <select
            className={selectCls}
            value={rule.ruleType}
            onChange={(e) => set({ ruleType: e.target.value as RuleType, conditions: [] })}
          >
            <option value="WorkItem">Work items</option>
            <option value="Meeting">Meetings</option>
          </select>
        </label>
        <label className="flex flex-col gap-1">
          {labelCls('Priority (lower wins first)')}
          <input className={inputCls} type="number" value={rule.priority} onChange={(e) => set({ priority: Number(e.target.value) })} />
        </label>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" checked={rule.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
          Enabled
        </label>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          {labelCls('Conditions (all must match)')}
          <button className={smallGhost} onClick={addCondition}>+ Add</button>
        </div>
        {rule.conditions.length === 0 ? (
          <p className="text-xs text-muted">No conditions — this rule matches every {rule.ruleType === 'WorkItem' ? 'work item' : 'meeting'}.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {rule.conditions.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <select className={selectCls + ' w-32'} value={c.field} onChange={(e) => setCondition(i, { field: e.target.value })}>
                  {fields.map((f) => (
                    <option key={f} value={f}>{f}</option>
                  ))}
                </select>
                <select className={selectCls + ' w-28'} value={c.operator} onChange={(e) => setCondition(i, { operator: e.target.value as ConditionOperator })}>
                  {OPERATORS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
                <input className={inputCls + ' flex-1'} value={c.value} onChange={(e) => setCondition(i, { value: e.target.value })} placeholder="value" />
                <label className="flex items-center gap-1 text-xs text-muted" title="Invert this condition">
                  <input type="checkbox" checked={c.negate ?? false} onChange={(e) => setCondition(i, { negate: e.target.checked })} />
                  not
                </label>
                <button className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-danger" onClick={() => removeCondition(i)} aria-label="Remove condition">✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-1">{labelCls('Maps to')}</div>
        <HarvestPicker
          options={options}
          projectId={rule.target.harvestProjectId}
          taskId={rule.target.harvestTaskId}
          onChange={(pid, tid) => set({ target: { ...rule.target, harvestProjectId: pid ?? 0, harvestTaskId: tid ?? 0 } })}
        />
        <label className="mt-2 flex flex-col gap-1">
          {labelCls('Note template (optional)')}
          <input className={inputCls} value={rule.target.noteTemplate ?? ''} onChange={(e) => set({ target: { ...rule.target, noteTemplate: e.target.value || undefined } })} placeholder="Prefilled note when this rule matches" />
        </label>
      </div>

      <div className="flex items-center gap-3">
        <button className={primaryBtn} onClick={() => onSave(rule)} disabled={!rule.name.trim() || !rule.target.harvestProjectId}>Save rule</button>
        <button className={ghostBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

// ── Quick templates ─────────────────────────────────────────────────────────
function QuickTemplatesSection() {
  const { data: templates } = useTemplatesData();
  const { data: options } = useHarvestOptions();
  const actions = useTemplateActions();
  const [editing, setEditing] = useState<QuickTemplate | null>(null);
  const opts = options ?? [];

  const blank = (): QuickTemplate => ({
    id: actions.newId(),
    label: '',
    icon: '⏱️',
    color: '#6366F1',
    harvestProjectId: opts[0]?.id,
    harvestTaskId: opts[0]?.tasks[0]?.id,
    defaultNotes: '',
    sortOrder: (templates?.length ?? 0) + 1,
    enabled: true,
  });

  return (
    <Card
      title="Quick templates"
      subtitle="One-click launchers in the source rail with a preset Harvest project/task."
      action={
        !editing && (
          <button className={primaryBtn} onClick={() => setEditing(blank())}>New template</button>
        )
      }
    >
      {editing ? (
        <TemplateEditor
          key={editing.id}
          initial={editing}
          options={opts}
          onCancel={() => setEditing(null)}
          onSave={(t) => actions.saveTemplate.mutate(t, { onSuccess: () => setEditing(null) })}
        />
      ) : !templates?.length ? (
        <Empty>No quick templates yet.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {templates.map((t) => (
            <li key={t.id} className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas px-3 py-2">
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-sm" style={{ backgroundColor: (t.color ?? '#6366F1') + '22' }}>{t.icon ?? '⏱️'}</span>
              <div className="min-w-0 flex-1">
                <div className={'truncate text-sm font-medium ' + (t.enabled ? 'text-ink' : 'text-muted line-through')}>{t.label || '(unnamed)'}</div>
                {t.defaultNotes && <div className="truncate text-xs text-muted">{t.defaultNotes}</div>}
              </div>
              <button className={smallGhost} onClick={() => actions.saveTemplate.mutate({ ...t, enabled: !t.enabled })} title="Toggle enabled">{t.enabled ? 'On' : 'Off'}</button>
              <button className={smallGhost} onClick={() => setEditing(t)}>Edit</button>
              <button className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-danger" onClick={() => actions.deleteTemplate.mutate(t.id)} aria-label="Delete template">✕</button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function TemplateEditor({
  initial,
  options,
  onSave,
  onCancel,
}: {
  initial: QuickTemplate;
  options: HarvestProject[];
  onSave: (t: QuickTemplate) => void;
  onCancel: () => void;
}) {
  const [t, setT] = useState<QuickTemplate>(initial);
  const set = (patch: Partial<QuickTemplate>) => setT((prev) => ({ ...prev, ...patch }));

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-dashed border-hairline p-4">
      <div className="grid grid-cols-[1fr_5rem_5rem] gap-3">
        <label className="flex flex-col gap-1">
          {labelCls('Label')}
          <input className={inputCls} value={t.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. PR Reviews" />
        </label>
        <label className="flex flex-col gap-1">
          {labelCls('Icon')}
          <input className={inputCls} value={t.icon ?? ''} onChange={(e) => set({ icon: e.target.value })} placeholder="🔍" />
        </label>
        <label className="flex flex-col gap-1">
          {labelCls('Colour')}
          <input className={inputCls + ' h-[38px] p-1'} type="color" value={t.color ?? '#6366F1'} onChange={(e) => set({ color: e.target.value })} />
        </label>
      </div>
      <HarvestPicker
        options={options}
        projectId={t.harvestProjectId}
        taskId={t.harvestTaskId}
        onChange={(pid, tid) => set({ harvestProjectId: pid, harvestTaskId: tid })}
        allowNone
      />
      <label className="flex flex-col gap-1">
        {labelCls('Default notes (optional)')}
        <input className={inputCls} value={t.defaultNotes ?? ''} onChange={(e) => set({ defaultNotes: e.target.value })} placeholder="Prefilled note when started" />
      </label>
      <label className="flex flex-col gap-1">
        {labelCls('ADO saved query (optional)')}
        <textarea
          className={inputCls + ' min-h-[4.5rem] font-mono text-xs'}
          value={t.adoQuery ?? ''}
          onChange={(e) => set({ adoQuery: e.target.value || undefined })}
          placeholder={"SELECT [System.Id] FROM WorkItems WHERE [System.State] = 'Active'"}
        />
        <p className="text-[11px] text-muted">When set, this template becomes selectable as a Work Items filter in the source rail.</p>
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={t.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
        Enabled
      </label>
      <div className="flex items-center gap-3">
        <button className={primaryBtn} onClick={() => onSave(t)} disabled={!t.label.trim()}>Save template</button>
        <button className={ghostBtn} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-hairline p-6 text-center text-sm text-muted">{children}</div>;
}
