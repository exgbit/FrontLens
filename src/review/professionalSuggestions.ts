import type { Issue, IssueDispositionItem, QaResult } from '../types.js';
import { proofItemForGroup, proofReadyRootCauseGroups } from '../proof/proofReadiness.js';

export interface ProfessionalSuggestionItem {
  id: string;
  title: string;
  severity: Issue['severity'];
  category: Issue['category'];
  confidence: number;
  disposition?: {
    status: IssueDispositionItem['status'];
    actionability: IssueDispositionItem['actionability'];
    bucket: IssueDispositionItem['bucket'];
    owner: IssueDispositionItem['owner'];
    reason: string;
    nextStep: string;
    rootCauseGroupId?: string;
  };
  defectProof?: {
    status: string;
    score: number;
    missingEvidence: string[];
  };
  suggestion: Issue['suggestion'];
  evidence: Issue['evidence'];
}

export interface ProfessionalSuggestionsResult {
  mode: 'professional-default' | 'raw-all';
  summary: {
    rawSuggestionCount: number;
    returnedCount: number;
    suppressedCount: number;
    proofReadyRootCauseCount: number;
    actionableDispositionCount: number;
    nonActionableOrConditionalCount: number;
  };
  items: ProfessionalSuggestionItem[];
  suppressedBuckets: Record<string, number>;
  notes: string[];
}

function hasSuggestion(issue: Issue): boolean {
  return Boolean(issue.suggestion.frontend || issue.suggestion.backend || issue.suggestion.test || issue.suggestion.product);
}

function toItem(issue: Issue, disposition?: IssueDispositionItem, proof?: ReturnType<typeof proofItemForGroup>): ProfessionalSuggestionItem {
  return {
    id: issue.id,
    title: issue.title,
    severity: issue.severity,
    category: issue.category,
    confidence: issue.confidence,
    disposition: disposition
      ? {
          status: disposition.status,
          actionability: disposition.actionability,
          bucket: disposition.bucket,
          owner: disposition.owner,
          reason: disposition.reason,
          nextStep: disposition.nextStep,
          rootCauseGroupId: disposition.rootCauseGroupId
        }
      : undefined,
    defectProof: proof
      ? {
          status: proof.status,
          score: proof.score,
          missingEvidence: proof.missingEvidence
        }
      : undefined,
    suggestion: issue.suggestion,
    evidence: issue.evidence
  };
}

function inc(target: Record<string, number>, key: string): void {
  target[key] = (target[key] ?? 0) + 1;
}

export function buildProfessionalSuggestions(result: QaResult, options: { includeAll?: boolean } = {}): ProfessionalSuggestionsResult {
  const issuesWithSuggestions = result.issues.filter(hasSuggestion);
  const dispositionByIssue = new Map(result.issueDisposition.items.map((item) => [item.issueId, item]));
  const proofReadyGroups = proofReadyRootCauseGroups(result.rootCauseGroups, result.defectProof);
  const proofReadyIssueIds = new Set(proofReadyGroups.flatMap((group) => group.issueIds));
  const proofByGroup = new Map(result.rootCauseGroups.map((group) => [group.id, proofItemForGroup(result.defectProof, group.id)]));
  const returned: ProfessionalSuggestionItem[] = [];
  const suppressedBuckets: Record<string, number> = {};

  for (const issue of issuesWithSuggestions) {
    const disposition = dispositionByIssue.get(issue.id);
    const proof = disposition?.rootCauseGroupId ? proofByGroup.get(disposition.rootCauseGroupId) : undefined;
    const include = options.includeAll || proofReadyIssueIds.has(issue.id) || (disposition?.actionability === 'actionable' && disposition.status === 'confirmed' && (!proof || proof.status === 'proven' || proof.status === 'probable'));
    if (include) {
      returned.push(toItem(issue, disposition, proof));
    } else {
      inc(suppressedBuckets, disposition ? `${disposition.status}:${disposition.bucket}` : 'unknown');
    }
  }

  const actionableDispositionCount = result.issueDisposition.items.filter((item) => item.actionability === 'actionable').length;
  const nonActionableOrConditionalCount = result.issueDisposition.items.filter((item) => item.actionability !== 'actionable').length;
  return {
    mode: options.includeAll ? 'raw-all' : 'professional-default',
    summary: {
      rawSuggestionCount: issuesWithSuggestions.length,
      returnedCount: returned.length,
      suppressedCount: Math.max(0, issuesWithSuggestions.length - returned.length),
      proofReadyRootCauseCount: proofReadyGroups.length,
      actionableDispositionCount,
      nonActionableOrConditionalCount
    },
    items: returned,
    suppressedBuckets,
    notes: [
      options.includeAll
        ? 'Raw-all mode includes product/style/deployment/tool/needs-evidence suggestions for audit purposes; do not treat every row as implementation work.'
        : 'Professional default returns only proof-ready/actionable suggestions; product decisions, deployment tasks, tool limitations, and needs-evidence guesses are suppressed.',
      'Use qa-intake.config.json to answer missing PRD/product/source/test-data inputs, then rerun before promoting suppressed suggestions to defects.',
      'For API/UI data mismatch, require explicit requirement, exact list response, visible empty target UI, and source API/state/render binding before scheduling a fix.'
    ]
  };
}
