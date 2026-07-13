import type { RequirementConfigItem } from '../types.js';

export interface ApiPatternParts {
  method?: string;
  path?: string;
}

export interface ApiAcceptanceExpectation extends ApiPatternParts {
  pattern: string;
  statuses: number[];
}

const STATUS_PATTERN = /(?:返回|响应|状态码|status(?:\s+code)?(?:\s+is)?|http)\s*[:：=为]?\s*(?:HTTP\s*)?(\d{3})|\b(\d{3})\s*(?:状态码|响应)\b/gi;

export function requirementAcceptanceText(item: RequirementConfigItem): string {
  return `${item.title} ${item.description ?? ''} ${(item.acceptanceCriteria ?? []).join(' ')}`;
}

export function extractHttpStatuses(text: string): number[] {
  const statuses = new Set<number>();
  for (const match of text.matchAll(STATUS_PATTERN)) {
    const status = Number(match[1] ?? match[2]);
    if (status >= 100 && status <= 599) statuses.add(status);
  }
  return [...statuses];
}

export function parseApiPattern(value: string): ApiPatternParts {
  const trimmed = value.trim().replace(/[`'\"]/g, '');
  const match = trimmed.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/i);
  const method = match?.[1].toUpperCase();
  const raw = match?.[2] ?? trimmed;
  try {
    const parsed = new URL(raw);
    return { method, path: parsed.pathname };
  } catch {
    const path = raw.match(/\/[^\s?#]*/)?.[0];
    return { method, path };
  }
}

export function apiPathMatches(pattern: string, actual: string): boolean {
  const expected = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\{[^/]+\\\}/g, '[^/]+').replace(/\\\*/g, '.*');
  return new RegExp(`^${expected}/?$`).test(actual);
}

/**
 * Associate explicit status codes with the API clause that owns them.
 *
 * A requirement may describe multiple operations, for example
 * `GET /users returns 200; DELETE /users/{id} returns 403`. Treating 200 and
 * 403 as one requirement-wide set lets swapped responses pass. The bounded
 * slice from each API occurrence to the next preserves the PRD association.
 */
export function apiAcceptanceExpectations(item: RequirementConfigItem): ApiAcceptanceExpectation[] {
  const text = requirementAcceptanceText(item);
  const patterns = (item.apiPatterns ?? []).filter(Boolean);
  let cursor = 0;
  const located = patterns.map((pattern) => {
    const parts = parseApiPattern(pattern);
    const path = parts.path ?? '';
    const normalizedPattern = pattern.trim().replace(/[`'\"]/g, '');
    let position = text.indexOf(normalizedPattern, cursor);
    if (position < 0 && path) position = text.indexOf(path, cursor);
    if (position >= 0) cursor = position + Math.max(path.length, normalizedPattern.length);
    return { pattern, ...parts, position };
  });
  const globalStatuses = extractHttpStatuses(text);
  return located.map((itemAt, index) => {
    let statuses: number[] = [];
    if (itemAt.position >= 0) {
      const laterPositions = located.slice(index + 1).map((entry) => entry.position).filter((position) => position > itemAt.position);
      const end = laterPositions.length ? Math.min(...laterPositions) : text.length;
      statuses = extractHttpStatuses(text.slice(itemAt.position, end));
    }
    // A single API keeps backwards-compatible requirement-wide status parsing.
    if (statuses.length === 0 && patterns.length === 1) statuses = globalStatuses;
    return { pattern: itemAt.pattern, method: itemAt.method, path: itemAt.path, statuses };
  });
}
