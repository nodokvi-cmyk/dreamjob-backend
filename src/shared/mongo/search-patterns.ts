const REGEX_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;
const WORD_BOUNDARY = '(^|[\\s.,;:!?()\\[\\]{}"\'/\\\\|+&@#*_-])';

export function escapeRegex(text: string): string {
  return text.replace(REGEX_SPECIAL_CHARACTERS, '\\$&');
}

export function wordStartPattern(text: string): string {
  return `${WORD_BOUNDARY}${escapeRegex(text)}`;
}

export function exactPattern(text: string): string {
  return `^${escapeRegex(text)}$`;
}

export function searchWords(text: string, maxWords: number): string[] {
  return text.split(/\s+/).filter(Boolean).slice(0, maxWords);
}
