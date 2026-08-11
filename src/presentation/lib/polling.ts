/**
 * Translate a user-facing `Settings.refreshIntervalMinutes` into a TanStack
 * Query `refetchInterval` value. Returns `false` (disabled) for any
 * non-finite or non-positive input; fractional minutes round to the nearest
 * whole second so odd values (e.g. 0.5) still produce a sane interval.
 */
export function pollingIntervalMs(refreshIntervalMinutes: number): number | false {
  if (!Number.isFinite(refreshIntervalMinutes) || refreshIntervalMinutes <= 0) return false;
  return Math.round(refreshIntervalMinutes * 60_000);
}
