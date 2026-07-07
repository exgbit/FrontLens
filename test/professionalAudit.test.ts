import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { formatProfessionalAudit, runProfessionalAudit } from '../src/audit/professionalAudit.ts';

function baseResult() {
  return normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin', testedAt: '2026-07-07T00:00:00.000Z', browser: 'chromium' },
    pageModel: { url: 'https://example.com/admin', title: 'Admin', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Admin' } }
  });
}

test('professional audit blocks non-actionable raw findings in must-fix queue', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/admin', title: 'Admin' },
    pageModel: { url: 'https://example.com/admin', title: 'Admin', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'Admin' } },
    issues: [
      {
        id: 'ISSUE-DEPLOY',
        title: '缺少 Content-Security-Policy',
        category: 'security',
        severity: 'high',
        confidence: 0.9,
        description: 'Deployment header missing.',
        evidence: { details: { rule: 'content-security-policy', category: 'headers' } },
        reproduceSteps: ['Open page'],
        reason: 'Deployment config.',
        suggestion: { backend: 'Configure CSP at gateway.', priority: 'P1' }
      }
    ]
  });
  result.professionalSummary.mustFix.push({
    id: 'PS-BAD',
    kind: 'defect',
    priority: 'P1',
    owner: 'frontend',
    title: 'Bad scheduled deployment item',
    rationale: 'Injected stale summary item.',
    action: 'Do not schedule this.',
    evidenceRefs: ['ISSUE-DEPLOY'],
    issueIds: ['ISSUE-DEPLOY']
  });

  const audit = runProfessionalAudit(result);
  assert.equal(audit.status, 'failed');
  assert.equal(audit.findings.some((item) => item.category === 'fix-queue' && /non-actionable/.test(item.title)), true);
});

test('professional audit blocks runtime-verified business overclaim without requirements/assertions', () => {
  const result = baseResult();
  result.qaSignoff.businessValidationConfidence = 'runtime-verified';
  result.qaSignoff.scope.providedRequirementCount = 0;
  result.qaSignoff.scope.assertionStepCount = 0;
  result.claimGuard.items = result.claimGuard.items.map((item) => item.claim === 'business-validation' ? { ...item, status: 'limited' } : item);
  result.claimGuard.status = 'limited';

  const audit = runProfessionalAudit(result);
  assert.equal(audit.status, 'failed');
  assert.equal(audit.findings.some((item) => item.category === 'overclaim'), true);
});

test('professional audit warns when source-enabled proof-ready frontend group lacks file line', () => {
  const result = normalizeResult({
    summary: { url: 'https://example.com/app', title: 'App' },
    metadata: { config: { source: { enabled: true, root: '/repo' } } },
    pageModel: { url: 'https://example.com/app', title: 'App', stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: 'App' } },
    sourceAnalysis: { enabled: true, status: 'passed', root: '/repo', checkedAt: '', scannedFiles: 1, scannedBytes: 100, summary: { routeFileCount: 0, routeCount: 0, eagerRouteImportCount: 0, heavyImportCount: 0, apiCallCount: 0, errorStateSignalCount: 0, emptyStateSignalCount: 0 }, routeFiles: [], routes: [], imports: [], apiCalls: [], stateSignals: [], findings: [] },
    sourceRuntimeCorrelation: { enabled: true, status: 'passed', checkedAt: '', summary: { networkRequestCount: 1, linkedRequestCount: 0, strongLinkCount: 0, unlinkedRequestCount: 1, listResponseLinkCount: 0 }, links: [], gaps: [] },
    issues: [
      {
        id: 'ISSUE-UI',
        title: '确认按钮点击无响应',
        category: 'frontend-ui',
        severity: 'high',
        confidence: 0.9,
        description: 'Button does not respond.',
        evidence: { selector: '.confirm' },
        reproduceSteps: ['Open page', 'Click confirm'],
        reason: 'No visible state change.',
        suggestion: { frontend: 'Fix click handler.', priority: 'P1' }
      }
    ]
  });
  // Simulate a stale report that scheduled the frontend root cause but did not carry file:line evidence.
  result.rootCauseGroups = [
    {
      id: 'RC-STale',
      rootCauseKey: 'frontend-ui:confirm',
      title: '确认按钮点击无响应',
      status: 'actionable',
      owner: 'frontend',
      priority: 'P1',
      severity: 'high',
      issueIds: ['ISSUE-UI'],
      issueCount: 1,
      categories: ['frontend-ui'],
      selectors: ['.confirm'],
      networkRequestIds: [],
      consoleIds: [],
      pageErrorIds: [],
      resourceUrls: [],
      sourceLocations: [],
      summary: 'Button no response.',
      suggestedFix: 'Fix click handler.',
      verificationCommand: 'node dist/cli.js qa --url https://example.com/app'
    }
  ];
  result.defectProof.items = [
    {
      id: 'PROOF-STale',
      rootCauseGroupId: 'RC-STale',
      issueIds: ['ISSUE-UI'],
      title: '确认按钮点击无响应',
      owner: 'frontend',
      priority: 'P1',
      status: 'proven',
      confidence: 'high',
      score: 90,
      dimensions: result.defectProof.items[0]?.dimensions ?? {
        userImpact: { strength: 'strong', reason: '', evidenceRefs: [] },
        runtimeEvidence: { strength: 'strong', reason: '', evidenceRefs: [] },
        sourceEvidence: { strength: 'missing', reason: '', evidenceRefs: [] },
        requirementEvidence: { strength: 'weak', reason: '', evidenceRefs: [] },
        productScope: { strength: 'medium', reason: '', evidenceRefs: [] },
        reproducibility: { strength: 'strong', reason: '', evidenceRefs: [] },
        ownerFixSurface: { strength: 'strong', reason: '', evidenceRefs: [] }
      },
      missingEvidence: [],
      nextSteps: [],
      evidenceRefs: []
    }
  ];

  const audit = runProfessionalAudit(result);
  assert.equal(audit.findings.some((item) => item.category === 'source-evidence' && item.severity === 'warning'), true);
  assert.match(formatProfessionalAudit(audit), /Professional Audit/);
});
