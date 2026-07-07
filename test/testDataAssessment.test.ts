import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildTestDataAssessment, writeTestDataAssessment } from '../src/testData/testDataAssessment.ts';
import { buildQaSignoff } from '../src/signoff/qaSignoff.ts';
import type { ArtifactIntegrityResult, QaQualityGate, RequirementCoverageResult, SourceHealthResult } from '../src/types.ts';

function requirementCoverage(title = '删除用户'): RequirementCoverageResult {
  return {
    enabled: true,
    checkedAt: '',
    source: 'provided',
    summary: {
      requirementCount: 1,
      passedCount: 0,
      failedCount: 0,
      partialCount: 0,
      notCoveredCount: 1,
      notApplicableCount: 0,
      providedCount: 1,
      inferredCount: 0,
      highPriorityGapCount: 1
    },
    items: [
      {
        id: 'REQ-DELETE',
        title,
        priority: 'P1',
        source: 'provided',
        status: 'not-covered',
        confidence: 'low',
        evidence: { selectors: [], componentIds: [], journeyIds: [], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
        gaps: ['not covered']
      }
    ],
    gaps: []
  };
}

test('test data assessment flags destructive requirements without isolated records or cleanup', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-test-data-'));
  try {
    const config = createDefaultConfig('https://example.com/admin/users');
    const result = buildTestDataAssessment(config, requirementCoverage());
    assert.equal(result.status, 'warning');
    assert.equal(result.summary.destructiveRequirementCount, 1);
    assert.equal(result.findings.some((finding) => finding.category === 'missing-data'), true);
    const artifacts = await writeTestDataAssessment(result, dir);
    assert.match(await readFile(artifacts.markdown, 'utf8'), /Test Data Assessment/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('empty test data plan is informational for read-only scans', () => {
  const config = createDefaultConfig('https://example.com/admin/reports');
  const result = buildTestDataAssessment(config);
  assert.equal(result.status, 'passed');
  assert.equal(result.findings.length, 0);
  assert.match(result.recommendations.join(' '), /No mutating/);
});

test('test data assessment fails production writes without explicit approval', () => {
  const config = createDefaultConfig('https://example.com/admin/users');
  config.safety.allowDelete = true;
  config.testData.environment = 'production';
  config.testData.setupSteps = [
    { id: 'delete-user', title: 'Delete seeded user', type: 'api', method: 'DELETE', endpoint: '/api/users/seed' }
  ];
  const result = buildTestDataAssessment(config, requirementCoverage());
  assert.equal(result.status, 'failed');
  assert.equal(result.summary.productionRiskCount, 1);
});

test('qa signoff fails when test data lifecycle has production mutation risk', () => {
  const config = createDefaultConfig('https://example.com/admin/users');
  const testData = buildTestDataAssessment(
    Object.assign(config, {
      testData: {
        ...config.testData,
        environment: 'production' as const,
        setupSteps: [{ id: 'create', title: 'Create user', type: 'api' as const, method: 'POST', endpoint: '/api/users' }]
      }
    }),
    requirementCoverage('创建用户')
  );
  const qualityGate: QaQualityGate = {
    status: 'pass',
    confidence: 'high',
    checkedAt: '',
    actionableIssueCount: 0,
    referenceIssueCount: 0,
    blockingIssueCount: 0,
    mediumRiskCount: 0,
    coverageGapCount: 0,
    coverageGaps: [],
    reasons: ['ok'],
    summary: 'ok'
  };
  const sourceHealth: SourceHealthResult = {
    enabled: true,
    status: 'passed',
    checkedAt: '',
    packageScripts: [],
    scriptChecks: [],
    scannedFiles: 0,
    parsedFiles: 0,
    skippedFiles: 0,
    syntaxErrorCount: 0,
    findings: []
  };
  const artifactIntegrity: ArtifactIntegrityResult = {
    status: 'passed',
    checkedAt: '',
    presentCount: 1,
    missingCount: 0,
    skippedCount: 0,
    entries: [],
    missing: [],
    summary: 'ok'
  };
  const signoff = buildQaSignoff({
    config,
    qualityGate,
    requirementCoverage: requirementCoverage('创建用户'),
    sourceHealth,
    artifactIntegrity,
    testData,
    journeyTests: [],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });
  assert.equal(signoff.status, 'fail');
  assert.equal(signoff.blockers.some((item) => /testData failed/.test(item)), true);
});
