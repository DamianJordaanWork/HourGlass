import { useEffect, useState, type ReactNode } from 'react';
import type { Settings } from '@domain/settings/settings';
import type { AdoConnectionView, Probe } from '@composition/container';
import { useConnectionActions, useConnectionStatus } from '@presentation/hooks/use-connections';
import { useSaveSettings, useSettings } from '@presentation/hooks/use-settings';

export function SettingsPane() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <h2 className="text-lg font-semibold">Settings</h2>
      <HarvestSection />
      <AdoSection />
      <WorkdaySection />
    </div>
  );
}

// ── shared bits ─────────────────────────────────────────────────────────────
function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
      <div className="mt-4 flex flex-col gap-3">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}

const inputCls =
  'rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none placeholder:text-muted focus:border-primary';
const primaryBtn =
  'rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-on-primary hover:bg-primary-hover disabled:opacity-50';
const ghostBtn =
  'rounded-lg border border-hairline px-3 py-2 text-sm font-medium text-muted hover:text-ink';

function ProbeBadge({ probe }: { probe?: Probe }) {
  if (!probe || probe.state === 'idle') return null;
  if (probe.state === 'ok') {
    return (
      <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent-soft-text">
        Connected · {probe.detail}
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[color:var(--danger)]/10 px-2 py-0.5 text-[11px] font-medium text-danger" title={probe.error}>
      Failed · {truncate(probe.error, 60)}
    </span>
  );
}

// ── Harvest ─────────────────────────────────────────────────────────────────
function HarvestSection() {
  const { data: status } = useConnectionStatus();
  const { saveHarvest, clearHarvest } = useConnectionActions();
  const [accountId, setAccountId] = useState('');
  const [token, setToken] = useState('');

  useEffect(() => {
    if (status) setAccountId(status.harvest.accountId);
  }, [status?.harvest.accountId]);

  const hasToken = status?.harvest.hasToken ?? false;
  const probe = saveHarvest.data ?? status?.harvest.probe;

  const save = () => {
    saveHarvest.mutate(
      { accountId, token: token.trim() || undefined },
      { onSuccess: () => setToken('') },
    );
  };

  return (
    <Card title="Harvest" subtitle="Time is synced to Harvest best-effort; local stays the source of truth.">
      <Field label="Account ID">
        <input className={inputCls} value={accountId} onChange={(e) => setAccountId(e.target.value)} placeholder="e.g. 123456" />
      </Field>
      <Field label={hasToken ? 'Personal access token (leave blank to keep current)' : 'Personal access token'}>
        <input
          className={inputCls}
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={hasToken ? '•••••••• stored' : 'Paste your Harvest PAT'}
          autoComplete="off"
        />
      </Field>
      <div className="flex items-center gap-3">
        <button className={primaryBtn} onClick={save} disabled={saveHarvest.isPending || !accountId.trim()}>
          {saveHarvest.isPending ? 'Saving…' : 'Save & test'}
        </button>
        {hasToken && (
          <button className={ghostBtn} onClick={() => clearHarvest.mutate()} disabled={clearHarvest.isPending}>
            Disconnect
          </button>
        )}
        <ProbeBadge probe={probe} />
      </div>
    </Card>
  );
}

// ── Azure DevOps ──────────────────────────────────────────────────────────
const emptyAdo = { id: undefined as string | undefined, label: '', orgUrl: '', iterationPath: '', pat: '' };

function AdoSection() {
  const { data: status } = useConnectionStatus();
  const { saveAdo, deleteAdo } = useConnectionActions();
  const [form, setForm] = useState(emptyAdo);
  const connections = status?.ado ?? [];
  const editing = form.id !== undefined;

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const submit = () => {
    saveAdo.mutate(
      {
        input: {
          id: form.id,
          label: form.label,
          orgUrl: form.orgUrl,
          iterationPath: form.iterationPath || undefined,
          enabled: true,
        },
        pat: form.pat.trim() || undefined,
      },
      { onSuccess: () => setForm(emptyAdo) },
    );
  };

  const startEdit = (c: AdoConnectionView) =>
    setForm({ id: c.id, label: c.label, orgUrl: c.orgUrl, iterationPath: c.iterationPath ?? '', pat: '' });

  const toggleEnabled = (c: AdoConnectionView) =>
    saveAdo.mutate({
      input: { id: c.id, label: c.label, orgUrl: c.orgUrl, iterationPath: c.iterationPath, enabled: !c.enabled },
    });

  return (
    <Card title="Azure DevOps" subtitle="One or more organizations. Assigned work items appear in the source rail.">
      {connections.length > 0 && (
        <ul className="flex flex-col gap-2">
          {connections.map((c) => (
            <li key={c.id} className="flex items-center gap-3 rounded-lg border border-hairline bg-canvas px-3 py-2">
              <button
                onClick={() => toggleEnabled(c)}
                className={
                  'h-4 w-7 shrink-0 rounded-full transition-colors ' + (c.enabled ? 'bg-primary' : 'bg-elevated')
                }
                aria-label={c.enabled ? 'Disable' : 'Enable'}
                title={c.enabled ? 'Enabled' : 'Disabled'}
              >
                <span className={'block h-3 w-3 rounded-full bg-surface transition-transform ' + (c.enabled ? 'translate-x-3.5' : 'translate-x-0.5')} />
              </button>
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{c.label || c.orgUrl}</div>
                <div className="truncate text-xs text-muted">{c.orgUrl}{c.iterationPath ? ` · ${c.iterationPath}` : ''}</div>
              </div>
              {!c.hasPat && <span className="rounded-full bg-[color:var(--warning)]/15 px-2 py-0.5 text-[11px] font-medium text-warning">No PAT</span>}
              <button onClick={() => startEdit(c)} className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-ink">Edit</button>
              <button onClick={() => deleteAdo.mutate(c.id)} className="rounded-md border border-hairline px-2 py-1 text-xs text-muted hover:text-danger" aria-label="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}

      <div className="rounded-lg border border-dashed border-hairline p-3">
        <div className="mb-2 text-xs font-medium text-muted">{editing ? 'Edit connection' : 'Add connection'}</div>
        <div className="flex flex-col gap-3">
          <Field label="Label">
            <input className={inputCls} value={form.label} onChange={(e) => set({ label: e.target.value })} placeholder="e.g. Agile Bridge" />
          </Field>
          <Field label="Organization URL">
            <input className={inputCls} value={form.orgUrl} onChange={(e) => set({ orgUrl: e.target.value })} placeholder="https://dev.azure.com/agile-bridge" />
          </Field>
          <Field label="Iteration path (optional filter)">
            <input className={inputCls} value={form.iterationPath} onChange={(e) => set({ iterationPath: e.target.value })} placeholder="LetsDrive\\Sprint 12" />
          </Field>
          <Field label={editing ? 'Personal access token (leave blank to keep current)' : 'Personal access token'}>
            <input className={inputCls} type="password" value={form.pat} onChange={(e) => set({ pat: e.target.value })} placeholder="Paste your ADO PAT" autoComplete="off" />
          </Field>
          <div className="flex items-center gap-3">
            <button className={primaryBtn} onClick={submit} disabled={saveAdo.isPending || !form.label.trim() || !form.orgUrl.trim()}>
              {saveAdo.isPending ? 'Saving…' : editing ? 'Update & test' : 'Add & test'}
            </button>
            {editing && <button className={ghostBtn} onClick={() => setForm(emptyAdo)}>Cancel</button>}
            {!editing && <ProbeBadge probe={saveAdo.data} />}
          </div>
        </div>
      </div>
    </Card>
  );
}

// ── Work day & goals ──────────────────────────────────────────────────────
function WorkdaySection() {
  const { data } = useSettings();
  const saveSettings = useSaveSettings();
  const [draft, setDraft] = useState<Settings | null>(null);

  useEffect(() => {
    if (data) setDraft(data);
  }, [data]);

  if (!draft) return null;
  const set = (patch: Partial<Settings>) => setDraft({ ...draft, ...patch });
  const num = (v: string) => (v === '' ? 0 : Number(v));

  return (
    <Card title="Work day & goals" subtitle="Drives the Insights window, dead-time detection, and the weekly goal ring.">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Work day start">
          <input className={inputCls} type="time" value={draft.workDayStart} onChange={(e) => set({ workDayStart: e.target.value })} />
        </Field>
        <Field label="Work day end">
          <input className={inputCls} type="time" value={draft.workDayEnd} onChange={(e) => set({ workDayEnd: e.target.value })} />
        </Field>
        <Field label="Break (minutes)">
          <input className={inputCls} type="number" min={0} value={draft.breakMinutes} onChange={(e) => set({ breakMinutes: num(e.target.value) })} />
        </Field>
        <Field label="Weekly goal (hours)">
          <input className={inputCls} type="number" min={0} value={draft.weeklyGoalHours} onChange={(e) => set({ weeklyGoalHours: num(e.target.value) })} />
        </Field>
        <Field label="Min dead-time gap (minutes)">
          <input className={inputCls} type="number" min={0} value={draft.minDeadTimeMinutes} onChange={(e) => set({ minDeadTimeMinutes: num(e.target.value) })} />
        </Field>
        <Field label="Refresh interval (minutes)">
          <input className={inputCls} type="number" min={1} value={draft.refreshIntervalMinutes} onChange={(e) => set({ refreshIntervalMinutes: num(e.target.value) })} />
        </Field>
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={draft.autoStopOnSwitch} onChange={(e) => set({ autoStopOnSwitch: e.target.checked })} />
        Auto-stop the running timer when a new one starts
      </label>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={draft.aggregateSameTaskPerDay} onChange={(e) => set({ aggregateSameTaskPerDay: e.target.checked })} />
        Roll same-task sessions into one Harvest entry per day
      </label>
      <div className="flex items-center gap-3">
        <button className={primaryBtn} onClick={() => saveSettings.mutate(draft)} disabled={saveSettings.isPending}>
          {saveSettings.isPending ? 'Saving…' : 'Save settings'}
        </button>
        {saveSettings.isSuccess && !saveSettings.isPending && <span className="text-xs text-muted">Saved.</span>}
      </div>
    </Card>
  );
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
