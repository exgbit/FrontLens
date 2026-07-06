import type { Issue } from '../types.js';
import { fingerprintIssue } from '../resultNormalizer.js';

export function stableIssueFingerprint(issue: Issue): string {
  return fingerprintIssue(issue);
}

const severityRank: Record<Issue['severity'], number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
type DedupeIssue = Issue & { duplicateCount?: number; duplicateIssueIds?: string[]; duplicateIssues?: Array<Record<string, unknown>> };

function duplicateMetadata(issue: Issue): Record<string, unknown> {
  const details = issue.evidence.details && typeof issue.evidence.details === 'object' ? (issue.evidence.details as Record<string, unknown>) : {};
  return {
    id: issue.id,
    title: issue.title,
    category: issue.category,
    severity: issue.severity,
    exceptionSimulationId: details.exceptionSimulationId,
    kind: details.kind,
    target: details.target
  };
}

export function dedupeIssues(issues: Issue[]): Issue[] {
  const map = new Map<string, DedupeIssue>();
  for (const raw of issues) {
    const issue = { ...raw, fingerprint: stableIssueFingerprint(raw) };
    const existing = map.get(issue.fingerprint);
    if (!existing) {
      map.set(issue.fingerprint, { ...issue, duplicateCount: 1, duplicateIssueIds: [], duplicateIssues: [] });
      continue;
    }
    existing.duplicateCount = (existing.duplicateCount ?? 1) + 1;
    existing.duplicateIssueIds = [...(existing.duplicateIssueIds ?? []), issue.id];
    existing.duplicateIssues = [...(existing.duplicateIssues ?? []), duplicateMetadata(issue)];
    existing.confidence = Math.max(existing.confidence, issue.confidence);
    if (severityRank[issue.severity] < severityRank[existing.severity]) {
      existing.severity = issue.severity;
      existing.suggestion = issue.suggestion;
      existing.description = issue.description;
      existing.reason = issue.reason;
    }
    existing.evidence = {
      ...existing.evidence,
      details: {
        ...(existing.evidence.details && typeof existing.evidence.details === 'object' ? existing.evidence.details : {}),
        duplicateCount: existing.duplicateCount,
        duplicateIssueIds: existing.duplicateIssueIds,
        duplicateIssues: existing.duplicateIssues
      }
    };
  }
  return [...map.values()].map((issue) => {
    const { duplicateCount: _duplicateCount, duplicateIssueIds: _duplicateIssueIds, duplicateIssues: _duplicateIssues, ...rest } = issue;
    return rest;
  });
}
