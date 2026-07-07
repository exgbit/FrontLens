import type { FixTask, ProfessionalSummaryItem, QaResult, RootCauseGroup } from '../types.js';
import { proofReadyRootCauseGroups } from '../proof/proofReadiness.js';

export type ProfessionalAuditStatus = 'passed' | 'warning' | 'failed';
export type ProfessionalAuditSeverity = 'blocker' | 'warning' | 'info';
export type ProfessionalAuditCategory =
  | 'artifact-integrity'
  | 'report-content'
  | 'claim-guard'
  | 'qa-signoff'
  | 'overclaim'
  | 'coverage'
  | 'fix-queue'
  | 'source-evidence'
  | 'scope'
  | 'environment'
  | 'consistency';

export interface ProfessionalAuditFinding {
  id: string;
  severity: ProfessionalAuditSeverity;
  category: ProfessionalAuditCategory;
  title: string;
  evidenceRefs: string[];
  recommendation: string;
}

export interface ProfessionalAuditResult {
  status: ProfessionalAuditStatus;
  checkedAt: string;
  summary: {
    findingCount: number;
    blockerCount: number;
    warningCount: number;
    infoCount: number;
    proofReadyRootCauseCount: number;
    mustFixCount: number;
    shouldFixCount: number;
    fixTaskCount: number;
  };
  findings: ProfessionalAuditFinding[];
  notes: string[];
}

function issueIdsFromGroups(groups: RootCauseGroup[]): Set<string> {
  return new Set(groups.flatMap((group) => group.issueIds));
}

function isFrontendOwnedGroup(group: RootCauseGroup): boolean {
  return group.owner === 'frontend' && group.categories.some((category) => category.startsWith('frontend') || category.startsWith('integration'));
}

function issueIdsOf(item: ProfessionalSummaryItem | FixTask): string[] {
  return item.issueIds ?? [];
}

function missingFromProofReady(item: ProfessionalSummaryItem | FixTask, proofReadyIssueIds: Set<string>): string[] {
  return issueIdsOf(item).filter((issueId) => !proofReadyIssueIds.has(issueId));
}

function add(findings: ProfessionalAuditFinding[], input: Omit<ProfessionalAuditFinding, 'id'>): void {
  findings.push({ id: `AUDIT-${String(findings.length + 1).padStart(3, '0')}`, ...input });
}

function auditOverclaims(result: QaResult, findings: ProfessionalAuditFinding[]): void {
  const runtimeVerified = result.qaSignoff.businessValidationConfidence === 'runtime-verified';
  const hasProvidedRequirements = result.requirementCoverage.summary.providedCount > 0;
  const hasRuntimeAssertions = result.qaSignoff.scope.assertionStepCount > 0 && result.qaSignoff.scope.passedAssertionStepCount > 0;
  if (runtimeVerified && (!hasProvidedRequirements || !hasRuntimeAssertions)) {
    add(findings, {
      severity: 'blocker',
      category: 'overclaim',
      title: 'Business validation is runtime-verified without provided requirements and passing runtime assertions.',
      evidenceRefs: ['qaSignoff.businessValidationConfidence', 'requirementCoverage.summary.providedCount', 'qaSignoff.scope.assertionStepCount'],
      recommendation: 'Downgrade business validation to runtime-partial/not-verified, or provide reviewed requirements plus passing assertion-backed journeys.'
    });
  }
  const businessClaim = result.claimGuard.items.find((item) => item.claim === 'business-validation');
  if (businessClaim?.status !== 'allowed' && runtimeVerified) {
    add(findings, {
      severity: 'blocker',
      category: 'overclaim',
      title: 'qaSignoff says runtime-verified while claimGuard limits business-validation wording.',
      evidenceRefs: ['qaSignoff', 'claimGuard.items[business-validation]'],
      recommendation: 'Align qaSignoff with claimGuard; keep the final wording limited until required inputs are supplied.'
    });
  }
}

function auditCoverageBoundary(result: QaResult, findings: ProfessionalAuditFinding[]): void {
  const coverage = result.qaCoverage;
  const gapCount = coverage.summary.partialCount + coverage.summary.skippedCount + coverage.summary.needsInputCount + coverage.summary.failedCount;
  const failedRows = coverage.items.filter((item) => item.status === 'failed');
  const acceptanceLikeSignoff = result.qaSignoff.status === 'pass' || result.qaSignoff.businessValidationConfidence === 'runtime-verified';
  const businessClaimAllowed = result.claimGuard.items.find((item) => item.claim === 'business-validation')?.status === 'allowed';

  if (coverage.status !== 'sufficient') {
    add(findings, {
      severity: acceptanceLikeSignoff || businessClaimAllowed || coverage.status === 'insufficient' && failedRows.length > 0 ? 'blocker' : 'warning',
      category: 'coverage',
      title: `QA coverage is ${coverage.status}; ${gapCount} dimension(s) are partial/skipped/needs-input/failed.`,
      evidenceRefs: ['qaCoverage', ...coverage.items.filter((item) => item.status !== 'covered').slice(0, 6).map((item) => item.id)],
      recommendation: acceptanceLikeSignoff || businessClaimAllowed
        ? 'Downgrade acceptance/business-validation wording until qaCoverage is sufficient, or close the listed coverage gaps with PRD-backed runtime evidence.'
        : 'Surface these rows as coverage gaps in the final answer; do not describe skipped or needs-input dimensions as passed.'
    });
  }

  if (failedRows.length > 0 && result.qaSignoff.status !== 'fail' && result.qaSignoff.status !== 'blocked') {
    add(findings, {
      severity: 'blocker',
      category: 'coverage',
      title: `QA coverage contains failed dimension(s) while QA sign-off is ${result.qaSignoff.status}.`,
      evidenceRefs: ['qaCoverage.items[failed]', 'qaSignoff.status', ...failedRows.slice(0, 6).map((item) => item.id)],
      recommendation: 'Align QA sign-off with failed coverage rows, or rerun/fix the failed dimension before presenting the report as professionally signable.'
    });
  }
}

function auditFixQueue(result: QaResult, findings: ProfessionalAuditFinding[], proofReadyIssueIds: Set<string>): void {
  const dispositionByIssue = new Map(result.issueDisposition.items.map((item) => [item.issueId, item]));
  const scheduled = [...result.professionalSummary.mustFix, ...result.professionalSummary.shouldFix];
  for (const item of scheduled) {
    const missing = missingFromProofReady(item, proofReadyIssueIds);
    if (missing.length > 0) {
      add(findings, {
        severity: 'blocker',
        category: 'fix-queue',
        title: `Professional summary schedules non-proof-ready issue(s): ${missing.join(', ')}.`,
        evidenceRefs: [item.id, ...missing],
        recommendation: 'Remove needs-evidence/non-actionable items from must-fix/should-fix, or strengthen defectProof to proven/probable first.'
      });
    }
    const nonActionable = issueIdsOf(item).filter((issueId) => dispositionByIssue.get(issueId)?.actionability !== 'actionable');
    if (nonActionable.length > 0) {
      add(findings, {
        severity: 'blocker',
        category: 'fix-queue',
        title: `Professional summary schedules non-actionable issue(s): ${nonActionable.join(', ')}.`,
        evidenceRefs: [item.id, ...nonActionable],
        recommendation: 'Keep product/deployment/tool/insufficient-evidence findings in non-defect or evidence-gap sections.'
      });
    }
  }
  for (const task of result.fixTasks) {
    const missing = missingFromProofReady(task, proofReadyIssueIds);
    if (missing.length > 0) {
      add(findings, {
        severity: 'blocker',
        category: 'fix-queue',
        title: `Fix task ${task.id} contains non-proof-ready issue(s): ${missing.join(', ')}.`,
        evidenceRefs: [task.id, ...missing],
        recommendation: 'Generate fix tasks only from proof-ready root causes; use regression/evidence tasks for needs-evidence items.'
      });
    }
  }
}

function auditSourceEvidence(result: QaResult, findings: ProfessionalAuditFinding[], proofReadyGroups: RootCauseGroup[]): void {
  const sourceEnabled = result.sourceAnalysis.enabled || Boolean(result.sourceAnalysis.root);
  if (!sourceEnabled) return;
  for (const group of proofReadyGroups.filter(isFrontendOwnedGroup)) {
    if (group.sourceLocations.length === 0) {
      add(findings, {
        severity: 'warning',
        category: 'source-evidence',
        title: `Proof-ready frontend root cause lacks file:line source location: ${group.id}.`,
        evidenceRefs: [group.id, ...group.issueIds],
        recommendation: 'Add sourceRuntimeCorrelation/sourceAnalysis file:line evidence, or downgrade the group to needs-evidence before scheduling implementation.'
      });
    }
  }
  if (result.sourceRuntimeCorrelation.enabled && result.sourceRuntimeCorrelation.status !== 'passed') {
    add(findings, {
      severity: 'warning',
      category: 'source-evidence',
      title: `sourceRuntimeCorrelation is ${result.sourceRuntimeCorrelation.status}; API/UI binding claims should remain limited.`,
      evidenceRefs: ['sourceRuntimeCorrelation.status'],
      recommendation: 'Rerun with reachable source/runtime binding, or keep API/UI conclusions as needs-evidence.'
    });
  }
}

function auditEnvironmentAndScope(result: QaResult, findings: ProfessionalAuditFinding[]): void {
  if (result.artifactIntegrity.status === 'failed') {
    add(findings, {
      severity: 'blocker',
      category: 'artifact-integrity',
      title: `Artifact integrity failed with ${result.artifactIntegrity.missingCount} missing artifact(s).`,
      evidenceRefs: ['artifactIntegrity'],
      recommendation: 'Regenerate missing screenshots/DOM/downloads/reports before citing them as professional QA evidence.'
    });
  }
  if (result.reportContentAudit.status === 'failed') {
    add(findings, {
      severity: 'blocker',
      category: 'report-content',
      title: `Report content audit failed with ${result.reportContentAudit.summary.blockerCount} blocker(s).`,
      evidenceRefs: ['reportContentAudit', 'artifacts.reportContentAudit'],
      recommendation: 'Fix generated-report wording/depth blockers before trusting or echoing the human-facing report conclusion.'
    });
  } else if (result.reportContentAudit.status === 'warning') {
    add(findings, {
      severity: 'warning',
      category: 'report-content',
      title: `Report content audit has ${result.reportContentAudit.summary.warningCount} warning(s).`,
      evidenceRefs: ['reportContentAudit', 'artifacts.reportContentAudit'],
      recommendation: 'Review report-content-audit.md and keep final wording within profile/coverage/raw-score boundaries.'
    });
  }
  if (result.claimGuard.status === 'blocked') {
    add(findings, {
      severity: 'blocker',
      category: 'claim-guard',
      title: 'Claim guard is blocked.',
      evidenceRefs: ['claimGuard'],
      recommendation: 'Remove contradicted claims from the final answer and resolve blocked claim inputs.'
    });
  } else if (result.claimGuard.status === 'limited') {
    add(findings, {
      severity: 'warning',
      category: 'claim-guard',
      title: 'Claim guard is limited; final wording must stay scoped.',
      evidenceRefs: ['claimGuard.requiredInputs'],
      recommendation: 'Use claimGuard allowedWording and avoid all forbiddenClaims in user-facing conclusions.'
    });
  }
  if (result.qaSignoff.status === 'blocked' || result.qaSignoff.status === 'fail') {
    add(findings, {
      severity: 'blocker',
      category: 'qa-signoff',
      title: `QA sign-off is ${result.qaSignoff.status}.`,
      evidenceRefs: ['qaSignoff.blockers', 'qaSignoff.summary'],
      recommendation: 'Resolve QA blockers/failures before presenting the page as accepted.'
    });
  } else if (result.qaSignoff.status === 'pass-with-risks') {
    add(findings, {
      severity: 'warning',
      category: 'qa-signoff',
      title: 'QA sign-off is pass-with-risks.',
      evidenceRefs: ['qaSignoff.risks', 'qaSignoff.coverageGaps'],
      recommendation: 'Report the explicit risks/gaps and avoid unconditional release wording.'
    });
  }
  if (result.qaIntake.status === 'blocked') {
    add(findings, {
      severity: 'blocker',
      category: 'scope',
      title: 'QA intake is blocked by missing professional inputs.',
      evidenceRefs: ['qaIntake.topQuestions'],
      recommendation: 'Answer P0/P1 intake questions before converting linked observations into defects or sign-off.'
    });
  } else if (result.qaIntake.status === 'needs-input') {
    add(findings, {
      severity: 'warning',
      category: 'scope',
      title: 'QA intake still needs product/requirement/environment input.',
      evidenceRefs: ['qaIntake.topQuestions'],
      recommendation: 'Keep linked conclusions conditional and list the top follow-up questions.'
    });
  }
  if (result.scopeReview.status === 'needs-input' && result.issueDisposition.summary.productDecisionCount > 0) {
    add(findings, {
      severity: 'warning',
      category: 'scope',
      title: 'Product-scope findings exist while scopeReview still needs input.',
      evidenceRefs: ['scopeReview.questions', 'issueDisposition.summary.productDecisionCount'],
      recommendation: 'Encode confirmed productContext before promoting style/device/optional-feature findings.'
    });
  }
  if (result.environment.isViteDevServer && (result.environment.trust.performance === 'low' || result.environment.trust.security === 'low')) {
    const perfAllowed = result.claimGuard.items.find((item) => item.claim === 'production-performance')?.status === 'allowed';
    const securityAllowed = result.claimGuard.items.find((item) => item.claim === 'production-security')?.status === 'allowed';
    if (perfAllowed || securityAllowed) {
      add(findings, {
        severity: 'blocker',
        category: 'environment',
        title: 'Production performance/security claim is allowed on a Vite dev-server run.',
        evidenceRefs: ['environment', 'claimGuard'],
        recommendation: 'Run build+preview or a production-like HTTPS target before allowing production readiness claims.'
      });
    }
  }
}

function auditConsistency(result: QaResult, findings: ProfessionalAuditFinding[], proofReadyGroups: RootCauseGroup[], proofReadyIssueIds: Set<string>): void {
  if (result.professionalSummary.counts.proofReadyRootCauseCount !== proofReadyGroups.length) {
    add(findings, {
      severity: 'blocker',
      category: 'consistency',
      title: 'professionalSummary proof-ready count does not match defectProof/rootCauseGroups.',
      evidenceRefs: ['professionalSummary.counts.proofReadyRootCauseCount', 'rootCauseGroups', 'defectProof'],
      recommendation: 'Normalize/rebuild result.json before using it for sign-off or CI.'
    });
  }
  if (result.summary.adjustedIssueCount > proofReadyIssueIds.size) {
    add(findings, {
      severity: 'warning',
      category: 'consistency',
      title: 'summary.adjustedIssueCount is greater than proof-ready issue count.',
      evidenceRefs: ['summary.adjustedIssueCount', 'defectProof', 'rootCauseGroups'],
      recommendation: 'Check whether adjustedScore was computed with an older schema; normalize or rerun FrontLens.'
    });
  }
}

export function runProfessionalAudit(result: QaResult): ProfessionalAuditResult {
  const findings: ProfessionalAuditFinding[] = [];
  const proofReadyGroups = proofReadyRootCauseGroups(result.rootCauseGroups, result.defectProof);
  const proofReadyIssueIds = issueIdsFromGroups(proofReadyGroups);

  auditEnvironmentAndScope(result, findings);
  auditCoverageBoundary(result, findings);
  auditOverclaims(result, findings);
  auditFixQueue(result, findings, proofReadyIssueIds);
  auditSourceEvidence(result, findings, proofReadyGroups);
  auditConsistency(result, findings, proofReadyGroups, proofReadyIssueIds);

  const blockerCount = findings.filter((item) => item.severity === 'blocker').length;
  const warningCount = findings.filter((item) => item.severity === 'warning').length;
  const infoCount = findings.filter((item) => item.severity === 'info').length;
  return {
    status: blockerCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed',
    checkedAt: new Date().toISOString(),
    summary: {
      findingCount: findings.length,
      blockerCount,
      warningCount,
      infoCount,
      proofReadyRootCauseCount: proofReadyGroups.length,
      mustFixCount: result.professionalSummary.mustFix.length,
      shouldFixCount: result.professionalSummary.shouldFix.length,
      fixTaskCount: result.fixTasks.length
    },
    findings,
    notes: [
      'Professional audit validates the report contract itself: coverage boundaries, no overclaiming, no non-proof-ready fix queue items, artifact integrity, source evidence, and scope/claim guard alignment.',
      'A warning result can still be useful for exploratory QA, but user-facing conclusions must include the listed limitations.'
    ]
  };
}

export function formatProfessionalAudit(audit: ProfessionalAuditResult): string {
  const rows = audit.findings.map((finding) => `| ${finding.id} | ${finding.severity} | ${finding.category} | ${finding.title.replace(/\|/g, '\\|')} | ${finding.recommendation.replace(/\|/g, '\\|')} |`);
  return `# FrontLens Professional Audit

- Status: **${audit.status}**
- Findings: ${audit.summary.findingCount}（blockers ${audit.summary.blockerCount}, warnings ${audit.summary.warningCount}, info ${audit.summary.infoCount}）
- Proof-ready root causes: ${audit.summary.proofReadyRootCauseCount}
- Must-fix / should-fix / fixTasks: ${audit.summary.mustFixCount} / ${audit.summary.shouldFixCount} / ${audit.summary.fixTaskCount}

${rows.length ? ['| ID | Severity | Category | Finding | Recommendation |', '| --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No professional-report contract issues found.'}
`;
}
