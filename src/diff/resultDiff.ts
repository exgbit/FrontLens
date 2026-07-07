import path from 'node:path';
import type { Issue, ProfessionalSummaryItem, QaResult, QaSignoffResult, ResultDiff, ResultDiffProfessional, ResultDiffProfessionalFix, ResultDiffProfessionalSnapshot } from '../types.js';
import { writeJson, writeText, ensureDir } from '../utils/fs.js';

function byFingerprint(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.fingerprint ?? `${issue.category}:${issue.title}`, issue]));
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function fixKey(item: ProfessionalSummaryItem): string {
  if (item.rootCauseGroupId) return `root:${item.rootCauseGroupId}`;
  if (item.issueIds?.length) return `issues:${[...item.issueIds].sort().join('|')}`;
  return `title:${item.owner}:${normalizeKey(item.title)}`;
}

function professionalFixes(result: QaResult): ResultDiffProfessionalFix[] {
  const fixes = [...result.professionalSummary.mustFix, ...result.professionalSummary.shouldFix];
  const seen = new Set<string>();
  const output: ResultDiffProfessionalFix[] = [];
  for (const item of fixes) {
    const key = fixKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push({
      key,
      title: item.title,
      priority: item.priority,
      owner: item.owner,
      issueIds: item.issueIds ?? [],
      rootCauseGroupId: item.rootCauseGroupId
    });
  }
  return output;
}

function byFixKey(items: ResultDiffProfessionalFix[]): Map<string, ResultDiffProfessionalFix> {
  return new Map(items.map((item) => [item.key, item]));
}

function snapshot(result: QaResult): ResultDiffProfessionalSnapshot {
  return {
    adjustedScore: result.summary.adjustedScore,
    adjustedIssueCount: result.summary.adjustedIssueCount,
    qaSignoffStatus: result.qaSignoff.status,
    qaSignoffConfidence: result.qaSignoff.confidence,
    businessValidationConfidence: result.qaSignoff.businessValidationConfidence,
    proofReadyRootCauseCount: result.professionalSummary.counts.proofReadyRootCauseCount,
    mustFixCount: result.professionalSummary.mustFix.length,
    shouldFixCount: result.professionalSummary.shouldFix.length,
    releaseRiskCount: result.professionalSummary.counts.releaseRiskCount,
    regressionBlockedCount: result.professionalSummary.counts.regressionBlockedCount,
    regressionNeedsInputCount: result.professionalSummary.counts.regressionNeedsInputCount,
    actionableIssueCount: result.issueDisposition.summary.actionableCount,
    nonActionableFindingCount: result.professionalSummary.counts.nonDefectFindingCount,
    coverageGapCount: result.professionalSummary.counts.coverageGapCount
  };
}

function signoffRank(status: QaSignoffResult['status']): number {
  return { pass: 0, 'pass-with-risks': 1, fail: 2, blocked: 3 }[status];
}

function businessRank(status: QaSignoffResult['businessValidationConfidence']): number {
  return { 'runtime-verified': 0, 'runtime-partial': 1, 'static-source-only': 2, 'not-verified': 3 }[status];
}

function buildProfessionalDiff(before: QaResult, after: QaResult): ResultDiffProfessional {
  const beforeSnapshot = snapshot(before);
  const afterSnapshot = snapshot(after);
  const beforeFixMap = byFixKey(professionalFixes(before));
  const afterFixMap = byFixKey(professionalFixes(after));
  const addedFixes = [...afterFixMap.entries()].filter(([key]) => !beforeFixMap.has(key)).map(([, fix]) => fix);
  const resolvedFixes = [...beforeFixMap.entries()].filter(([key]) => !afterFixMap.has(key)).map(([, fix]) => fix);
  const persistentFixes = [...afterFixMap.entries()]
    .filter(([key]) => beforeFixMap.has(key))
    .map(([key, fix]) => ({ before: beforeFixMap.get(key)!, after: fix }));

  const adjustedScoreDelta = afterSnapshot.adjustedScore - beforeSnapshot.adjustedScore;
  const adjustedIssueDelta = afterSnapshot.adjustedIssueCount - beforeSnapshot.adjustedIssueCount;
  const proofReadyRootCauseDelta = afterSnapshot.proofReadyRootCauseCount - beforeSnapshot.proofReadyRootCauseCount;
  const releaseRiskDelta = afterSnapshot.releaseRiskCount - beforeSnapshot.releaseRiskCount;
  const regressionBlockedDelta = afterSnapshot.regressionBlockedCount - beforeSnapshot.regressionBlockedCount;
  const regressionNeedsInputDelta = afterSnapshot.regressionNeedsInputCount - beforeSnapshot.regressionNeedsInputCount;
  const signoffDelta = signoffRank(afterSnapshot.qaSignoffStatus) - signoffRank(beforeSnapshot.qaSignoffStatus);
  const businessDelta = businessRank(afterSnapshot.businessValidationConfidence) - businessRank(beforeSnapshot.businessValidationConfidence);

  const improvedSignals = [
    adjustedScoreDelta > 0,
    adjustedIssueDelta < 0,
    proofReadyRootCauseDelta < 0,
    resolvedFixes.length > 0,
    releaseRiskDelta < 0,
    regressionBlockedDelta < 0,
    regressionNeedsInputDelta < 0,
    signoffDelta < 0,
    businessDelta < 0
  ].filter(Boolean).length;
  const regressedSignals = [
    adjustedScoreDelta < 0,
    adjustedIssueDelta > 0,
    proofReadyRootCauseDelta > 0,
    addedFixes.length > 0,
    releaseRiskDelta > 0,
    regressionBlockedDelta > 0,
    regressionNeedsInputDelta > 0,
    signoffDelta > 0,
    businessDelta > 0
  ].filter(Boolean).length;
  const interpretation: ResultDiffProfessional['interpretation'] = improvedSignals > 0 && regressedSignals > 0
    ? 'mixed'
    : regressedSignals > 0
      ? 'regressed'
      : improvedSignals > 0
        ? 'improved'
        : 'unchanged';

  const notes = [
    'Professional diff uses adjustedScore, qaSignoff, professionalSummary, issueDisposition, and proof-ready fix workload before raw issue counts.',
    addedFixes.length > 0 ? `${addedFixes.length} new proof-ready fix item(s) appeared.` : '',
    resolvedFixes.length > 0 ? `${resolvedFixes.length} proof-ready fix item(s) were resolved.` : '',
    signoffDelta !== 0 ? `QA sign-off changed from ${beforeSnapshot.qaSignoffStatus} to ${afterSnapshot.qaSignoffStatus}.` : '',
    businessDelta !== 0 ? `Business validation confidence changed from ${beforeSnapshot.businessValidationConfidence} to ${afterSnapshot.businessValidationConfidence}.` : ''
  ].filter(Boolean);

  return {
    before: beforeSnapshot,
    after: afterSnapshot,
    adjustedScoreDelta,
    adjustedIssueDelta,
    proofReadyRootCauseDelta,
    releaseRiskDelta,
    regressionBlockedDelta,
    regressionNeedsInputDelta,
    signoffChanged: beforeSnapshot.qaSignoffStatus !== afterSnapshot.qaSignoffStatus,
    businessValidationChanged: beforeSnapshot.businessValidationConfidence !== afterSnapshot.businessValidationConfidence,
    addedFixes,
    resolvedFixes,
    persistentFixes,
    interpretation,
    notes
  };
}

export function createResultDiff(before: QaResult, after: QaResult): ResultDiff {
  const beforeMap = byFingerprint(before.issues);
  const afterMap = byFingerprint(after.issues);
  const addedIssues = [...afterMap.entries()].filter(([fingerprint]) => !beforeMap.has(fingerprint)).map(([, issue]) => issue);
  const resolvedIssues = [...beforeMap.entries()].filter(([fingerprint]) => !afterMap.has(fingerprint)).map(([, issue]) => issue);
  const persistentIssues = [...afterMap.entries()].filter(([fingerprint]) => beforeMap.has(fingerprint)).map(([fingerprint, issue]) => ({ before: beforeMap.get(fingerprint)!, after: issue }));
  const changedSeverity = persistentIssues
    .filter((item) => item.before.severity !== item.after.severity)
    .map((item) => ({ fingerprint: item.after.fingerprint ?? '', before: item.before.severity, after: item.after.severity, title: item.after.title }));
  return {
    before: { url: before.summary.url, score: before.summary.score, issueCount: before.summary.issueCount, testedAt: before.summary.testedAt },
    after: { url: after.summary.url, score: after.summary.score, issueCount: after.summary.issueCount, testedAt: after.summary.testedAt },
    scoreDelta: after.summary.score - before.summary.score,
    addedIssues,
    resolvedIssues,
    persistentIssues,
    changedSeverity,
    securityScoreDelta: after.security && before.security ? after.security.score - before.security.score : undefined,
    performance: {
      fcpDeltaMs: after.performance.paint.firstContentfulPaintMs !== undefined && before.performance.paint.firstContentfulPaintMs !== undefined ? after.performance.paint.firstContentfulPaintMs - before.performance.paint.firstContentfulPaintMs : undefined,
      loadDeltaMs: after.performance.navigation?.loadMs !== undefined && before.performance.navigation?.loadMs !== undefined ? after.performance.navigation.loadMs - before.performance.navigation.loadMs : undefined,
      transferDeltaBytes: after.performance.resources.totalTransferSize - before.performance.resources.totalTransferSize
    },
    professional: buildProfessionalDiff(before, after)
  };
}

function issueRows(issues: Issue[]): string {
  if (!issues.length) return 'None.';
  return ['| Severity | Category | Title | Fingerprint |', '| --- | --- | --- | --- |', ...issues.map((issue) => `| ${issue.severity} | ${issue.category} | ${issue.title} | ${issue.fingerprint ?? '-'} |`)].join('\n');
}

function professionalFixRows(fixes: ResultDiffProfessionalFix[]): string {
  if (!fixes.length) return 'None.';
  return ['| Priority | Owner | Title | Key |', '| --- | --- | --- | --- |', ...fixes.map((fix) => `| ${fix.priority} | ${fix.owner} | ${fix.title} | ${fix.key} |`)].join('\n');
}

export async function writeResultDiff(diff: ResultDiff, outputDir: string): Promise<{ json: string; markdown: string }> {
  await ensureDir(outputDir);
  const json = path.join(outputDir, 'diff.json');
  const markdown = path.join(outputDir, 'diff.md');
  await writeJson(json, diff);
  await writeText(
    markdown,
    `# FrontLens Result Diff

## Professional QA Diff

- Interpretation: ${diff.professional.interpretation}
- Adjusted score: ${diff.professional.before.adjustedScore} → ${diff.professional.after.adjustedScore} (${diff.professional.adjustedScoreDelta})
- QA sign-off: ${diff.professional.before.qaSignoffStatus} → ${diff.professional.after.qaSignoffStatus}${diff.professional.signoffChanged ? ' (changed)' : ''}
- Business validation: ${diff.professional.before.businessValidationConfidence} → ${diff.professional.after.businessValidationConfidence}${diff.professional.businessValidationChanged ? ' (changed)' : ''}
- Proof-ready root causes: ${diff.professional.before.proofReadyRootCauseCount} → ${diff.professional.after.proofReadyRootCauseCount} (${diff.professional.proofReadyRootCauseDelta})
- Regression blocked / needs-input: ${diff.professional.before.regressionBlockedCount}/${diff.professional.before.regressionNeedsInputCount} → ${diff.professional.after.regressionBlockedCount}/${diff.professional.after.regressionNeedsInputCount}

### New Proof-ready Fixes

${professionalFixRows(diff.professional.addedFixes)}

### Resolved Proof-ready Fixes

${professionalFixRows(diff.professional.resolvedFixes)}

### Professional Notes

${diff.professional.notes.map((note) => `- ${note}`).join('\n')}

## Raw Scanner Diff

- Before: ${diff.before.url} / raw score ${diff.before.score} / raw issues ${diff.before.issueCount}
- After: ${diff.after.url} / raw score ${diff.after.score} / raw issues ${diff.after.issueCount}
- Raw score delta: ${diff.scoreDelta}
- Security score delta: ${diff.securityScoreDelta ?? '-'}

### Added Raw Issues

${issueRows(diff.addedIssues)}

### Resolved Raw Issues

${issueRows(diff.resolvedIssues)}

### Severity Changes

${diff.changedSeverity.length ? ['| Fingerprint | Title | Before | After |', '| --- | --- | --- | --- |', ...diff.changedSeverity.map((item) => `| ${item.fingerprint} | ${item.title} | ${item.before} | ${item.after} |`)].join('\n') : 'None.'}
`
  );
  return { json, markdown };
}
