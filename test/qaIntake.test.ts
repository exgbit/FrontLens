import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildQaIntake } from '../src/intake/qaIntake.ts';

function baseResult() {
  return normalizeResult({
    summary: { url: 'https://example.com/credentials', title: 'Credentials' },
    pageModel: { url: 'https://example.com/credentials', title: 'Credentials', stats: { domNodes: 20, visibleTextLength: 80, bodyTextSample: 'Credentials API Key Secret Token' } }
  });
}

test('qa intake converts missing PRD/source/runtime evidence into professional follow-up questions', () => {
  const result = baseResult();

  assert.equal(result.qaIntake.status, 'needs-input');
  assert.equal(result.qaIntake.questions.length > 0, true);
  assert.equal(result.qaIntake.topQuestions.some((item) => item.category === 'requirements'), true);
  assert.equal(result.qaIntake.questions.some((item) => item.blocksClaims.includes('business-validation')), true);
  assert.equal(result.qaIntake.questions.some((item) => item.question.includes('sourceRoot')), true);
  assert.equal(result.qaIntake.configHints.some((item) => item.includes('requirements')), true);
});

test('qa intake blocks professional sign-off when source health or artifacts fail', () => {
  const result = baseResult();
  result.sourceHealth.status = 'failed';
  result.sourceHealth.syntaxErrorCount = 1;
  result.artifactIntegrity.status = 'failed';
  result.artifactIntegrity.missingCount = 1;
  result.claimGuard = result.claimGuard.items.length ? result.claimGuard : result.claimGuard;

  const intake = buildQaIntake({
    claimGuard: result.claimGuard,
    scopeReview: result.scopeReview,
    qaSignoff: { ...result.qaSignoff, status: 'blocked', blockers: ['sourceHealth 检查失败'] },
    qualityGate: { ...result.qualityGate, status: 'blocked' },
    requirementCoverage: result.requirementCoverage,
    environment: result.environment,
    sourceAnalysis: result.sourceAnalysis,
    sourceRuntimeCorrelation: result.sourceRuntimeCorrelation,
    sourceHealth: result.sourceHealth,
    artifactIntegrity: result.artifactIntegrity,
    testData: result.testData,
    regressionPlan: result.regressionPlan,
    defectProof: result.defectProof,
    rootCauseGroups: result.rootCauseGroups,
    issueDisposition: result.issueDisposition,
    artifacts: result.artifacts
  });

  assert.equal(intake.status, 'blocked');
  assert.equal(intake.topQuestions.some((item) => item.priority === 'P0'), true);
  assert.equal(intake.questions.some((item) => item.category === 'artifact-integrity'), true);
});

test('qa intake becomes ready when core professional inputs are configured and evidence is clean', () => {
  const result = baseResult();
  result.claimGuard.status = 'clear';
  result.claimGuard.items = result.claimGuard.items.map((item) => ({ ...item, status: 'allowed', requiredInputs: [] }));
  result.claimGuard.requiredInputs = [];
  result.scopeReview.status = 'configured';
  result.scopeReview.questions = [];
  result.qaSignoff.status = 'pass';
  result.qaSignoff.confidence = 'high';
  result.qaSignoff.blockers = [];
  result.qaSignoff.risks = [];
  result.qaSignoff.coverageGaps = [];
  result.qaSignoff.requiredFollowups = [];
  result.qualityGate.status = 'pass';
  result.qualityGate.reasons = [];
  result.qualityGate.coverageGaps = [];
  result.requirementCoverage.summary.providedCount = 1;
  result.environment.trust.performance = 'high';
  result.environment.trust.security = 'high';
  result.sourceAnalysis.status = 'passed';
  result.sourceRuntimeCorrelation.status = 'passed';
  result.sourceRuntimeCorrelation.gaps = [];
  result.sourceHealth.status = 'passed';
  result.artifactIntegrity.status = 'passed';
  result.artifactIntegrity.missingCount = 0;
  result.testData.status = 'passed';
  result.testData.findings = [];
  result.testData.recommendations = [];
  result.regressionPlan.items = result.regressionPlan.items.map((item) => ({ ...item, status: 'ready' as const }));

  const intake = buildQaIntake(result);

  assert.equal(intake.status, 'ready');
  assert.equal(intake.questions.length, 0);
  assert.equal(intake.readyToProceed.some((item) => item.includes('输入项齐备')), true);
});
