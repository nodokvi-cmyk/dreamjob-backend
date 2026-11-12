export const EXCERPT_LENGTH = 250;

export function excerpt(text: string, maxLength = EXCERPT_LENGTH): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxLength) return trimmed;

  const window = trimmed.slice(0, maxLength + 1);
  const lastSpace = window.search(/\s\S*$/);
  const head =
    lastSpace > 0 ? window.slice(0, lastSpace) : trimmed.slice(0, maxLength);

  return `${head.trimEnd()}...`;
}
