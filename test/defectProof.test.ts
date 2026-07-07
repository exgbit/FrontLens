import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildDefectProof } from '../src/proof/defectProof.ts';

function baseIssue(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ISSUE-001',
    title: '保存按钮点击后没有反馈',
    category: 'frontend-ui',
    severity: 'high',
    confidence: 0.92,
    description: 'Clicking save does not show success or error state.',
    evidence: { selector: '.save-button', screenshot: 'screen.png', details: { sourceFile: 'src/views/UserView.vue', line: 42 } },
    reproduceSteps: ['Open page', 'Click save', 'Observe no feedback'],
    reason: 'Users cannot know whether the save action completed.',
    suggestion: { frontend: 'Render success/error feedback and add a regression assertion.', priority: 'P1' },
    ...overrides
  };
}

function baseResult(issueOverrides: Record<string, unknown> = {}) {
  return normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 10, visibleTextLength: 40, bodyTextSample: 'Users Save' } },
    issues: [baseIssue(issueOverrides)]
  });
}

test('defect proof marks strong actionable root causes as proven', () => {
  const result = baseResult();
  result.scopeReview.status = 'configured';
  result.requirementCoverage.summary.providedCount = 1;
  result.requirementCoverage.items = [
    {
      id: 'REQ-SAVE-FEEDBACK',
      title: '保存后必须显示反馈',
      priority: 'P1',
      source: 'provided',
      status: 'failed',
      confidence: 'high',
      evidence: { selectors: ['.save-button'], texts: [], networkRequestIds: [], consoleIds: [], issueIds: ['ISSUE-001'], interactionTestIds: [], journeyIds: [] },
      gaps: ['No feedback after save']
    }
  ];

  const proof = buildDefectProof(result);
  assert.equal(proof.status, 'ready');
  assert.equal(proof.items[0].status, 'proven');
  assert.equal(proof.items[0].dimensions.sourceEvidence.strength, 'strong');
  assert.equal(proof.items[0].dimensions.requirementEvidence.strength, 'medium');
});

test('defect proof requires more evidence when source/runtime/product proof is weak', () => {
  const result = baseResult();
  result.issues = result.issues.map((issue) => ({ ...issue, evidence: {}, reproduceSteps: [], confidence: 0.6 }));
  result.rootCauseGroups = result.rootCauseGroups.map((group) => ({
    ...group,
    selectors: [],
    networkRequestIds: [],
    consoleIds: [],
    pageErrorIds: [],
    resourceUrls: [],
    sourceLocations: []
  }));
  result.issueDisposition.items = result.issueDisposition.items.map((item) => ({ ...item, actionability: 'actionable' as const, status: 'confirmed' as const }));
  result.scopeReview.status = 'needs-input';
  result.sourceAnalysis.status = 'skipped';
  result.sourceRuntimeCorrelation.status = 'skipped';

  const proof = buildDefectProof(result);
  assert.equal(proof.status, 'blocked');
  assert.equal(proof.items[0].status, 'needs-evidence');
  assert.equal(proof.items[0].missingEvidence.some((item) => item.includes('runtimeEvidence')), true);
  assert.equal(proof.items[0].nextSteps.some((item) => item.includes('sourceRoot')), true);
});

test('defect proof does not mark frontend root causes proof-ready when sourceRoot was indexed but the root cause is not source-bound', () => {
  const result = baseResult();
  result.rootCauseGroups = result.rootCauseGroups.map((group) => ({
    ...group,
    owner: 'frontend' as const,
    sourceLocations: []
  }));
  result.issues = result.issues.map((issue) => ({
    ...issue,
    evidence: { selector: '.save-button', screenshot: 'screen.png' }
  }));
  result.issueDisposition.items = result.issueDisposition.items.map((item) => ({
    ...item,
    actionability: 'actionable' as const,
    status: 'confirmed' as const
  }));
  result.scopeReview.status = 'configured';
  result.sourceAnalysis = {
    ...result.sourceAnalysis,
    enabled: true,
    status: 'passed',
    root: '/repo/frontend',
    scannedFiles: 10,
    scannedBytes: 1000,
    summary: {
      routeFileCount: 1,
      routeCount: 1,
      eagerRouteImportCount: 0,
      heavyImportCount: 0,
      apiCallCount: 0,
      errorStateSignalCount: 0,
      emptyStateSignalCount: 0
    },
    routeFiles: [],
    routes: [],
    imports: [],
    apiCalls: [],
    stateSignals: [],
    findings: []
  };
  result.sourceRuntimeCorrelation = {
    ...result.sourceRuntimeCorrelation,
    enabled: true,
    status: 'passed',
    summary: {
      networkRequestCount: 0,
      linkedRequestCount: 0,
      strongLinkCount: 0,
      unlinkedRequestCount: 0,
      listResponseLinkCount: 0
    },
    links: [],
    gaps: []
  };

  const proof = buildDefectProof(result);
  assert.equal(proof.items[0].dimensions.sourceEvidence.strength, 'weak');
  assert.equal(proof.items[0].status, 'needs-evidence');
  assert.equal(proof.status, 'blocked');
});

test('normalizeResult can make runtime accessibility findings proof-ready when source template findings bind file lines', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/rules', title: 'Rules' },
    pageModel: { url: 'https://example.com/rules', title: 'Rules', stats: { domNodes: 20, visibleTextLength: 80, bodyTextSample: 'Rules' } },
    sourceAnalysis: {
      enabled: true,
      status: 'passed',
      checkedAt: '',
      root: '/repo/frontend',
      scannedFiles: 1,
      scannedBytes: 100,
      summary: {
        routeFileCount: 0,
        routeCount: 0,
        eagerRouteImportCount: 0,
        heavyImportCount: 0,
        apiCallCount: 0,
        errorStateSignalCount: 0,
        emptyStateSignalCount: 0
      },
      routeFiles: [],
      routes: [],
      imports: [],
      apiCalls: [],
      stateSignals: [],
      findings: [
        {
          id: 'SRC-001',
          kind: 'ui-accessibility',
          severity: 'medium',
          title: '源码发现疑似无可访问名称的图标按钮：1 处',
          locations: [{ file: 'src/components/RuleActions.vue', line: 18 }],
          details: { rule: 'button-name' }
        }
      ]
    },
    issues: [
      {
        id: 'ISSUE-A11Y',
        title: '按钮缺少可访问名称：1 处',
        category: 'frontend-accessibility',
        severity: 'medium',
        confidence: 0.9,
        description: '按钮需要文本、aria-label 或 title。',
        evidence: { selector: 'button:nth-of-type(1)', details: { accessibilityCheckId: 'A11Y-003', rule: 'button-name', count: 1 } },
        reproduceSteps: ['打开页面', '运行 a11y 检查'],
        reason: '图标按钮没有 accessible name。',
        suggestion: { frontend: '增加 aria-label。', priority: 'P2' }
      }
    ]
  });

  assert.deepEqual(result.rootCauseGroups[0].sourceLocations, [{ file: 'src/components/RuleActions.vue', line: 18 }]);
  assert.equal(result.defectProof.items[0].dimensions.sourceEvidence.strength, 'strong');
  assert.equal(result.defectProof.items[0].status === 'proven' || result.defectProof.items[0].status === 'probable', true);
  assert.equal(result.fixTasks.length, 1);
});
