import test from 'node:test';
import assert from 'node:assert/strict';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { buildQaSignoff } from '../src/signoff/qaSignoff.ts';
import type { ArtifactIntegrityResult, EnvironmentAssessment, JourneyStepResult, JourneyTestResult, PageProfileAssessment, QaQualityGate, RequirementCoverageResult, SourceHealthResult } from '../src/types.ts';

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
    scriptChecks: [],
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

function environment(overrides: Partial<EnvironmentAssessment> = {}): EnvironmentAssessment {
  return {
    checkedAt: '',
    targetUrl: 'http://127.0.0.1:5173',
    finalUrl: 'http://127.0.0.1:5173',
    kind: 'local-dev',
    confidence: 'high',
    isLocalOrPrivate: true,
    isHttps: false,
    isViteDevServer: true,
    hasHmr: true,
    sameOriginRequestCount: 3,
    devModuleRequestCount: 2,
    hashedAssetCount: 0,
    trust: { functional: 'high', performance: 'low', security: 'low', businessSignoff: 'medium' },
    evidence: ['hmr:true'],
    warnings: ['dev'],
    recommendations: ['preview'],
    ...overrides
  };
}

function pageProfile(overrides: Partial<PageProfileAssessment> = {}): PageProfileAssessment {
  return {
    checkedAt: '',
    status: 'inferred',
    pageType: 'admin-data-list',
    confidence: 'medium',
    source: 'heuristic',
    signals: ['table component detected'],
    suggestedProductContext: {
      pageType: 'admin-data-list',
      deviceScope: 'desktop-first',
      accessibilityTarget: 'basic',
      requiredFeatures: ['error-state'],
      optionalFeatures: ['pagination'],
      outOfScopeFeatures: [],
      decisions: []
    },
    caveats: ['heuristic'],
    questions: ['分页是否必需？'],
    ...overrides
  };
}

function assertionStep(overrides: Partial<JourneyStepResult> = {}): JourneyStepResult {
  return {
    index: 0,
    action: 'expectText',
    target: 'body',
    value: 'Users',
    status: 'passed',
    startedAt: '',
    endedAt: '',
    durationMs: 1,
    ...overrides
  };
}

function journey(status: JourneyTestResult['status'], steps: JourneyStepResult[] = []): JourneyTestResult {
  return {
    id: `J-${status}`,
    name: 'journey',
    status,
    startedAt: '',
    endedAt: '',
    durationMs: 1,
    startUrl: 'https://example.com',
    steps
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
    journeyTests: [journey('passed', [assertionStep()])],
    interactionTests: [{ id: 'IT-1', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, actions: [], observations: {} }],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.status, 'pass');
  assert.equal(result.confidence, 'high');
  assert.equal(result.businessValidationConfidence, 'runtime-verified');
  assert.equal(result.scope.passedAssertionStepCount, 1);
  assert.equal(result.scope.passedJourneyWithAssertionCount, 1);
});

test('qa signoff does not runtime-verify passed recorded journeys without success assertions', () => {
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
          title: 'recorded flow',
          priority: 'P1',
          source: 'provided',
          status: 'passed',
          confidence: 'high',
          evidence: { selectors: [], componentIds: [], journeyIds: ['J-passed'], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] },
          gaps: []
        }
      ]
    }),
    sourceHealth: sourceHealth({ packageScripts: [] }),
    artifactIntegrity: artifacts(),
    journeyTests: [journey('passed', [assertionStep({ action: 'click', target: 'text=保存', value: undefined })])],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.businessValidationConfidence, 'runtime-partial');
  assert.equal(result.scope.passedJourneyWithAssertionCount, 0);
  assert.equal(result.scope.passedJourneyWithoutAssertionCount, 1);
  assert.equal(result.coverageGaps.some((gap) => gap.includes('缺少有意义的业务成功断言')), true);
  assert.equal(result.blockers.some((item) => item.includes('journeyAssertionAudit failed')), true);
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

test('qa signoff fails on explicitly executed source script blockers', () => {
  const result = buildQaSignoff({
    config: createDefaultConfig('https://example.com'),
    qualityGate: qualityGate(),
    requirementCoverage: requirements(),
    sourceHealth: sourceHealth({
      status: 'failed',
      packageScripts: [{ name: 'typecheck', command: 'vue-tsc --noEmit', category: 'typecheck' }],
      scriptChecks: [
        {
          id: 'SRC-SCRIPT-001',
          scriptName: 'typecheck',
          command: 'npm run typecheck',
          category: 'typecheck',
          status: 'failed',
          durationMs: 100,
          exitCode: 2,
          stderrPreview: 'type error'
        }
      ]
    }),
    artifactIntegrity: artifacts(),
    journeyTests: [journey('passed')],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.status, 'fail');
  assert.equal(result.blockers.some((item) => item.includes('sourceHealth script checks failed')), true);
  assert.equal(result.requiredFollowups.some((item) => item.includes('build/typecheck/lint')), false);
});

test('qa signoff records environment trust risks for dev server runs', () => {
  const result = buildQaSignoff({
    config: createDefaultConfig('http://127.0.0.1:5173'),
    qualityGate: qualityGate(),
    requirementCoverage: requirements(),
    sourceHealth: sourceHealth({ packageScripts: [] }),
    artifactIntegrity: artifacts(),
    environment: environment(),
    journeyTests: [journey('passed')],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.scope.environmentKind, 'local-dev');
  assert.equal(result.risks.some((item) => item.includes('dev server')), true);
  assert.equal(result.requiredFollowups.some((item) => item.includes('build + preview')), true);
});

test('qa signoff records unconfirmed page profile as product-scope coverage gap', () => {
  const result = buildQaSignoff({
    config: createDefaultConfig('https://example.com/admin'),
    qualityGate: qualityGate(),
    requirementCoverage: requirements(),
    sourceHealth: sourceHealth({ packageScripts: [] }),
    artifactIntegrity: artifacts(),
    pageProfile: pageProfile(),
    journeyTests: [journey('passed')],
    interactionTests: [],
    exceptionSimulations: [],
    pageDomNodes: 100
  });

  assert.equal(result.scope.pageProfileStatus, 'inferred');
  assert.equal(result.scope.pageProfileType, 'admin-data-list');
  assert.equal(result.coverageGaps.some((item) => item.includes('产品范围未显式确认')), true);
  assert.equal(result.requiredFollowups.some((item) => item.includes('productContext')), true);
});
