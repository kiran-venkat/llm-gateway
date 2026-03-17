/**
 * Computes the exact p-th percentile from a pre-sorted ascending array.
 *
 * Uses the nearest-rank method:
 *   rank = ceil(p / 100 × n), 1-based → value at index (rank - 1)
 *
 * Returns 0 for an empty array.
 * Used by DailyCloseJob (p95 latency) and future forecast work (T71).
 */
export function computePercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(rank - 1, 0)];
}
