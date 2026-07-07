import type { DefectProofItem, DefectProofResult, IssueDispositionItem, ProfessionalSummaryItem, ProfessionalSummaryResult, QaQualityGate, QaSignoffResult, RegressionPlanResult, RequirementCoverageResult, RootCauseGroup } from '../types.js';
import { proofItemForGroup, proofNeedsEvidenceItems, proofReadyRootCauseGroups } from '../proof/proofReadiness.js';

export interface ProfessionalSummaryInput {
  rootCauseGroups: RootCauseGroup[];
  issueDisposition: { items: IssueDispositionItem[]; summary: { conditionalCount: number; nonActionableCount: number } };
  requirementCoverage: RequirementCoverageResult;
  qualityGate: QaQualityGate;
  qaSignoff: QaSignoffResult;
  regressionPlan: RegressionPlanResult;
  defectProof?: DefectProofResult;
}

const PRIORITY_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 } as const;
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 } as const;

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function sortRootCause(a: RootCauseGroup, b: RootCauseGroup): number {
  return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || a.title.localeCompare(b.title);
}

function makeHeadline(input: ProfessionalSummaryInput, p0p1: number, p0p1ProofGaps: number): string {
  if (input.qaSignoff.status === 'blocked') return `QA blocked: ${input.qaSignoff.blockers[0] ?? 'evidence collection or release sign-off is blocked.'}`;
  if (input.qaSignoff.status === 'fail' && p0p1 > 0) return `QA failed: ${p0p1} P0/P1 proof-ready root-cause item(s) require fixes before release.`;
  if (input.qaSignoff.status === 'fail') return 'QA failed: release/sign-off gates contain failing requirements, journeys, source-health, test-data, or other non-root-cause blockers.';
  if (p0p1ProofGaps > 0) return `QA needs evidence: ${p0p1ProofGaps} P0/P1 candidate root-cause item(s) lack professional defect proof and must not be scheduled as must-fix until confirmed.`;
  if (input.qaSignoff.status === 'pass-with-risks') return `QA pass with risks: ${input.qaSignoff.coverageGaps.length + input.qaSignoff.risks.length} risk/gap item(s) need explicit acceptance or follow-up.`;
  return 'QA passed for the collected evidence scope; keep regression rerun as the release verification gate.';
}

function proofLabel(proof?: DefectProofItem): string {
  return proof ? `Defect proof=${proof.status} (${proof.score}/100).` : 'Defect proof not available; using root-cause actionability only.';
}

function defectItems(groups: RootCauseGroup[], defectProof?: DefectProofResult): ProfessionalSummaryItem[] {
  return proofReadyRootCauseGroups(groups, defectProof)
    .sort(sortRootCause)
    .slice(0, 12)
    .map((group) => {
      const proof = proofItemForGroup(defectProof, group.id);
      return {
        id: `PS-DEFECT-${group.id}`,
        kind: 'defect',
        priority: group.priority,
        owner: group.owner,
        title: group.title,
        rationale: `${group.summary} ${proofLabel(proof)}`,
        action: group.suggestedFix,
        evidenceRefs: unique([group.id, proof?.id ?? '', ...group.issueIds, ...group.networkRequestIds, ...group.consoleIds, ...group.pageErrorIds]),
        issueIds: group.issueIds,
        rootCauseGroupId: group.id
      };
    });
}

function statusTitle(status: IssueDispositionItem['status']): string {
  return {
    confirmed: 'Confirmed raw findings',
    'needs-source-confirmation': 'Needs source/requirement confirmation',
    'deployment-only': 'Deployment/security configuration tasks',
    'product-decision': 'Product/design decisions',
    'tool-limitation': 'Tool or environment limitations',
    'insufficient-evidence': 'Insufficient-evidence observations',
    reference: 'Reference observations'
  }[status];
}

function statusAction(status: IssueDispositionItem['status']): string {
  return {
    confirmed: 'Use linked root-cause groups, not raw issue rows, for implementation work.',
    'needs-source-confirmation': 'Confirm with source code, PRD, role state, or stronger runtime evidence before scheduling fixes.',
    'deployment-only': 'Route to deployment/gateway/security-header checklist instead of frontend business code.',
    'product-decision': 'Ask product/ADR owner to confirm scope; do not treat as a code defect until required.',
    'tool-limitation': 'Do not fix app code from this signal; adjust test environment/config and rerun if needed.',
    'insufficient-evidence': 'Keep as observation until a deterministic reproduction and owner/fix surface exist.',
    reference: 'Keep for context only.'
  }[status];
}

function nonDefectItems(dispositions: IssueDispositionItem[]): ProfessionalSummaryItem[] {
  const relevant = dispositions.filter((item) => item.actionability !== 'actionable' || item.status !== 'confirmed');
  const byStatus = new Map<IssueDispositionItem['status'], IssueDispositionItem[]>();
  for (const item of relevant) byStatus.set(item.status, [...(byStatus.get(item.status) ?? []), item]);
  return [...byStatus.entries()]
    .filter(([, items]) => items.length > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 8)
    .map(([status, items]) => {
      const sample = items.slice(0, 5);
      const priority: ProfessionalSummaryItem['priority'] = sample.some((item) => item.severity === 'critical' || item.severity === 'high') ? 'P2' : 'P3';
      return {
        id: `PS-NONDEFECT-${status}`,
        kind: status === 'deployment-only' ? 'deployment' : status === 'product-decision' ? 'product-decision' : status === 'tool-limitation' ? 'tool-limitation' : 'non-defect',
        priority,
        owner: status === 'deployment-only' ? 'security' : status === 'product-decision' ? 'product' : 'test',
        title: `${statusTitle(status)} (${items.length})`,
        rationale: sample.map((item) => `${item.issueId}: ${item.reason}`).join('；'),
        action: statusAction(status),
        evidenceRefs: sample.map((item) => item.issueId),
        issueIds: sample.map((item) => item.issueId)
      };
    });
}

function coverageGapItems(input: ProfessionalSummaryInput): ProfessionalSummaryItem[] {
  const items: ProfessionalSummaryItem[] = [];
  for (const requirement of input.requirementCoverage.items.filter((item) => item.status !== 'passed' && item.status !== 'not-applicable' && (item.priority === 'P0' || item.priority === 'P1' || item.status === 'failed')).slice(0, 10)) {
    items.push({
      id: `PS-GAP-${requirement.id}`,
      kind: 'coverage-gap',
      priority: requirement.priority === 'P0' || requirement.priority === 'P1' || requirement.priority === 'P2' || requirement.priority === 'P3' ? requirement.priority : 'P2',
      owner: 'test',
      title: `${requirement.id}: ${requirement.title}`,
      rationale: requirement.gaps.join('；') || `Requirement status is ${requirement.status}.`,
      action: 'Add explicit selectors/expectedTexts/apiPatterns/safe journey steps or clarify not-applicable status, then rerun QA.',
      evidenceRefs: unique([requirement.id, ...requirement.evidence.journeyIds, ...requirement.evidence.interactionTestIds, ...requirement.evidence.issueIds]),
      requirementIds: [requirement.id]
    });
  }
  for (const gap of input.qaSignoff.coverageGaps.slice(0, Math.max(0, 10 - items.length))) {
    items.push({
      id: `PS-GAP-SIGNOFF-${items.length + 1}`,
      kind: 'coverage-gap',
      priority: 'P2',
      owner: 'test',
      title: gap,
      rationale: 'QA sign-off reported this as a coverage gap.',
      action: 'Provide the missing requirement/auth/role/test-data/environment evidence or accept the risk explicitly.',
      evidenceRefs: ['qaSignoff']
    });
  }
  for (const proof of proofNeedsEvidenceItems(input.defectProof).slice(0, Math.max(0, 12 - items.length))) {
    items.push({
      id: `PS-GAP-${proof.id}`,
      kind: 'coverage-gap',
      priority: proof.priority,
      owner: 'test',
      title: `缺陷证据不足：${proof.title}`,
      rationale: proof.missingEvidence.slice(0, 4).join('；') || 'defectProof 将该根因标记为 needs-evidence。',
      action: proof.nextSteps.join('；') || '补充运行时、源码、需求/产品范围、复现步骤和 owner/fix surface 证据后再决定是否排期。',
      evidenceRefs: unique([proof.id, proof.rootCauseGroupId, ...proof.evidenceRefs]),
      issueIds: proof.issueIds,
      rootCauseGroupId: proof.rootCauseGroupId
    });
  }
  return items;
}

function releaseRiskItems(input: ProfessionalSummaryInput): ProfessionalSummaryItem[] {
  const rows = [
    ...input.qaSignoff.blockers.map((text) => ({ text, priority: 'P0' as const })),
    ...input.qaSignoff.risks.map((text) => ({ text, priority: 'P1' as const })),
    ...input.qaSignoff.requiredFollowups.map((text) => ({ text, priority: 'P2' as const })),
    ...input.qualityGate.reasons.map((text) => ({ text, priority: input.qualityGate.status === 'blocked' || input.qualityGate.status === 'fail' ? 'P1' as const : 'P2' as const }))
  ];
  return rows.slice(0, 12).map((row, index) => ({
    id: `PS-RISK-${index + 1}`,
    kind: 'release-risk',
    priority: row.priority,
    owner: 'test',
    title: row.text,
    rationale: 'Release/sign-off gate recorded this risk.',
    action: row.priority === 'P0' || row.priority === 'P1' ? 'Resolve before release or obtain explicit release-owner exception.' : 'Track as follow-up or accepted risk.',
    evidenceRefs: ['qaSignoff', 'qualityGate']
  }));
}

function nextActionItems(plan: RegressionPlanResult): ProfessionalSummaryItem[] {
  const selected = plan.items
    .filter((item) => item.status === 'blocked' || item.status === 'needs-input' || item.priority === 'P0' || item.priority === 'P1')
    .slice(0, 10);
  return selected.map((item) => ({
    id: `PS-ACTION-${item.id}`,
    kind: 'next-action',
    priority: item.priority,
    owner: item.owner,
    title: item.title,
    rationale: item.notes?.join('；') || `Regression item status is ${item.status}.`,
    action: item.commands[0] ? `${item.steps[0] ?? 'Run verification.'} Command: ${item.commands[0]}` : item.steps[0] ?? 'Run verification.',
    evidenceRefs: item.evidenceRefs,
    issueIds: item.issueIds,
    requirementIds: item.requirementIds,
    journeyIds: item.journeyIds
  }));
}

export function buildProfessionalSummary(input: ProfessionalSummaryInput): ProfessionalSummaryResult {
  const actionableGroups = input.rootCauseGroups.filter((group) => group.status === 'actionable');
  const proofReadyGroups = proofReadyRootCauseGroups(input.rootCauseGroups, input.defectProof);
  const proofNeedsEvidence = proofNeedsEvidenceItems(input.defectProof);
  const proofBlockedCount = proofNeedsEvidence.filter((item) => item.priority === 'P0' || item.priority === 'P1').length;
  const p0p1DefectCount = proofReadyGroups.filter((group) => group.priority === 'P0' || group.priority === 'P1').length;
  const defects = defectItems(input.rootCauseGroups, input.defectProof);
  const nonDefects = nonDefectItems(input.issueDisposition.items);
  const gaps = coverageGapItems(input);
  const risks = releaseRiskItems(input);
  const actions = nextActionItems(input.regressionPlan);
  const status = input.qaSignoff.status;
  return {
    status,
    confidence: input.qaSignoff.confidence,
    businessValidationConfidence: input.qaSignoff.businessValidationConfidence,
    generatedAt: new Date().toISOString(),
    headline: makeHeadline(input, p0p1DefectCount, proofBlockedCount),
    counts: {
      actionableRootCauseCount: actionableGroups.length,
      proofReadyRootCauseCount: proofReadyGroups.length,
      p0p1DefectCount,
      defectProofNeedsEvidenceCount: proofNeedsEvidence.length,
      defectProofBlockedCount: proofBlockedCount,
      nonDefectFindingCount: input.issueDisposition.summary.nonActionableCount + input.issueDisposition.summary.conditionalCount,
      coverageGapCount: gaps.length,
      releaseRiskCount: risks.length,
      regressionBlockedCount: input.regressionPlan.summary.blockedCount,
      regressionNeedsInputCount: input.regressionPlan.summary.needsInputCount
    },
    mustFix: defects.filter((item) => item.priority === 'P0' || item.priority === 'P1'),
    shouldFix: defects.filter((item) => item.priority === 'P2' || item.priority === 'P3'),
    nonDefectObservations: nonDefects,
    coverageGaps: gaps,
    releaseRisks: risks,
    nextActions: actions,
    notes: unique([
      'Use this professionalSummary as the default human-facing answer; keep raw issues in result.json/evidence-report.md for evidence drill-down.',
      input.issueDisposition.summary.conditionalCount > 0 ? `${input.issueDisposition.summary.conditionalCount} raw finding(s) still need confirmation before they can become defects.` : '',
      proofNeedsEvidence.length > 0 ? `${proofNeedsEvidence.length} root-cause item(s) are needs-evidence and are excluded from must-fix/should-fix implementation scheduling until confirmed.` : '',
      input.regressionPlan.status !== 'ready' ? `Regression plan is ${input.regressionPlan.status}; inspect blocked/needs-input items before sign-off.` : ''
    ])
  };
}
