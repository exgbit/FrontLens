import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { normalizeResult } from '../src/resultNormalizer.ts';

type ExpectedDisposition = {
  status?: string;
  actionability?: string;
  bucket?: string;
  owner?: string;
};

type FeedbackFixture = {
  id: string;
  description: string;
  url?: string;
  title?: string;
  productContext?: Record<string, unknown>;
  scopeReview?: Record<string, unknown>;
  environment?: Record<string, unknown>;
  sourceRuntimeCorrelation?: Record<string, unknown>;
  sourceAnalysis?: Record<string, unknown>;
  sourceHealth?: Record<string, unknown>;
  interactionTests?: unknown[];
  exceptionSimulations?: unknown[];
  artifacts?: Record<string, unknown>;
  issues?: unknown[];
  expect: {
    dispositions?: Record<string, ExpectedDisposition>;
    proofReadyRootCauseCount?: number;
    mustFixIssueIds?: string[];
    shouldFixIssueIds?: string[];
    adjustedIssueCount?: number;
    claimGuardItems?: Record<string, string>;
    forbiddenClaimsIncludes?: string[];
    defectProofStatuses?: string[];
  };
};

const fixtureUrl = new URL('./fixtures/professional-feedback/cases.json', import.meta.url);

function defaultEnvironment(url: string): Record<string, unknown> {
  const isLocal = /^http:\/\/127\.0\.0\.1/.test(url);
  return {
    kind: isLocal ? 'local-dev' : 'production-like',
    confidence: isLocal ? 'high' : 'high',
    isLocalOrPrivate: isLocal,
    isHttps: /^https:/i.test(url),
    isViteDevServer: isLocal,
    hasHmr: isLocal,
    sameOriginRequestCount: 1,
    devModuleRequestCount: isLocal ? 1 : 0,
    hashedAssetCount: isLocal ? 0 : 1,
    trust: {
      functional: 'high',
      performance: isLocal ? 'low' : 'high',
      security: isLocal ? 'low' : 'high',
      businessSignoff: 'medium'
    },
    evidence: [],
    warnings: [],
    recommendations: []
  };
}

function rawResultFor(fixture: FeedbackFixture): Record<string, unknown> {
  const url = fixture.url ?? 'https://example.com/admin';
  const title = fixture.title ?? fixture.id;
  return {
    summary: {
      url,
      title,
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    metadata: {
      config: {
        target: { url },
        productContext: fixture.productContext
      }
    },
    pageModel: {
      url,
      title,
      stats: {
        domNodes: 50,
        visibleTextLength: 120,
        bodyTextSample: `${title} 页面内容 暂无数据 导出 搜索 操作`
      }
    },
    environment: fixture.environment ?? defaultEnvironment(url),
    scopeReview: fixture.scopeReview,
    sourceRuntimeCorrelation: fixture.sourceRuntimeCorrelation,
    sourceAnalysis: fixture.sourceAnalysis,
    sourceHealth: fixture.sourceHealth,
    interactionTests: fixture.interactionTests ?? [],
    exceptionSimulations: fixture.exceptionSimulations ?? [],
    artifacts: {
      outputDir: '/tmp/frontlens/professional-feedback',
      ...(fixture.artifacts ?? {})
    },
    issues: fixture.issues ?? []
  };
}

function ids(items: Array<{ issueIds?: string[] }>): string[] {
  return [...new Set(items.flatMap((item) => item.issueIds ?? []))].sort();
}

const fixtures = JSON.parse(await readFile(fixtureUrl, 'utf8')) as FeedbackFixture[];

for (const fixture of fixtures) {
  test(`professional feedback golden fixture: ${fixture.id}`, () => {
    const result = normalizeResult(rawResultFor(fixture));
    const byIssue = new Map(result.issueDisposition.items.map((item) => [item.issueId, item]));

    for (const [issueId, expected] of Object.entries(fixture.expect.dispositions ?? {})) {
      const actual = byIssue.get(issueId);
      assert.ok(actual, `${fixture.id}: missing disposition for ${issueId}`);
      if (expected.status) assert.equal(actual.status, expected.status, `${fixture.id}: ${issueId} status`);
      if (expected.actionability) assert.equal(actual.actionability, expected.actionability, `${fixture.id}: ${issueId} actionability`);
      if (expected.bucket) assert.equal(actual.bucket, expected.bucket, `${fixture.id}: ${issueId} bucket`);
      if (expected.owner) assert.equal(actual.owner, expected.owner, `${fixture.id}: ${issueId} owner`);
    }

    if (fixture.expect.proofReadyRootCauseCount !== undefined) {
      assert.equal(result.professionalSummary.counts.proofReadyRootCauseCount, fixture.expect.proofReadyRootCauseCount, `${fixture.id}: proof-ready root cause count`);
    }
    if (fixture.expect.adjustedIssueCount !== undefined) {
      assert.equal(result.summary.adjustedIssueCount, fixture.expect.adjustedIssueCount, `${fixture.id}: adjusted issue count`);
      if (fixture.expect.adjustedIssueCount === 0) assert.equal(result.summary.adjustedScore, 100, `${fixture.id}: non-defect-only score should stay 100`);
    }
    if (fixture.expect.mustFixIssueIds) {
      assert.deepEqual(ids(result.professionalSummary.mustFix), [...fixture.expect.mustFixIssueIds].sort(), `${fixture.id}: must-fix issue IDs`);
    }
    if (fixture.expect.shouldFixIssueIds) {
      assert.deepEqual(ids(result.professionalSummary.shouldFix), [...fixture.expect.shouldFixIssueIds].sort(), `${fixture.id}: should-fix issue IDs`);
    }
    for (const [claim, expectedStatus] of Object.entries(fixture.expect.claimGuardItems ?? {})) {
      const item = result.claimGuard.items.find((entry) => entry.claim === claim);
      assert.ok(item, `${fixture.id}: missing claimGuard item ${claim}`);
      assert.equal(item.status, expectedStatus, `${fixture.id}: claim ${claim} status`);
    }
    for (const expectedText of fixture.expect.forbiddenClaimsIncludes ?? []) {
      assert.equal(result.claimGuard.forbiddenClaims.some((claim) => claim.includes(expectedText)), true, `${fixture.id}: forbidden claim should include ${expectedText}`);
    }
    if (fixture.expect.defectProofStatuses) {
      assert.equal(
        result.defectProof.items.some((item) => fixture.expect.defectProofStatuses?.includes(item.status)),
        true,
        `${fixture.id}: expected at least one defectProof status in ${fixture.expect.defectProofStatuses.join(',')}`
      );
    }
    assert.notEqual(result.qaSignoff.businessValidationConfidence, 'runtime-verified', `${fixture.id}: no fixture without reviewed requirements may claim full business validation`);
  });
}
