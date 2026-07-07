import type { DefectProofResult, Issue, IssueDispositionResult, QaResult, Severity } from '../types.js';
import { issueHasProofReadyRootCause } from '../proof/proofReadiness.js';

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
  failedByProfessionalContract: boolean;
  professionalContractFailures: string[];
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

export function severityCountsForResult(result: Pick<QaResult, 'issues' | 'summary' | 'issueDisposition'> & Partial<Pick<QaResult, 'defectProof'>>, mode: CiGateMode): Record<Severity, number> {
  if (mode === 'raw') return countBySeverity(result.issues);
  const actionable = actionableIssueIds(result.issueDisposition);
  const defectProof = 'defectProof' in result ? (result as { defectProof?: DefectProofResult }).defectProof : undefined;
  return countBySeverity(result.issues.filter((issue) => actionable.has(issue.id) && issueHasProofReadyRootCause(issue, result.issueDisposition, defectProof)));
}

function hasSeverityAtOrAbove(counts: Record<Severity, number>, failOn: Severity | undefined): boolean {
  if (!failOn) return false;
  return severities.some((severity) => severityRank[severity] <= severityRank[failOn] && counts[severity] > 0);
}

type ProfessionalContractInput = Partial<Pick<QaResult, 'artifactIntegrity' | 'claimGuard' | 'qaCoverage' | 'qaIntake' | 'qaSignoff' | 'qualityGate' | 'reportContentAudit'>>;

function professionalContractFailures(result: ProfessionalContractInput): string[] {
  const failures: string[] = [];
  if (result.reportContentAudit?.status === 'failed') {
    failures.push(`reportContentAudit failed (${result.reportContentAudit.summary.blockerCount} blocker(s)).`);
  }
  if (result.artifactIntegrity?.status === 'failed') {
    failures.push(`artifactIntegrity failed (${result.artifactIntegrity.missingCount} missing artifact(s)).`);
  }
  if (result.qaSignoff?.status === 'fail' || result.qaSignoff?.status === 'blocked') {
    failures.push(`qaSignoff is ${result.qaSignoff.status}.`);
  }
  if (result.qualityGate?.status === 'fail' || result.qualityGate?.status === 'blocked') {
    failures.push(`qualityGate is ${result.qualityGate.status}.`);
  }
  if (result.claimGuard?.status === 'blocked') {
    failures.push('claimGuard is blocked.');
  }
  if (result.qaIntake?.status === 'blocked') {
    failures.push('qaIntake is blocked.');
  }
  const qaCoverage = result.qaCoverage;
  if (qaCoverage && (qaCoverage.status === 'insufficient' || qaCoverage.summary.failedCount > 0 || qaCoverage.summary.blockerCount > 0)) {
    failures.push(`qaCoverage is ${qaCoverage.status} (failed ${qaCoverage.summary.failedCount}, blockers ${qaCoverage.summary.blockerCount}).`);
  }
  return failures;
}

export function evaluateQaCiGate(input: {
  result: Pick<QaResult, 'issues' | 'summary' | 'issueDisposition'> & Partial<Pick<QaResult, 'defectProof'>> & ProfessionalContractInput;
  failOn?: Severity;
  minScore?: number;
  mode?: CiGateMode;
}): CiGateEvaluation {
  const mode = input.mode ?? 'professional';
  const score = mode === 'raw' ? input.result.summary.score : input.result.summary.adjustedScore;
  const severityCounts = severityCountsForResult(input.result, mode);
  const failedByScore = input.minScore !== undefined ? score < input.minScore : false;
  const failedBySeverity = hasSeverityAtOrAbove(severityCounts, input.failOn);
  const professionalFailures = mode === 'professional' ? professionalContractFailures(input.result) : [];
  const failedByProfessionalContract = professionalFailures.length > 0;
  return {
    mode,
    status: failedByScore || failedBySeverity || failedByProfessionalContract ? 'failed' : 'passed',
    score,
    scoreField: mode === 'raw' ? 'summary.score' : 'summary.adjustedScore',
    minScore: input.minScore,
    failOn: input.failOn,
    failedByScore,
    failedBySeverity,
    failedByProfessionalContract,
    professionalContractFailures: professionalFailures,
    severityCounts,
    notes: mode === 'professional'
      ? [
          'Professional gate uses adjustedScore and actionable+proof-ready findings only; raw deployment/product/tool/needs-evidence findings do not fail CI.',
          'Professional gate also fails on report/sign-off contract blockers such as failed reportContentAudit, qaSignoff, qualityGate, artifactIntegrity, claimGuard, qaIntake, or failed/insufficient qaCoverage.'
        ]
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
    failedByProfessionalContract: false,
    professionalContractFailures: [],
    severityCounts,
    notes: mode === 'professional'
      ? ['Professional matrix gate uses adjustedScore and proof-ready actionable findings only.']
      : ['Raw matrix gate uses raw score and raw severity counts.']
  };
}
