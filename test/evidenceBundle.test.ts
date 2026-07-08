import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEvidenceBundle, formatEvidenceBundle } from '../src/evidence/evidenceBundle.ts';

function baseInput(overrides: Record<string, unknown> = {}) {
  return {
    summary: { url: 'https://example.com/users', title: 'Users' },
    artifacts: { outputDir: '/tmp/frontlens', defectTickets: '/tmp/frontlens/defect-tickets.md', evidenceReport: '/tmp/frontlens/evidence-report.md', jsonReport: '/tmp/frontlens/result.json' },
    artifactIntegrity: {
      status: 'passed',
      checkedAt: '2026-07-07T00:00:00.000Z',
      presentCount: 3,
      missingCount: 0,
      skippedCount: 0,
      entries: [
        { source: 'artifacts.defectTickets', path: '/tmp/frontlens/defect-tickets.md', absolutePath: '/tmp/frontlens/defect-tickets.md', kind: 'file', expected: true, exists: true, sizeBytes: 1200 },
        { source: 'artifacts.evidenceReport', path: '/tmp/frontlens/evidence-report.md', absolutePath: '/tmp/frontlens/evidence-report.md', kind: 'file', expected: true, exists: true, sizeBytes: 4000 },
        { source: 'issues.ISSUE-001.evidence.screenshot', path: '/tmp/frontlens/screens/issue.png', absolutePath: '/tmp/frontlens/screens/issue.png', kind: 'file', expected: true, exists: true, sizeBytes: 5000, issueId: 'ISSUE-001' }
      ],
      missing: [],
      summary: 'All referenced local artifacts exist.'
    },
    defectTickets: {
      status: 'ready',
      generatedAt: '2026-07-07T00:00:00.000Z',
      summary: '1 ticket',
      counts: { total: 1, proven: 1, probable: 0, sourceLocated: 1, requirementLinked: 1, suppressedNeedsEvidence: 0, suppressedNotDefect: 0 },
      items: [
        {
          id: 'TICKET-001',
          rootCauseGroupId: 'RC-001',
          proofStatus: 'proven',
          proofScore: 95,
          confidence: 'high',
          issueIds: ['ISSUE-001'],
          owner: 'frontend',
          priority: 'P1',
          severity: 'high',
          title: 'Save action has no error feedback',
          impact: 'Users cannot recover from save failures.',
          actualBehavior: 'No feedback.',
          expectedBehavior: 'Error state and retry are visible.',
          reproduceSteps: ['Open page', 'Click Save'],
          sourceLocations: [{ file: 'src/User.vue', line: 42 }],
          requirements: [{ id: 'REQ-SAVE', title: 'Save failure feedback', priority: 'P1', status: 'failed' }],
          evidenceRefs: ['ISSUE-001', 'REQ-SAVE'],
          artifactRefs: ['/tmp/frontlens/screens/issue.png'],
          fixRecommendation: 'Render error feedback.',
          acceptanceCriteria: ['REQ-SAVE passes.'],
          verificationCommand: 'frontlens qa --url https://example.com/users',
          notes: []
        }
      ],
      notes: []
    },
    testCases: { generatedAt: '2026-07-07T00:00:00.000Z', status: 'passed', confidence: 'high', summary: { totalCount: 0, passedCount: 0, failedCount: 0, partialCount: 0, blockedCount: 0, skippedCount: 0, needsInputCount: 0, runtimeVerifiedCount: 0, manualRequiredCount: 0, highPriorityOpenCount: 0 }, items: [], notes: [] },
    traceability: { generatedAt: '2026-07-07T00:00:00.000Z', status: 'ready', summary: { requirementCount: 0, providedRequirementCount: 0, coveredCount: 0, partialCount: 0, failedCount: 0, notCoveredCount: 0, notApplicableCount: 0, needsInputCount: 0, defectLinkedCount: 0, orphanDefectCount: 0, highPriorityGapCount: 0 }, requirements: [], orphanItems: [], notes: [] },
    automationSpecs: { generatedAt: '2026-07-07T00:00:00.000Z', status: 'skipped', targetUrl: 'https://example.com/users', specFileName: 'frontlens.spec.ts', summary: { draftCount: 0, readyCount: 0, needsInputCount: 0, blockedCount: 0, requirementLinkedCount: 0, runtimeAssertionCount: 0, sourceCounts: { requirement: 0, 'test-case': 0, journey: 0, 'assertion-suggestion': 0 } }, drafts: [], specSource: '', notes: [] },
    qaSignoff: { status: 'fail' },
    ...overrides
  } as any;
}

test('evidence bundle maps proof-ready defects to existing local artifacts', () => {
  const bundle = buildEvidenceBundle(baseInput());

  assert.equal(bundle.status, 'ready');
  assert.equal(bundle.summary.defectTicketCount, 1);
  assert.equal(bundle.summary.readyCount, 1);
  assert.equal(bundle.summary.missingArtifactCount, 0);
  assert.equal(bundle.items[0].kind, 'defect-ticket');
  assert.equal(bundle.items[0].status, 'ready');
  assert.ok(bundle.items[0].artifactRefs.some((ref) => ref.source === 'issues.ISSUE-001.evidence.screenshot' && ref.exists));
  assert.match(formatEvidenceBundle(bundle), /FrontLens Evidence Bundle/);
  assert.match(formatEvidenceBundle(bundle), /TICKET-001/);
});

test('evidence bundle blocks handoff when referenced artifacts are missing', () => {
  const input = baseInput();
  input.artifactIntegrity.entries = input.artifactIntegrity.entries.map((entry: any) => entry.source === 'issues.ISSUE-001.evidence.screenshot' ? { ...entry, exists: false, message: 'Referenced artifact path does not exist.' } : entry);
  input.artifactIntegrity.missing = input.artifactIntegrity.entries.filter((entry: any) => !entry.exists);
  input.artifactIntegrity.status = 'failed';
  input.artifactIntegrity.missingCount = 1;

  const bundle = buildEvidenceBundle(input);

  assert.equal(bundle.status, 'blocked');
  assert.equal(bundle.summary.missingArtifactCount >= 1, true);
  assert.ok(bundle.items.some((item) => item.status === 'missing-artifact'));
  assert.match(formatEvidenceBundle(bundle), /Missing artifacts/);
  assert.match(formatEvidenceBundle(bundle), /Referenced artifact path does not exist/);
});
