import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createResultDiff, writeResultDiff } from '../src/diff/resultDiff.ts';
import type { ProfessionalSummaryItem, QaResult } from '../src/types.ts';

function fix(id: string, title = `Fix ${id}`): ProfessionalSummaryItem {
  return {
    id,
    kind: 'defect',
    priority: 'P1',
    owner: 'frontend',
    title,
    rationale: 'Proof-ready defect.',
    action: 'Fix and rerun.',
    evidenceRefs: [id],
    issueIds: [id],
    rootCauseGroupId: `RC-${id}`
  };
}

function result(input: {
  rawScore: number;
  adjustedScore: number;
  rawIssues?: number;
  signoff: 'pass' | 'pass-with-risks' | 'fail' | 'blocked';
  business?: 'runtime-verified' | 'runtime-partial' | 'static-source-only' | 'not-verified';
  fixes?: ProfessionalSummaryItem[];
}): QaResult {
  const issues = Array.from({ length: input.rawIssues ?? 0 }, (_, index) => ({
    id: `ISSUE-${index + 1}`,
    fingerprint: `raw-${index + 1}`,
    title: `Raw issue ${index + 1}`,
    category: 'frontend-ui',
    severity: 'low',
    confidence: 0.5,
    description: 'Raw scanner issue.',
    evidence: {},
    reproduceSteps: [],
    reason: 'raw',
    suggestion: {},
    source: 'rule'
  }));
  const fixes = input.fixes ?? [];
  return {
    summary: {
      url: 'https://example.com/page',
      title: 'Page',
      score: input.rawScore,
      adjustedScore: input.adjustedScore,
      issueCount: issues.length,
      adjustedIssueCount: fixes.length,
      scoreBasis: 'actionable+proof',
      scoreNotes: [],
      criticalCount: 0,
      highCount: 0,
      mediumCount: 0,
      lowCount: issues.length,
      infoCount: 0,
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1280, height: 720 }
    },
    issues,
    performance: { paint: {}, resources: { totalTransferSize: 1000 }, budgets: [], longTasks: [], navigation: {} },
    professionalSummary: {
      status: input.signoff,
      confidence: 'medium',
      businessValidationConfidence: input.business ?? 'runtime-partial',
      generatedAt: '2026-07-07T00:00:00.000Z',
      headline: 'summary',
      counts: {
        actionableRootCauseCount: fixes.length,
        proofReadyRootCauseCount: fixes.length,
        p0p1DefectCount: fixes.length,
        defectProofNeedsEvidenceCount: 0,
        defectProofBlockedCount: 0,
        nonDefectFindingCount: Math.max(0, issues.length - fixes.length),
        coverageGapCount: 0,
        releaseRiskCount: input.signoff === 'pass' ? 0 : 1,
        regressionBlockedCount: input.signoff === 'blocked' ? 1 : 0,
        regressionNeedsInputCount: input.signoff === 'pass' ? 0 : 1
      },
      mustFix: fixes,
      shouldFix: [],
      nonDefectObservations: [],
      coverageGaps: [],
      releaseRisks: [],
      nextActions: [],
      notes: []
    },
    qaSignoff: {
      status: input.signoff,
      confidence: 'medium',
      businessValidationConfidence: input.business ?? 'runtime-partial',
      checkedAt: '2026-07-07T00:00:00.000Z',
      summary: 'signoff',
      scope: {} as never,
      blockers: [],
      risks: [],
      coverageGaps: [],
      requiredFollowups: [],
      evidence: []
    },
    issueDisposition: {
      checkedAt: '2026-07-07T00:00:00.000Z',
      targetUrl: 'https://example.com/page',
      summary: {
        totalCount: issues.length,
        actionableCount: fixes.length,
        conditionalCount: 0,
        nonActionableCount: Math.max(0, issues.length - fixes.length),
        confirmedCount: fixes.length,
        needsSourceConfirmationCount: 0,
        deploymentOnlyCount: 0,
        productDecisionCount: 0,
        toolLimitationCount: 0,
        insufficientEvidenceCount: 0,
        referenceCount: 0,
        bucketCounts: {} as never,
        statusCounts: {} as never
      },
      items: []
    }
  } as unknown as QaResult;
}

test('result diff leads with professional QA signal instead of raw scanner noise', async () => {
  const before = result({ rawScore: 90, adjustedScore: 50, rawIssues: 0, signoff: 'fail', business: 'runtime-partial', fixes: [fix('A', 'Render API error state')] });
  const after = result({ rawScore: 80, adjustedScore: 95, rawIssues: 2, signoff: 'pass', business: 'runtime-verified', fixes: [] });

  const diff = createResultDiff(before, after);

  assert.equal(diff.scoreDelta, -10, 'raw scanner score can regress due to noise');
  assert.equal(diff.professional.adjustedScoreDelta, 45);
  assert.equal(diff.professional.interpretation, 'improved');
  assert.equal(diff.professional.resolvedFixes.length, 1);
  assert.equal(diff.professional.addedFixes.length, 0);
  assert.equal(diff.professional.signoffChanged, true);
  assert.equal(diff.professional.businessValidationChanged, true);

  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-diff-'));
  const artifacts = await writeResultDiff(diff, dir);
  const markdown = await readFile(artifacts.markdown, 'utf8');
  assert.match(markdown, /Professional QA Diff/);
  assert.match(markdown, /Interpretation: improved/);
  assert.match(markdown, /Raw Scanner Diff/);
});
