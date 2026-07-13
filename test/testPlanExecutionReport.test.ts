import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTestPlan } from '../src/testDesign/testPlan.ts';
import { buildTestPlanExecutionReport, formatCompactTestPlanExecutionReport, formatTestPlanExecutionReport } from '../src/testDesign/testExecutionReport.ts';
import { compactTestPlan, compactTestPlanExecution } from '../src/testDesign/testPlanCompact.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';

test('execution report does not treat one happy-path result as proof of every planned scenario', async () => {
  const plan = await buildTestPlan({ text: '- P0 用户必须可以搜索用户并调用 /api/users。', prefix: 'REQ-SEARCH' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'Users' } },
    requirementCoverage: {
      enabled: true,
      checkedAt: '2026-07-12T00:00:00.000Z',
      source: 'provided',
      summary: { requirementCount: 1, passedCount: 1, failedCount: 0, partialCount: 0, notCoveredCount: 0, notApplicableCount: 0, providedCount: 1, inferredCount: 0, highPriorityGapCount: 0 },
      items: [{
        id: reqId,
        title: '搜索用户',
        priority: 'P0',
        source: 'provided',
        status: 'passed',
        confidence: 'high',
        evidence: { selectors: ['#search'], componentIds: [], networkRequestIds: ['REQ-1'], journeyIds: ['J-1'], interactionTestIds: [], issueIds: [], notes: [] },
        gaps: []
      }]
    }
  });
  result.requirementCoverage.items[0] = {
    id: reqId, title: '搜索用户', priority: 'P0', source: 'provided', status: 'passed', confidence: 'high',
    evidence: { selectors: ['#search'], componentIds: [], networkRequestIds: ['REQ-1'], journeyIds: ['J-1'], interactionTestIds: [], issueIds: [], notes: [] }, gaps: []
  };
  result.sourceHealth.status = 'passed';
  const report = buildTestPlanExecutionReport(plan, result);
  assert.ok(report.summary.notExecutedCount > 0);
  assert.notEqual(report.status, 'passed');
  assert.ok(report.summary.p0OpenCount > 0);
  assert.match(report.releaseRecommendation, /不建议提测或发布/);
  assert.match(formatTestPlanExecutionReport(report, plan, result), /需求驱动测试报告/);
});

test('execution report binds evidence by layer and does not promote API evidence to backend or source pass', async () => {
  const plan = await buildTestPlan({ text: '- P0 用户必须在页面搜索用户并调用 GET /api/users，后端返回匹配数据。', prefix: 'REQ-LAYER' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'Users' } },
    requirementCoverage: {
      enabled: true,
      checkedAt: '2026-07-12T00:00:00.000Z',
      source: 'provided',
      summary: { requirementCount: 1, passedCount: 1, failedCount: 0, partialCount: 0, notCoveredCount: 0, notApplicableCount: 0, providedCount: 1, inferredCount: 0, highPriorityGapCount: 0 },
      items: [{
        id: reqId,
        title: '搜索用户',
        priority: 'P0',
        source: 'provided',
        status: 'passed',
        confidence: 'high',
        evidence: { selectors: ['#search'], componentIds: [], networkRequestIds: ['NET-1'], journeyIds: [], interactionTestIds: ['IT-1'], issueIds: [], notes: [] },
        gaps: []
      }]
    }
  });
  result.requirementCoverage.items[0] = {
    id: reqId, title: '搜索用户', priority: 'P0', source: 'provided', status: 'passed', confidence: 'high',
    evidence: { selectors: ['#search'], componentIds: [], networkRequestIds: ['NET-1'], journeyIds: [], interactionTestIds: ['IT-1'], issueIds: [], notes: [] }, gaps: []
  };
  result.interactionTests = [{
    id: 'IT-1', kind: 'search', target: '搜索', selector: '#search', status: 'passed',
    startedAt: '2026-07-12T00:00:00.000Z', endedAt: '2026-07-12T00:00:01.000Z', durationMs: 1000,
    actions: ['click'], observations: { networkRequestIds: ['NET-1'] }
  }];
  result.apiContract.endpoints = [{ method: 'GET', path: '/api/users', requestCount: 1, statusCodes: [200], contentTypes: ['application/json'], issues: [] }];
  result.sourceHealth.status = 'passed';

  const report = buildTestPlanExecutionReport(plan, result);
  const execution = (layer: string, scenario: string) => report.executions.find((item) => {
    const planned = plan.testCases.find((testCase) => testCase.id === item.testCaseId);
    return planned?.layer === layer && planned.scenario === scenario && planned.requirementIds.includes(reqId);
  });
  assert.equal(execution('frontend', 'positive')?.status, 'passed');
  assert.equal(execution('api', 'positive')?.status, 'passed');
  assert.equal(execution('backend', 'positive')?.status, 'partial');
  assert.equal(execution('source', 'regression')?.status, 'needs-input');
});

test('execution report keeps successful main path separate from failed recovery scenario', async () => {
  const plan = await buildTestPlan({ text: '- P0 用户必须在页面搜索并调用 GET /api/users，接口失败时展示错误。', prefix: 'REQ-RECOVERY' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'Users' } },
    requirementCoverage: {
      enabled: true, checkedAt: '2026-07-12T00:00:00.000Z', source: 'provided',
      summary: { requirementCount: 1, passedCount: 0, failedCount: 1, partialCount: 0, notCoveredCount: 0, notApplicableCount: 0, providedCount: 1, inferredCount: 0, highPriorityGapCount: 1 },
      items: [{ id: reqId, title: '搜索错误恢复', priority: 'P0', source: 'provided', status: 'failed', confidence: 'high', evidence: { selectors: [], componentIds: [], networkRequestIds: ['NET-1'], journeyIds: [], interactionTestIds: ['IT-1'], issueIds: [], notes: [] }, gaps: ['500 无反馈'] }]
    }
  });
  result.requirementCoverage.items[0] = {
    id: reqId, title: '搜索错误恢复', priority: 'P0', source: 'provided', status: 'failed', confidence: 'high',
    evidence: { selectors: [], componentIds: [], networkRequestIds: ['NET-1'], journeyIds: [], interactionTestIds: ['IT-1'], issueIds: [], notes: [] }, gaps: ['500 无反馈']
  };
  result.interactionTests = [{ id: 'IT-1', kind: 'search', target: '搜索', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, actions: [], observations: { networkRequestIds: ['NET-1'] } }];
  result.apiContract.endpoints = [{ method: 'GET', path: '/api/users', requestCount: 1, statusCodes: [200], contentTypes: ['application/json'], issues: [] }];
  result.exceptionSimulations = [{ id: 'EX-1', kind: 'api-500', target: 'https://example.com/api/users?q=a', method: 'GET', status: 'failed', startedAt: '', endedAt: '', durationMs: 1, observations: { bodyHasErrorFeedback: false } }];

  const report = buildTestPlanExecutionReport(plan, result);
  const by = (layer: string, scenario: string) => report.executions.find((item) => {
    const planned = plan.testCases.find((testCase) => testCase.id === item.testCaseId);
    return planned?.layer === layer && planned.scenario === scenario && planned.requirementIds.includes(reqId);
  });
  assert.equal(by('frontend', 'positive')?.status, 'passed');
  assert.equal(by('frontend', 'recovery')?.status, 'failed');
  assert.equal(by('api', 'positive')?.status, 'passed');
  assert.equal(by('api', 'recovery')?.status, 'failed');
});

test('skipped P0 case remains open and does not count as requirement coverage', async () => {
  const plan = await buildTestPlan({ text: '- P0 项目 typecheck 和单元测试必须通过。', prefix: 'REQ-CODE' });
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Code' },
    pageModel: { url: 'https://example.com', title: 'Code', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Code' } }
  });
  result.sourceHealth.status = 'skipped';
  const report = buildTestPlanExecutionReport(plan, result);
  assert.ok(report.summary.p0OpenCount > 0);
  assert.equal(report.summary.requirementCoveredCount, 0);
  assert.equal(report.status, 'blocked');
});

test('code acceptance does not pass when a required lint script was not executed', async () => {
  const plan = await buildTestPlan({ text: '- P0 项目 typecheck、lint 和 test 必须通过。', prefix: 'REQ-SCRIPTS' });
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Code' },
    pageModel: { url: 'https://example.com', title: 'Code', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Code' } }
  });
  result.sourceHealth.status = 'passed';
  result.sourceHealth.scriptChecks = [
    { id: 'SRC-1', scriptName: 'typecheck', command: 'npm run typecheck', category: 'typecheck', status: 'passed', durationMs: 1 },
    { id: 'SRC-2', scriptName: 'test', command: 'npm test', category: 'test', status: 'passed', durationMs: 1 }
  ];
  const report = buildTestPlanExecutionReport(plan, result);
  const sourcePositive = report.executions.find((execution) => {
    const planned = plan.testCases.find((item) => item.id === execution.testCaseId);
    return planned?.layer === 'source' && planned.scenario === 'positive';
  });
  assert.equal(sourcePositive?.status, 'needs-input');
  assert.match(sourcePositive?.actual ?? '', /lint/);
  assert.ok(report.summary.p0OpenCount > 0);
});

test('execution attribution keeps an unrelated lint failure out of a typecheck-only requirement', async () => {
  const plan = await buildTestPlan({ text: '- P0 typecheck 必须通过。', prefix: 'REQ-TYPECHECK-ONLY' });
  const result = normalizeResult({ summary: { url: 'https://example.com', title: 'Code' }, pageModel: { url: 'https://example.com', title: 'Code', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Code' } } });
  result.sourceHealth.status = 'failed';
  result.sourceHealth.scriptChecks = [
    { id: 'TYPE', scriptName: 'typecheck', command: 'npm run typecheck', category: 'typecheck', status: 'passed', durationMs: 1 },
    { id: 'LINT', scriptName: 'lint', command: 'npm run lint', category: 'lint', status: 'failed', durationMs: 1 }
  ];
  const report = buildTestPlanExecutionReport(plan, result);
  const sourceCases = report.executions.filter((execution) => plan.testCases.find((item) => item.id === execution.testCaseId)?.layer === 'source');
  assert.ok(sourceCases.some((item) => item.status === 'passed'));
  assert.notEqual(report.requirementTraceability[0].implementationVerdict, 'implementation-mismatch');
  assert.equal(report.status, 'blocked', 'unrelated global source failure still blocks release without false requirement attribution');
});

test('global source failure blocks verification without falsely attributing an implementation mismatch to every business requirement', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户可以搜索用户并调用 GET /api/users。', prefix: 'REQ-GLOBAL-SOURCE' });
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } }
  });
  result.sourceHealth.status = 'failed';
  result.sourceHealth.scriptChecks = [{ id: 'SRC-FAIL', scriptName: 'lint', command: 'npm run lint', category: 'lint', status: 'failed', durationMs: 1 }];

  const report = buildTestPlanExecutionReport(plan, result);
  const sourceCases = report.executions.filter((execution) => plan.testCases.find((item) => item.id === execution.testCaseId)?.layer === 'source');
  assert.ok(sourceCases.length > 0);
  assert.ok(sourceCases.every((item) => item.status === 'blocked'));
  assert.notEqual(report.requirementTraceability[0].implementationVerdict, 'implementation-mismatch');
  assert.equal(report.requirementTraceability[0].verificationVerdict, 'blocked');
});

test('requirement-scoped backend test evidence closes only the matching backend layer and scenario', async () => {
  const plan = await buildTestPlan({ text: '- P0 普通用户直接调用 DELETE /api/users/{id} 必须被拒绝。', prefix: 'REQ-BACKEND-EVIDENCE' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } },
    sourceHealth: {
      enabled: true,
      status: 'passed',
      checkedAt: '2026-07-12T00:00:00.000Z',
      packageScripts: [],
      scriptChecks: [],
      testEvidence: [{
        id: 'AUTH-BACKEND', requirementIds: [reqId], layer: 'backend', scenarios: ['permission'],
        scriptNames: ['test'], status: 'passed', evidenceRefs: ['test/auth.test.ts'], notes: []
      }]
    }
  });
  const report = buildTestPlanExecutionReport(plan, result);
  const matching = report.executions.find((execution) => {
    const planned = plan.testCases.find((item) => item.id === execution.testCaseId);
    return planned?.layer === 'backend' && planned.scenario === 'permission';
  });
  const unmatched = report.executions.find((execution) => {
    const planned = plan.testCases.find((item) => item.id === execution.testCaseId);
    return planned?.layer === 'source';
  });
  assert.equal(matching?.status, 'passed');
  assert.match(matching?.actual ?? '', /需求、层级与场景专属/);
  assert.notEqual(unmatched?.status, 'passed');
});

test('plan review state stays separate from execution blocking when there are no P0 or runtime blockers', async () => {
  const plan = await buildTestPlan({ text: '- P2 用户可以查看帮助信息。', prefix: 'REQ-REVIEW-ONLY' });
  plan.status = 'needs-review';
  for (const item of plan.testCases) item.priority = 'P2';
  const result = normalizeResult({
    summary: { url: 'https://example.com/help', title: 'Help' },
    pageModel: { url: 'https://example.com/help', title: 'Help', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Help' } }
  });
  result.sourceHealth.status = 'passed';
  result.qaSignoff.scope.passedJourneyCount = 1;
  result.qaSignoff.scope.requirementBoundRuntimeVerifiedJourneyCount = 1;
  const report = buildTestPlanExecutionReport(plan, result);
  assert.equal(report.status, 'partial');
  assert.equal(report.summary.p0OpenCount, 0);
  assert.match(report.releaseRecommendation, /本身不等同于执行阻塞/);
});

test('system dependency blocker consumes passed 5xx and timeout recovery simulations', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户搜索时调用 GET /api/users。', prefix: 'REQ-DEPENDENCY' });
  const dependencyCase = plan.testCases.find((item) => item.tags.includes('dependency'));
  assert.ok(dependencyCase);
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } },
    exceptionSimulations: [
      { id: 'EX-500', kind: 'api-500', target: 'https://example.com/api/users', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, observations: { bodyHasErrorFeedback: true } },
      { id: 'EX-TIMEOUT', kind: 'api-timeout', target: 'https://example.com/api/users', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, observations: { bodyHasErrorFeedback: true } }
    ]
  });
  const report = buildTestPlanExecutionReport(plan, result);
  const execution = report.executions.find((item) => item.testCaseId === dependencyCase.id);
  assert.equal(execution?.status, 'passed');
  assert.deepEqual(execution?.evidenceRefs, ['EX-500', 'EX-TIMEOUT']);
});

test('system dependency blocker stays open when only one mandatory failure mode was tested', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户搜索时调用 GET /api/users。', prefix: 'REQ-DEPENDENCY-PARTIAL' });
  const dependencyCase = plan.testCases.find((item) => item.tags.includes('dependency'))!;
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } },
    exceptionSimulations: [{ id: 'EX-ONLY-500', kind: 'api-500', target: 'https://example.com/api/users', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, observations: { bodyHasErrorFeedback: true } }]
  });
  const execution = buildTestPlanExecutionReport(plan, result).executions.find((item) => item.testCaseId === dependencyCase.id);
  assert.equal(execution?.status, 'needs-input');
  assert.match(execution?.actual ?? '', /api-500, api-timeout/);
});

test('API happy path accepts mixed successful and expected negative traffic and retains request ids', async () => {
  const plan = await buildTestPlan({ text: '- P0 用户必须调用 GET /api/users。', prefix: 'REQ-MIXED-STATUS' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({
    summary: { url: 'https://example.com/users', title: 'Users' },
    pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } }
  });
  result.apiContract.endpoints = [{
    method: 'GET', path: '/api/users', requestCount: 2, networkRequestIds: ['NET-200', 'NET-403'],
    statusCodes: [200, 403], contentTypes: ['application/json'], issues: []
  }];
  const report = buildTestPlanExecutionReport(plan, result);
  const apiPositive = report.executions.find((execution) => {
    const planned = plan.testCases.find((item) => item.id === execution.testCaseId);
    return planned?.requirementIds.includes(reqId) && planned.layer === 'api' && planned.scenario === 'positive';
  });
  assert.equal(apiPositive?.status, 'passed');
  assert.ok(apiPositive?.evidenceRefs.includes('NET-200'));
  assert.ok(apiPositive?.evidenceRefs.includes('NET-403'));
});

test('API positive acceptance honors an explicitly required non-2xx status', async () => {
  const plan = await buildTestPlan({ text: '- P0 普通用户调用 DELETE /api/users/{id} 必须返回 403。', prefix: 'REQ-EXPECTED-403' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({ summary: { url: 'https://example.com/users', title: 'Users' }, pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } } });
  result.apiContract.endpoints = [{ method: 'DELETE', path: '/api/users/{id}', requestCount: 1, networkRequestIds: ['DELETE-403'], statusCodes: [403], contentTypes: ['application/json'], issues: [] }];
  const report = buildTestPlanExecutionReport(plan, result);
  const execution = report.executions.find((item) => {
    const planned = plan.testCases.find((testCase) => testCase.id === item.testCaseId);
    return planned?.requirementIds.includes(reqId) && planned.layer === 'api' && planned.scenario === 'positive';
  });
  assert.equal(execution?.status, 'passed');
  assert.match(execution?.actual ?? '', /403/);
  assert.ok(execution?.evidenceRefs.includes('DELETE-403'));
});

test('execution report validates status codes per API operation rather than by requirement-wide union', async () => {
  const plan = await buildTestPlan({
    text: '- P0 GET /api/users/{id} 必须返回 200；DELETE /api/users/{id} 必须返回 403。',
    prefix: 'REQ-PER-API-STATUS'
  });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({ summary: { url: 'https://example.com/users/42', title: 'Users' }, pageModel: { url: 'https://example.com/users/42', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } } });
  result.apiContract.endpoints = [
    { method: 'GET', path: '/api/users/{id}', requestCount: 1, networkRequestIds: ['GET-403'], statusCodes: [403], contentTypes: ['application/json'], issues: [] },
    { method: 'DELETE', path: '/api/users/{id}', requestCount: 1, networkRequestIds: ['DELETE-200'], statusCodes: [200], contentTypes: ['application/json'], issues: [] }
  ];
  const report = buildTestPlanExecutionReport(plan, result);
  const execution = report.executions.find((item) => {
    const planned = plan.testCases.find((testCase) => testCase.id === item.testCaseId);
    return planned?.requirementIds.includes(reqId) && planned.layer === 'api' && planned.scenario === 'positive';
  });
  assert.equal(execution?.status, 'failed');
  assert.match(execution?.actual ?? '', /GET \/api\/users\/\{id\}=>200/);
  assert.match(execution?.actual ?? '', /DELETE \/api\/users\/\{id\}=>403/);
});

test('method-specific recovery evidence cannot be satisfied by a different HTTP method', async () => {
  const plan = await buildTestPlan({ text: '- P0 用户提交时调用 POST /api/users，失败后必须可重试。', prefix: 'REQ-POST-RECOVERY' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({ summary: { url: 'https://example.com/users', title: 'Users' }, pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } } });
  result.exceptionSimulations = [{ id: 'GET-500', kind: 'api-500', target: 'https://example.com/api/users', method: 'GET', status: 'passed', startedAt: '', endedAt: '', durationMs: 1, observations: { bodyHasErrorFeedback: true } }];
  const report = buildTestPlanExecutionReport(plan, result);
  const execution = report.executions.find((item) => {
    const planned = plan.testCases.find((testCase) => testCase.id === item.testCaseId);
    return planned?.requirementIds.includes(reqId) && planned.layer === 'api' && planned.scenario === 'recovery';
  });
  assert.equal(execution?.status, 'needs-input');
  assert.ok(!execution?.evidenceRefs.includes('GET-500'));
});

test('a passed and a skipped runtime journey produce partial rather than a false pass', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户可以查看用户列表。', prefix: 'REQ-MIXED-RUNTIME' });
  const reqId = plan.requirements[0].id!;
  const result = normalizeResult({ summary: { url: 'https://example.com/users', title: 'Users' }, pageModel: { url: 'https://example.com/users', title: 'Users', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Users' } } });
  result.journeyTests = [
    { id: 'J-PASS', name: 'list-pass', requirementIds: [reqId], status: 'passed', startedAt: '', endedAt: '', durationMs: 1, startUrl: 'https://example.com/users', steps: [{ index: 0, action: 'expectText', target: 'body', value: 'Users', status: 'passed', startedAt: '', endedAt: '', durationMs: 1 }] },
    { id: 'J-SKIP', name: 'list-skipped', requirementIds: [reqId], status: 'skipped', startedAt: '', endedAt: '', durationMs: 1, startUrl: 'https://example.com/users', steps: [] }
  ];
  result.requirementCoverage.items = [{ id: reqId, title: '查看用户列表', priority: 'P1', source: 'provided', status: 'partial', confidence: 'medium', evidence: { selectors: [], componentIds: [], journeyIds: ['J-PASS', 'J-SKIP'], interactionTestIds: [], networkRequestIds: [], issueIds: [], notes: [] }, gaps: [] }];
  const report = buildTestPlanExecutionReport(plan, result);
  const execution = report.executions.find((item) => {
    const planned = plan.testCases.find((testCase) => testCase.id === item.testCaseId);
    return planned?.requirementIds.includes(reqId) && planned.layer === 'frontend' && planned.scenario === 'positive';
  });
  assert.equal(execution?.status, 'partial');
});

test('compact plan and report responses avoid returning expanded case payloads by default', async () => {
  const text = Array.from({ length: 8 }, (_, index) => `- P${index % 3} 用户可以搜索模块${index}并调用 GET /api/modules/${index}。`).join('\n');
  const plan = await buildTestPlan({ text, prefix: 'REQ-COMPACT' });
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Compact' },
    pageModel: { url: 'https://example.com', title: 'Compact', stats: { domNodes: 1, visibleTextLength: 1, bodyTextSample: 'Compact' } }
  });
  const execution = buildTestPlanExecutionReport(plan, result);
  const compactPlan = JSON.stringify(compactTestPlan(plan));
  const compactExecution = JSON.stringify(compactTestPlanExecution(execution, plan));
  assert.ok(compactPlan.length < JSON.stringify(plan).length * 0.35);
  assert.ok(compactExecution.length < JSON.stringify(execution).length * 0.5);
  const compactMarkdown = formatCompactTestPlanExecutionReport(execution, plan, result);
  assert.ok(compactMarkdown.length < formatTestPlanExecutionReport(execution, plan, result).length * 0.6);
  assert.match(compactMarkdown, /决策摘要/);
  assert.doesNotMatch(compactMarkdown, /## 2\. 用例执行结果/);

  const manyRequirements = Array.from({ length: 45 }, (_, index) => ({
    ...plan.requirements[index % plan.requirements.length],
    id: `REQ-MANY-${index + 1}`,
    title: `Large requirement ${index + 1}`
  }));
  const manyPlan = { ...plan, requirements: manyRequirements };
  const manyExecution = buildTestPlanExecutionReport(manyPlan, result);
  const boundedPlan = compactTestPlan(manyPlan) as { requirementsSample: unknown[]; requirementsSampleTruncated: boolean };
  const boundedExecution = compactTestPlanExecution(manyExecution, manyPlan) as { requirementsSample: unknown[]; requirementsSampleTruncated: boolean };
  assert.equal(boundedPlan.requirementsSample.length, 20);
  assert.equal(boundedPlan.requirementsSampleTruncated, true);
  assert.equal(boundedExecution.requirementsSample.length, 20);
  assert.equal(boundedExecution.requirementsSampleTruncated, true);
});
