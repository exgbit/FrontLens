export function compactText(value: string | undefined | null, maxLength = 180): string {
  if (!value) {
    return '';
  }
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) {
    return compacted;
  }
  return `${compacted.slice(0, maxLength - 1)}…`;
}

export function markdownEscape(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

export function truncateMiddle(value: string, maxLength = 120): string {
  if (value.length <= maxLength) {
    return value;
  }
  const head = Math.ceil((maxLength - 1) / 2);
  const tail = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, head)}…${value.slice(value.length - tail)}`;
}
