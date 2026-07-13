import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { buildTestPlan } from '../src/testDesign/testPlan.ts';
import { formatDeveloperTestCases, formatQaTestCases } from '../src/testDesign/testPlanReporter.ts';
import { compactRequirementWizard, synthesizeRequirements } from '../src/requirements/requirementWizard.ts';

const prd = `
# 用户管理

- P0 管理员必须可以搜索用户，页面显示「搜索结果」，并调用 GET /api/users。
- P1 管理员删除用户前必须显示「确认删除」，删除成功后数据状态从存在 -> 已删除。
- P1 普通用户不能看到管理员操作，并且直接调用 /api/users/delete 时必须返回无权限。
`;

test('test plan creates frontend/backend/api/source points, complete scenarios and developer P0 subset', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-plan-'));
  try {
    const plan = await buildTestPlan({ text: prd, outputDir: dir, prefix: 'REQ-USER', sourceRoot: '/workspace/app' });
    assert.equal(plan.summary.requirementCount, 3);
    assert.equal(plan.blockerCoverage.status, 'drafted');
    assert.equal(plan.blockerCoverage.missingCount, 0);
    assert.ok(plan.testPoints.some((item) => item.layer === 'frontend'));
    assert.ok(plan.testPoints.some((item) => item.layer === 'backend'));
    assert.ok(plan.testPoints.some((item) => item.layer === 'api'));
    assert.ok(plan.testPoints.some((item) => item.layer === 'source'));
    assert.ok(plan.testCases.some((item) => item.scenario === 'negative'));
    assert.ok(plan.testCases.some((item) => item.scenario === 'permission'));
    assert.ok(plan.testCases.some((item) => item.scenario === 'state-transition'));
    assert.ok(plan.testCases.some((item) => item.scenario === 'idempotency'));
    assert.ok(plan.testCases.every((item) => item.audiences.includes('qa')));
    assert.ok(plan.testCases.filter((item) => item.audiences.includes('developer')).every((item) => item.priority === 'P0'));
    assert.equal(plan.summary.developerCaseCount, plan.summary.p0Count);
    assert.match(formatDeveloperTestCases(plan), /任一用例失败即停止提测/);
    assert.match(formatQaTestCases(plan), /异常输入/);
    assert.ok(plan.artifacts);
    assert.equal((JSON.parse(await readFile(path.join(dir, 'test-plan.json'), 'utf8')) as typeof plan).schemaVersion, '1.0');
    const compact = JSON.parse(await readFile(path.join(dir, 'test-plan-summary.json'), 'utf8')) as { summary: { testCaseCount: number }; detailHint: string };
    assert.equal(compact.summary.testCaseCount, plan.summary.testCaseCount);
    assert.match(compact.detailHint, /Do not load test-plan\.json/);
    assert.match(await readFile(path.join(dir, 'artifact-manifest.json'), 'utf8'), /recommendedReadOrder/);
    assert.match(await readFile(path.join(dir, 'test-design-traceability.md'), 'utf8'), /场景缺口/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('system blocker cases are generated when PRD omits infrastructure acceptance criteria', async () => {
  const plan = await buildTestPlan({ text: '- P2 用户可以查看帮助文案。' });
  const availability = plan.blockerCoverage.items.find((item) => item.category === 'availability');
  const coreFlow = plan.blockerCoverage.items.find((item) => item.category === 'core-flow');
  assert.equal(availability?.status, 'drafted');
  assert.equal(coreFlow?.status, 'drafted');
  assert.ok((availability?.testCaseIds.length ?? 0) > 0);
  assert.ok(plan.testCases.some((item) => item.title.includes('系统级阻塞检查')));
});

test('authentication blocker cannot be satisfied by an unrelated authorization case', async () => {
  const plan = await buildTestPlan({ text: `
- P0 普通用户不能直接调用 DELETE /api/users/{id}。
- P1 登录后刷新页面必须恢复会话。
` });
  const loginRequirementId = plan.requirements[1].id!;
  const authentication = plan.blockerCoverage.items.find((item) => item.category === 'authentication');
  assert.ok(authentication);
  const linked = plan.testCases.filter((item) => authentication!.testCaseIds.includes(item.id));
  assert.ok(linked.length > 0);
  assert.ok(linked.every((item) => item.tags.includes('authentication') || item.requirementIds.includes(loginRequirementId)));
  assert.ok(linked.some((item) => item.tags.includes('system')), 'a dedicated auth blocker is drafted when the login requirement has no P0 auth case');
});

test('explicit priority is preserved and generic user wording does not create permission-case noise', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户点击重置后必须清空关键词。' });
  const requirementId = plan.requirements[0].id!;
  const requirementCases = plan.testCases.filter((item) => item.requirementIds.includes(requirementId));
  assert.equal(requirementCases.some((item) => item.priority === 'P0'), false);
  assert.equal(requirementCases.some((item) => item.scenario === 'permission'), false);
  assert.ok(plan.testCases.some((item) => item.priority === 'P0' && item.requirementIds.length === 0), 'system availability/core blocker still exists');
});

test('code-only acceptance criteria do not fabricate frontend test points', async () => {
  const plan = await buildTestPlan({ text: '- P0 与订单模块相关的 typecheck、lint 和 test 必须通过。' });
  const requirementId = plan.requirements[0].id!;
  const layers = plan.testPoints.filter((item) => item.requirementId === requirementId).map((item) => item.layer);
  assert.deepEqual(layers, ['source']);
});

test('a role data column is not mistaken for authorization behavior', async () => {
  const plan = await buildTestPlan({ text: '- P2 用户列表展示用户名、角色和状态。' });
  const requirementId = plan.requirements[0].id!;
  assert.equal(plan.testCases.some((item) => item.requirementIds.includes(requirementId) && item.scenario === 'permission'), false);
});

test('upload requirements include backend and API points with concrete file-size boundaries', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户上传头像仅支持 txt/png/jpg，最大 1MB，成功后显示文件名。' });
  const requirementId = plan.requirements[0].id!;
  const layers = new Set(plan.testPoints.filter((item) => item.requirementId === requirementId).map((item) => item.layer));
  assert.ok(layers.has('frontend'));
  assert.ok(layers.has('backend'));
  assert.ok(layers.has('api'));
  const boundary = plan.testCases.find((item) => item.requirementIds.includes(requirementId) && item.scenario === 'boundary');
  assert.match(boundary?.testData.join('\n') ?? '', /1MB 以下 1 单位/);
});

test('requirement synthesis exposes a bounded low-token summary', async () => {
  const wizard = await synthesizeRequirements({ text: Array.from({ length: 40 }, (_, index) => `- P2 用户可以查看模块 ${index}。`).join('\n') });
  const compact = compactRequirementWizard(wizard) as { candidatesSample: unknown[]; candidatesSampleTruncated: boolean; detailHint: string };
  assert.equal(compact.candidatesSample.length, 20);
  assert.equal(compact.candidatesSampleTruncated, true);
  assert.match(compact.detailHint, /detail=true/);
  assert.ok(JSON.stringify(compact).length < JSON.stringify(wizard).length * 0.4);
});
