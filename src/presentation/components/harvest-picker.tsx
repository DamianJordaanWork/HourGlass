import type { HarvestProject } from '@domain/harvest/harvest-types';

const selectCls =
  'cursor-pointer rounded-lg border border-hairline bg-canvas px-3 py-2 text-sm text-ink outline-none focus:border-primary';

/** Resolve friendly project/task names from the option list. */
export function resolveNames(
  options: HarvestProject[],
  projectId?: number,
  taskId?: number,
): { projectName?: string; taskName?: string } {
  const project = options.find((p) => p.id === projectId);
  if (!project) return {};
  const task = taskId !== undefined ? project.tasks.find((t) => t.id === taskId) : undefined;
  return { projectName: project.name, taskName: task?.name };
}

/** Two dependent selects: Harvest project → its task. */
export function HarvestPicker({
  options,
  projectId,
  taskId,
  onChange,
  allowNone,
}: {
  options: HarvestProject[];
  projectId?: number;
  taskId?: number;
  onChange: (projectId?: number, taskId?: number) => void;
  allowNone?: boolean;
}) {
  const project = options.find((p) => p.id === projectId);
  return (
    <div className="grid grid-cols-2 gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Harvest project</span>
        <select
          className={selectCls}
          value={projectId ?? ''}
          onChange={(e) => {
            const pid = e.target.value === '' ? undefined : Number(e.target.value);
            const first = options.find((p) => p.id === pid)?.tasks[0]?.id;
            onChange(pid, first);
          }}
        >
          {allowNone && <option value="">— none —</option>}
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium text-muted">Task</span>
        <select
          className={selectCls}
          value={taskId ?? ''}
          onChange={(e) => onChange(projectId, e.target.value === '' ? undefined : Number(e.target.value))}
          disabled={!project}
        >
          {allowNone && <option value="">— none —</option>}
          {project?.tasks.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
