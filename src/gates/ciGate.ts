import type { Issue, IssueDispositionResult, QaResult, Severity } from '../types.js';

export type CiGateMode = 'professional' | 'raw';
export type CiGateStatus = 'passed' | 'failed';

const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const severities: Severity[] = ['critical', 'high', 'medium', 'low', 'info'];

export interface CiGateEvaluation {
  mode: CiGateMode;
  status: CiGateStatus;
  score: number;
  scoreField: 'summary.adjustedScore' | 'summary.score' | 'adjustedScore' | 'score';
  minScore?: number;
  failOn?: Severity;
  failedByScore: boolean;
  failedBySeverity: boolean;
  severityCounts: Record<Severity, number>;
  notes: string[];
}

function emptyCounts(): Record<Severity, number> {
  return { critical: 0, high: 0, medium: 0, low: 0, info: 0 };
}

function countBySeverity(issues: Issue[]): Record<Severity, number> {
  const counts = emptyCounts();
  for (const issue of issues) counts[issue.severity] += 1;
  return counts;
}

function actionableIssueIds(disposition: IssueDispositionResult | undefined): Set<string> {
  return new Set((disposition?.items ?? []).filter((item) => item.actionability === 'actionable').map((item) => item.issueId));
}

export function severityCountsForResult(result: Pick<QaResult, 'issues' | 'summary' | 'issueDisposition'>, mode: CiGateMode): Record<Severity, number> {
  if (mode === 'raw') return countBySeverity(result.issues);
  const actionable = actionableIssueIds(result.issueDisposition);
  return countBySeverity(result.issues.filter((issue) => actionable.has(issue.id)));
}

function hasSeverityAtOrAbove(counts: Record<Severity, number>, failOn: Severity | undefined): boolean {
  if (!failOn) return false;
  return severities.some((severity) => severityRank[severity] <= severityRank[failOn] && counts[severity] > 0);
}

export function evaluateQaCiGate(input: {
  result: Pick<QaResult, 'issues' | 'summary' | 'issueDisposition'>;
  failOn?: Severity;
  minScore?: number;
  mode?: CiGateMode;
}): CiGateEvaluation {
  const mode = input.mode ?? 'professional';
  const score = mode === 'raw' ? input.result.summary.score : input.result.summary.adjustedScore;
  const severityCounts = severityCountsForResult(input.result, mode);
  const failedByScore = input.minScore !== undefined ? score < input.minScore : false;
  const failedBySeverity = hasSeverityAtOrAbove(severityCounts, input.failOn);
  return {
    mode,
    status: failedByScore || failedBySeverity ? 'failed' : 'passed',
    score,
    scoreField: mode === 'raw' ? 'summary.score' : 'summary.adjustedScore',
    minScore: input.minScore,
    failOn: input.failOn,
    failedByScore,
    failedBySeverity,
    severityCounts,
    notes: mode === 'professional'
      ? ['Professional gate uses adjustedScore and actionable findings only; raw deployment/product/tool findings do not fail CI.']
      : ['Raw gate uses raw score and all raw findings for backward-compatible scanner behavior.']
  };
}

export interface MatrixGateItem {
  success: boolean;
  score?: number;
  adjustedScore?: number;
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
  infoCount?: number;
  actionableCriticalCount?: number;
  actionableHighCount?: number;
  actionableMediumCount?: number;
  actionableLowCount?: number;
  actionableInfoCount?: number;
}

export function severityCountsForMatrixItem(item: MatrixGateItem, mode: CiGateMode): Record<Severity, number> {
  if (mode === 'raw') {
    return {
      critical: item.criticalCount ?? 0,
      high: item.highCount ?? 0,
      medium: item.mediumCount ?? 0,
      low: item.lowCount ?? 0,
      info: item.infoCount ?? 0
    };
  }
  return {
    critical: item.actionableCriticalCount ?? item.criticalCount ?? 0,
    high: item.actionableHighCount ?? item.highCount ?? 0,
    medium: item.actionableMediumCount ?? item.mediumCount ?? 0,
    low: item.actionableLowCount ?? item.lowCount ?? 0,
    info: item.actionableInfoCount ?? item.infoCount ?? 0
  };
}

export function evaluateMatrixItemCiGate(input: {
  item: MatrixGateItem;
  failOn?: Severity;
  minScore?: number;
  mode?: CiGateMode;
}): CiGateEvaluation {
  const mode = input.mode ?? 'professional';
  const score = mode === 'raw' ? input.item.score ?? 0 : input.item.adjustedScore ?? input.item.score ?? 0;
  const severityCounts = severityCountsForMatrixItem(input.item, mode);
  const failedByScore = input.item.success && input.minScore !== undefined ? score < input.minScore : false;
  const failedBySeverity = input.item.success ? hasSeverityAtOrAbove(severityCounts, input.failOn) : false;
  return {
    mode,
    status: failedByScore || failedBySeverity ? 'failed' : 'passed',
    score,
    scoreField: mode === 'raw' ? 'score' : 'adjustedScore',
    minScore: input.minScore,
    failOn: input.failOn,
    failedByScore,
    failedBySeverity,
    severityCounts,
    notes: mode === 'professional'
      ? ['Professional matrix gate uses adjustedScore and actionable findings only.']
      : ['Raw matrix gate uses raw score and raw severity counts.']
  };
}
