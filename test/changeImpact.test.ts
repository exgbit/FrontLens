import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeGitChangeImpact, formatChangeImpactMarkdown } from '../src/changeImpact/gitChangeImpact.ts';
import { buildTestPlan } from '../src/testDesign/testPlan.ts';
import { buildTestPlanExecutionReport, formatCompactTestPlanExecutionReport } from '../src/testDesign/testExecutionReport.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { loadConfig } from '../src/config.ts';

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, { cwd, encoding: 'utf8' });
  return result.stdout.trim();
}

async function createRepository(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-change-impact-'));
  await mkdir(path.join(dir, 'src', 'orders'), { recursive: true });
  await mkdir(path.join(dir, 'test'), { recursive: true });
  await writeFile(path.join(dir, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' }, dependencies: { fastify: '^5.0.0' } }), 'utf8');
  await writeFile(path.join(dir, 'src', 'orders', 'service.ts'), 'export function createOrder(total: number) { return { total }; }\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'orders', 'migration.ts'), 'export const orderSchemaVersion = 1;\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'orders', 'controller.ts'), "import { createOrder } from './service.js';\nexport const route = 'POST /api/orders';\nexport const create = createOrder;\n", 'utf8');
  await writeFile(path.join(dir, 'test', 'orders.service.test.ts'), "import { createOrder } from '../src/orders/service.js';\nvoid createOrder(1);\n", 'utf8');
  await git(dir, 'init', '-b', 'main');
  await git(dir, 'config', 'user.email', 'frontlens@example.test');
  await git(dir, 'config', 'user.name', 'FrontLens Test');
  await git(dir, 'add', '.');
  await git(dir, 'commit', '-m', 'baseline');
  await git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
  await git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
  await git(dir, 'checkout', '-b', 'feature/orders');
  await writeFile(path.join(dir, 'src', 'orders', 'service.ts'), 'export function createOrder(total: number) {\n  if (total <= 0) throw new Error("invalid total");\n  return { total, status: "created" };\n}\n', 'utf8');
  await writeFile(path.join(dir, 'src', 'orders', 'migration.ts'), 'export const orderSchemaVersion = 2;\n', 'utf8');
  await git(dir, 'add', 'src/orders/service.ts', 'src/orders/migration.ts');
  await git(dir, 'commit', '-m', 'change order rules');
  await writeFile(path.join(dir, 'src', 'orders', 'worker.ts'), "import { createOrder } from './service.js';\nexport const run = () => createOrder(2);\n", 'utf8');
  return dir;
}

test('Git change impact compares the base branch, includes working tree, and propagates to dependents/tests', async () => {
  const dir = await createRepository();
  try {
    const impact = await analyzeGitChangeImpact({ sourceRoot: dir, includeWorkingTree: true });
    assert.equal(impact.status, 'analyzed');
    assert.equal(impact.baseRef, 'origin/main');
    assert.equal(impact.baseRefSource, 'remote-default');
    assert.equal(impact.headRef, 'HEAD');
    assert.equal(impact.workingTreeIncluded, true);
    assert.ok(impact.files.some((item) => item.path === 'src/orders/service.ts' && item.source === 'committed'));
    assert.ok(impact.files.some((item) => item.path === 'src/orders/worker.ts' && item.status === 'untracked'));
    const orders = impact.modules.find((item) => item.name === 'orders');
    assert.ok(orders);
    assert.ok(orders!.dependentFiles.includes('src/orders/controller.ts'));
    assert.ok(orders!.relatedTests.includes('test/orders.service.test.ts'));
    assert.ok(orders!.apiPatterns.includes('POST /api/orders'));
    assert.ok(orders!.businessFlows.some((item) => item.includes('既有成功路径')));
    assert.ok(impact.regressionTargets.some((item) => item.module === 'orders'));
    assert.match(formatChangeImpactMarkdown(impact), /静态影响分析用于选择回归范围，不代表原有业务已经通过/);
    const committedOnly = await analyzeGitChangeImpact({ sourceRoot: dir, baseRef: 'main', includeWorkingTree: false });
    assert.equal(committedOnly.workingTreeIncluded, false);
    assert.equal(committedOnly.files.some((item) => item.path === 'src/orders/worker.ts'), false);

    await writeFile(path.join(dir, 'unrelated.ts'), 'export const unrelated = true;\n', 'utf8');
    const scoped = await analyzeGitChangeImpact({ sourceRoot: path.join(dir, 'src', 'orders'), baseRef: 'main' });
    assert.equal(scoped.committedFileCount, 2);
    assert.equal(scoped.workingTreeFileCount, 1);
    assert.equal(scoped.files.some((item) => item.path === 'unrelated.ts'), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('change-impact Markdown is bounded while the JSON result retains full detail', async () => {
  const dir = await createRepository();
  try {
    const impact = await analyzeGitChangeImpact({ sourceRoot: dir });
    const file = impact.files[0]!;
    const module = impact.modules[0]!;
    const target = impact.regressionTargets[0]!;
    const large = {
      ...impact,
      files: Array.from({ length: 120 }, (_, index) => ({
        ...file,
        path: `src/module-${index}/file.ts`,
        changedSymbols: Array.from({ length: 20 }, (__, symbol) => `symbol-${index}-${symbol}-${'x'.repeat(140)}`)
      })),
      modules: Array.from({ length: 60 }, (_, index) => ({
        ...module,
        name: `module-${index}`,
        businessFlows: Array.from({ length: 12 }, (__, flow) => `flow-${index}-${flow}-${'y'.repeat(120)}`)
      })),
      regressionTargets: Array.from({ length: 60 }, (_, index) => ({
        ...target,
        id: `CHANGE-REG-${String(index + 1).padStart(3, '0')}`,
        module: `module-${index}`,
        reason: `risk-${index}-${'z'.repeat(900)}`
      }))
    };
    const markdown = formatChangeImpactMarkdown(large);
    assert.match(markdown, /其余 70 个文件见 change-impact\.json/);
    assert.match(markdown, /其余 30 个模块见 change-impact\.json/);
    assert.match(markdown, /其余 30 个目标见 change-impact\.json/);
    assert.ok(markdown.length < 50_000);
    assert.equal(large.files.length, 120);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deleted and renamed source paths still propagate to their existing importers', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-change-delete-'));
  try {
    await mkdir(path.join(dir, 'src', 'billing'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'billing', 'rules.ts'), 'export const canBill = () => true;\n', 'utf8');
    await writeFile(path.join(dir, 'src', 'billing', 'controller.ts'), "import { canBill } from './rules.js';\nexport const bill = canBill;\n", 'utf8');
    await git(dir, 'init', '-b', 'main');
    await git(dir, 'config', 'user.email', 'frontlens@example.test');
    await git(dir, 'config', 'user.name', 'FrontLens Test');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-m', 'baseline');
    await git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
    await git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    await git(dir, 'checkout', '-b', 'feature/remove-rules');
    await rm(path.join(dir, 'src', 'billing', 'rules.ts'));

    const impact = await analyzeGitChangeImpact({ sourceRoot: dir });
    assert.ok(impact.files.some((item) => item.path === 'src/billing/rules.ts' && item.status === 'deleted'));
    assert.ok(impact.modules.find((item) => item.name === 'billing')?.dependentFiles.includes('src/billing/controller.ts'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('test plan emits change-impact artifacts and prioritized legacy-business regression cases', async () => {
  const dir = await createRepository();
  const output = await mkdtemp(path.join(os.tmpdir(), 'frontlens-change-plan-'));
  try {
    const plan = await buildTestPlan({
      text: '- P1 创建订单时金额必须大于零。',
      sourceRoot: dir,
      projectType: 'backend',
      baseRef: 'main',
      outputDir: output
    });
    assert.equal(plan.changeImpact?.status, 'analyzed');
    assert.ok(plan.summary.changeFileCount >= 2);
    assert.ok(plan.summary.impactedModuleCount >= 1);
    assert.ok(plan.summary.changeRegressionCaseCount >= 1);
    const regression = plan.testCases.find((item) => item.tags.includes('change-impact') && item.tags.includes('module:orders'));
    assert.ok(regression);
    assert.deepEqual(regression!.changeImpactIds, ['CHANGE-REG-001']);
    assert.equal(regression!.priority, 'P0');
    assert.ok(regression!.audiences.includes('developer'));
    assert.ok(regression!.steps.some((item) => item.includes('原有')));
    assert.match(await readFile(path.join(output, 'change-impact.md'), 'utf8'), /影响模块与原有业务/);
    assert.equal((JSON.parse(await readFile(path.join(output, 'change-impact.json'), 'utf8')) as { baseRef: string }).baseRef, 'main');
    assert.match(await readFile(path.join(output, 'test-design-traceability.md'), 'utf8'), /Git 变更 → 影响模块 → 原业务回归用例/);
    assert.match(await readFile(path.join(output, 'qa-full-test-cases.md'), 'utf8'), /Git 变更影响与原业务回归/);
    const qaConfig = await loadConfig({ url: 'http://test.example/orders', requirementsPath: path.join(output, 'test-plan.json') });
    assert.ok(qaConfig.requirements.items.some((item) => item.id === regression!.changeImpactIds![0] && item.source === 'inferred'));
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(output, { recursive: true, force: true });
  }
});

test('explicit backend plans never add frontend change-regression cases', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-backend-impact-'));
  try {
    await mkdir(path.join(dir, 'src', 'pages'), { recursive: true });
    await writeFile(path.join(dir, 'src', 'pages', 'dashboard.ts'), 'export const title = "before";\n', 'utf8');
    await git(dir, 'init', '-b', 'main');
    await git(dir, 'config', 'user.email', 'frontlens@example.test');
    await git(dir, 'config', 'user.name', 'FrontLens Test');
    await git(dir, 'add', '.');
    await git(dir, 'commit', '-m', 'baseline');
    await git(dir, 'update-ref', 'refs/remotes/origin/main', 'main');
    await git(dir, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/main');
    await git(dir, 'checkout', '-b', 'feature/dashboard');
    await writeFile(path.join(dir, 'src', 'pages', 'dashboard.ts'), 'export const title = "after";\n', 'utf8');

    const plan = await buildTestPlan({ text: '- P1 后端健康检查返回 200。', sourceRoot: dir, projectType: 'backend' });
    assert.equal(plan.summary.frontendCount, 0);
    assert.equal(plan.testCases.some((item) => item.layer === 'frontend'), false);
    assert.equal(plan.changeImpact?.regressionTargets.some((item) => item.layer === 'frontend'), false);
    assert.ok(plan.changeImpact?.warnings.some((item) => item.includes('纯后端计划已排除')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('change regression remains not-run until independent target-bound evidence exists', async () => {
  const dir = await createRepository();
  try {
    const plan = await buildTestPlan({ text: '- P1 创建订单。', sourceRoot: dir, projectType: 'backend', baseRef: 'main' });
    const target = plan.changeImpact!.regressionTargets.find((item) => item.module === 'orders')!;
    const planned = plan.testCases.find((item) => item.changeImpactIds?.includes(target.id))!;
    const emptyResult = normalizeResult({ summary: { url: 'http://test/orders', title: 'Orders' } });
    const notRun = buildTestPlanExecutionReport(plan, emptyResult);
    assert.notEqual(notRun.changeRegression.status, 'passed');
    const compactReport = formatCompactTestPlanExecutionReport(notRun, plan, emptyResult);
    assert.match(compactReport, /受影响原业务回归/);
    assert.match(compactReport, /main.*HEAD/);
    assert.match(compactReport, /orders 既有成功路径/);

    const evidencedResult = normalizeResult({
      summary: { url: 'http://test/orders', title: 'Orders' },
      sourceHealth: {
        enabled: true,
        status: 'passed',
        checkedAt: '2026-07-14T00:00:00.000Z',
        packageScripts: [],
        scriptChecks: [],
        testEvidence: [{
          id: 'ORDERS-LEGACY-REGRESSION',
          requirementIds: [target.id],
          layer: planned.layer,
          scenarios: ['regression'],
          scriptNames: ['test'],
          status: 'passed',
          evidenceRefs: ['test/orders.service.test.ts'],
          notes: []
        }]
      }
    });
    const evidenced = buildTestPlanExecutionReport(plan, evidencedResult);
    const item = evidenced.changeRegression.items.find((entry) => entry.targetId === target.id);
    assert.equal(item?.status, 'passed');
    assert.ok(evidenced.changeRegression.passedCount >= 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('invalid explicit base ref degrades without fabricating impact or blocking requirement generation', async () => {
  const dir = await createRepository();
  try {
    const plan = await buildTestPlan({ text: '- P1 创建订单。', sourceRoot: dir, projectType: 'backend', baseRef: 'missing/base' });
    assert.equal(plan.changeImpact?.status, 'unavailable');
    assert.equal(plan.changeImpact?.changedFileCount, 0);
    assert.equal(plan.summary.changeRegressionCaseCount, 0);
    assert.ok(plan.requirements.length > 0);
    assert.ok(plan.reviewQuestions.some((item) => item.includes('missing/base')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('change impact can be explicitly disabled without changing the normal requirement plan', async () => {
  const plan = await buildTestPlan({ text: '- P1 用户可以查询订单。', changeImpact: false });
  assert.equal(plan.changeImpact?.status, 'disabled');
  assert.equal(plan.summary.changeFileCount, 0);
  assert.equal(plan.summary.changeRegressionCaseCount, 0);
  assert.ok(plan.testCases.some((item) => !item.tags.includes('change-impact')));
});
