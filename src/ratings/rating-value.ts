export const MIN_RANKED_RATINGS = 5;

export const SHOWN_RATING_EXPRESSION = {
  $divide: [
    { $floor: { $add: [{ $multiply: ['$ratingAverage', 10] }, 0.5] } },
    10,
  ],
};

export function ratingOf(
  average: number | null | undefined,
  count: number | null | undefined,
): number | null {
  if (!count || typeof average !== 'number') return null;
  return Math.round(average * 10) / 10;
}
