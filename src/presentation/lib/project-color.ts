// Categorical palette for per-project stripes — distinct from the semantic hues.
const PALETTE = [
  '#6366F1', // indigo
  '#14B8A6', // teal
  '#F59E0B', // amber
  '#EC4899', // pink
  '#8B5CF6', // violet
  '#0EA5E9', // sky
  '#84CC16', // lime
  '#F97316', // orange
];

/** Deterministic colour for a project id (stable across sessions). */
export function projectColor(projectId?: number): string {
  if (projectId === undefined) return '#94A3B8'; // slate for unmapped
  return PALETTE[Math.abs(projectId) % PALETTE.length]!;
}
