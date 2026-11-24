export const MIN_RANKED_RATINGS = 5;

export function ratingOf(
  average: number | null | undefined,
  count: number | null | undefined,
): number | null {
  if (!count || typeof average !== 'number') return null;
  return Math.round(average * 10) / 10;
}
