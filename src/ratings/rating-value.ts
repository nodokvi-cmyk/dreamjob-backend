export const MIN_RANKED_RATINGS = 5;

export function ratingOf(
  average: number | undefined,
  count: number | undefined,
): number | null {
  if (!count || average === undefined) return null;
  return Math.round(average * 10) / 10;
}

export function roundAverage(average: number): number {
  return Math.round(average * 100) / 100;
}
