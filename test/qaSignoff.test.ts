import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildQaSignoff } from '../src/signoff/qaSignoff.ts';
import type { ArtifactIntegrityResult, JourneyTestResult, QaQualityGate, RequirementCoverageResult, SourceHealthResult } from '../src/types.ts';

function qualityGate(overrides: Partial<QaQualityGate> = {}): QaQualityGate {
  return {
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
    summary: 'pass / high',
    ...overrides
  };
}

function requirements(overrides: Partial<RequirementCoverageResult> = {}): RequirementCoverageResult {
  return {
    enabled: true,
    checkedAt: '',
    source: 'none',
    summary: {
      requirementCount: 0,
      passedCount: 0,
      failedCount: 0,
      partialCount: 0,
      notCoveredCount: 0,
      notApplicableCount: 0,
      providedCount: 0,
      inferredCount: 0,
      highPriorityGapCount: 0
    },
    items: [],
    gaps: [],
    ...overrides
  };
}

function sourceHealth(overrides: Partial<SourceHealthResult> = {}): SourceHealthResult {
  return {
    enabled: true,
    status: 'passed',
    checkedAt: '',
    root: '/repo',
    packageManager: 'npm',
    packageScripts: [{ name: 'build', command: 'vite build', category: 'build' }],
    scannedFiles: 1,
    parsedFiles: 1,
    skippedFiles: 0,
    syntaxErrorCount: 0,
    findings: [],
    ...overrides
  };
}

function artifacts(overrides: Partial<ArtifactIntegrityResult> = {}): ArtifactIntegrityResult {
  return {
    status: 'passed',
    checkedAt: '',
    presentCount: 1,
    missingCount: 0,
    skippedCount: 0,
    entries: [],
    missing: [],
    summary: 'ok',
    ...overrides
  };
}

function journey(status: JourneyTestResult['status']): JourneyTestResult {
  return {
    id: `J-${status}`,
    name: 'journey',
    status,
    startedAt: '',
    endedAt: '',
    durationMs: 1,
    startUrl: 'https://example.com',
    steps: []
  };
}

test('qa signoff downgrades raw pass when PRD and runtime journeys are missing', () => {
  const result = buildQaSignoff({
    config: createDefaultConfig('https://example.com'),
    qualityGate: qualityGate(),
    requirementCoverage: requirements(),
    sourceHealth: sourceHealth(),
    artifactIntegrity: artifacts(),
    journeyTests: [],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.status, 'pass-with-risks');
  assert.equal(result.businessValidationConfidence, 'runtime-partial');
  assert.equal(result.coverageGaps.some((gap) => gap.includes('未提供 PRD')), true);
  assert.equal(result.requiredFollowups.some((item) => item.includes('requirements')), true);
});

test('qa signoff can pass with provided requirements and passed runtime journey', () => {
  const config = createDefaultConfig('https://example.com');
  config.auth.storageState = '.auth/admin.json';
  const result = buildQaSignoff({
    config,
    qualityGate: qualityGate(),
    requirementCoverage: requirements({
      source: 'provided',
      summary: {
        requirementCount: 1,
        passedCount: 1,
        failedCount: 0,
        partialCount: 0,
        notCoveredCount: 0,
        notApplicableCount: 0,
        providedCount: 1,
        inferredCount: 0,
        highPriorityGapCount: 0
      },
      items: [
        {
          id: 'REQ-1',
          title: 'loads',
          priority: 'P1',
          source: 'provided',
          status: 'passed',
          confidence: 'high',
          evidence: { selectors: ['body'], componentIds: [], journeyIds: ['J-passed'], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
          gaps: []
        }
      ]
    }),
    sourceHealth: sourceHealth({ packageScripts: [] }),
    artifactIntegrity: artifacts(),
    journeyTests: [journey('passed')],
    interactionTests: [{ id: 'IT-1', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, actions: [], observations: {} }],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.confidence, 'high');
  assert.equal(result.businessValidationConfidence, 'runtime-verified');
});

test('qa signoff fails on source health syntax blockers', () => {
  const result = buildQaSignoff({
    config: createDefaultConfig('https://example.com'),
    qualityGate: qualityGate(),
    requirementCoverage: requirements(),
    sourceHealth: sourceHealth({ status: 'failed', syntaxErrorCount: 1 }),
    artifactIntegrity: artifacts(),
    journeyTests: [journey('passed')],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.blockers.some((item) => item.includes('sourceHealth failed')), true);
});
