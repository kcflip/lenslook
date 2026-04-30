// Deterministic daily pick: stable within a local day, rotates at midnight.
export function lensOfTheDayIndex(total: number, now: Date = new Date()): number {
  if (total <= 0) return 0;
  const seed = now.getFullYear() * 1000 + now.getMonth() * 31 + now.getDate();
  return seed % total;
}
