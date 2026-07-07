import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildClaimGuard } from '../src/claims/claimGuard.ts';

function baseResult() {
  return normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'Users' } }
  });
}

test('claim guard prevents 100 percent business validation without PRD and runtime assertions', () => {
  const result = baseResult();

  assert.equal(result.claimGuard.status, 'limited');
  assert.equal(result.claimGuard.forbiddenClaims.includes('业务功能验证通过可信度 100%'), true);
  const business = result.claimGuard.items.find((item) => item.claim === 'business-validation');
  assert.equal(business?.status, 'limited');
  assert.equal(business?.requiredInputs.some((item) => item.includes('PRD')), true);
});

test('claim guard allows scoped business validation only with provided requirements and runtime evidence', () => {
  const result = baseResult();
  result.requirementCoverage.source = 'provided';
  result.requirementCoverage.summary.providedCount = 1;
  result.requirementCoverage.summary.requirementCount = 1;
  result.requirementCoverage.summary.passedCount = 1;
  result.scopeReview.status = 'configured';
  result.scopeReview.questions = [];
  result.qaSignoff.status = 'pass';
  result.qaSignoff.confidence = 'high';
  result.qaSignoff.businessValidationConfidence = 'runtime-verified';
  result.qualityGate.status = 'pass';
  result.environment.kind = 'production-like';
  result.environment.trust.performance = 'high';
  result.environment.trust.security = 'high';
  result.environment.trust.businessSignoff = 'high';
  result.sourceRuntimeCorrelation.status = 'passed';
  result.sourceRuntimeCorrelation.links = [
    {
      id: 'SRC-RUNTIME-001',
      networkRequestId: 'REQ-001',
      method: 'GET',
      url: 'https://example.com/api/users',
      path: '/api/users',
      sourceMatches: [],
      stateSignals: [],
      componentIds: ['CMP-001'],
      responseListHints: [{ path: 'data.items', length: 1, sampleKeys: ['id'] }],
      confidence: 'high',
      notes: []
    }
  ];
  result.sourceRuntimeCorrelation.summary.strongLinkCount = 1;
  result.sourceHealth.status = 'passed';
  result.artifactIntegrity.status = 'passed';
  result.security.status = 'passed';

  const guard = buildClaimGuard(result);
  const business = guard.items.find((item) => item.claim === 'business-validation');
  const apiBinding = guard.items.find((item) => item.claim === 'api-ui-data-binding');

  assert.equal(business?.status, 'allowed');
  assert.match(business?.allowedWording ?? '', /runtime-verified/);
  assert.equal(apiBinding?.status, 'allowed');
  assert.equal(guard.forbiddenClaims.includes('业务功能验证通过可信度 100%'), false);
});

test('claim guard blocks source-health pass claims when source checks fail', () => {
  const result = baseResult();
  result.sourceHealth.status = 'failed';
  result.sourceHealth.syntaxErrorCount = 1;

  const guard = buildClaimGuard(result);
  const source = guard.items.find((item) => item.claim === 'source-health');

  assert.equal(source?.status, 'blocked');
  assert.equal(guard.status, 'blocked');
  assert.equal(source?.forbiddenWording.some((item) => item.includes('sourceHealth 通过')), true);
});
