export function createId(prefix: string, index: number): string {
  return `${prefix}-${String(index).padStart(4, '0')}`;
}

export function createIssueId(index: number): string {
  return `ISSUE-${String(index).padStart(3, '0')}`;
}

export function createStableFingerprint(parts: Array<unknown>): string {
  const input = parts.map((part) => String(part ?? '')).join('\u001f');
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `FL-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
