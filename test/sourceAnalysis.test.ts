import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { analyzeSource } from '../src/source/sourceAnalyzer.ts';
import { buildSourceRuntimeCorrelation } from '../src/source/sourceRuntimeCorrelation.ts';
import { analyzeSourceHealth } from '../src/source/sourceHealth.ts';
import type { NetworkRecord, PageModel, SourceAnalysisResult } from '../src/types.ts';

test('source analysis indexes routes, API calls, states and reports eager route imports', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-source-'));
  await mkdir(path.join(dir, 'src/router'), { recursive: true });
  await mkdir(path.join(dir, 'src/views'), { recursive: true });
  await mkdir(path.join(dir, 'src/api'), { recursive: true });
  await writeFile(
    path.join(dir, 'src/router/index.ts'),
    `
import UsersView from '../views/UsersView.vue';
import RulesView from '../views/RulesView.vue';

export const routes = [
  { path: '/users', name: 'users', component: UsersView },
  { path: '/rules', name: 'rules', component: RulesView }
];
`,
    'utf8'
  );
  await writeFile(path.join(dir, 'src/views/UsersView.vue'), '<template><div>Users</div></template>', 'utf8');
  await writeFile(
    path.join(dir, 'src/views/RulesView.vue'),
    `<template>
  <div>Rules</div>
  <el-button :icon="Edit" circle />
  <el-button :icon="Delete" circle aria-label="删除规则" />
</template>`,
    'utf8'
  );
  await writeFile(
    path.join(dir, 'src/views/CredentialsView.vue'),
    `<template>
  <section>
    <p v-if="items.length === 0">暂无匹配凭证</p>
  </section>
</template>
<script setup lang="ts">
const { items, error } = useCredentials();
if (error.value) {
  // the error state is tracked but not rendered in the template
}
</script>`,
    'utf8'
  );
  await writeFile(
    path.join(dir, 'src/api/users.ts'),
    `
export async function listUsers() {
  const loading = true;
  try {
    return await http.get('/api/users');
  } catch (error) {
    const emptyState = true;
    return { empty: emptyState, error };
  }
}
`,
    'utf8'
  );

  const config = createDefaultConfig('https://example.com/users');
  config.source.root = dir;
  const { result, issues } = await analyzeSource(config);

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.routeCount, 2);
  assert.equal(result.summary.eagerRouteImportCount, 2);
  assert.equal(result.summary.apiCallCount, 1);
  assert.equal(result.summary.errorStateSignalCount >= 1, true);
  assert.equal(result.summary.emptyStateSignalCount >= 1, true);
  assert.equal(result.findings.some((finding) => finding.kind === 'eager-route-imports'), true);
  const uiFinding = result.findings.find((finding) => finding.kind === 'ui-accessibility');
  assert.equal(Boolean(uiFinding), true);
  assert.equal(uiFinding?.details.rule, 'button-name');
  assert.equal(uiFinding?.locations.length, 1);
  assert.match(JSON.stringify(uiFinding?.details.samples), /el-button/);
  const errorGapFinding = result.findings.find((finding) => finding.kind === 'error-state-gap');
  assert.equal(Boolean(errorGapFinding), true);
  assert.equal(errorGapFinding?.details.rule, 'error-state-rendering');
  assert.deepEqual(errorGapFinding?.details.tokens, ['credentials']);
  assert.equal(errorGapFinding?.locations.some((location) => location.file === 'src/views/CredentialsView.vue' && location.line === 7), true);
  assert.match(JSON.stringify(errorGapFinding?.details.samples), /暂无匹配凭证/);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'frontend-performance');
});

test('source analysis skips cleanly without a source root', async () => {
  const config = createDefaultConfig('https://example.com/users');
  const { result, issues } = await analyzeSource(config);
  assert.equal(result.status, 'skipped');
  assert.equal(result.scannedFiles, 0);
  assert.equal(issues.length, 0);
});

test('source analysis detects JSX error state gaps but ignores rendered error feedback', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-source-jsx-gap-'));
  await mkdir(path.join(dir, 'src/pages'), { recursive: true });
  await writeFile(
    path.join(dir, 'src/pages/OrdersPage.tsx'),
    `
export function OrdersPage() {
  const { orders, error } = useOrders();
  if (error) {
    // tracked for telemetry, but not rendered for users
  }
  return (
    <section>
      {orders.length === 0 ? <p>No data</p> : orders.map((order) => <span key={order.id}>{order.name}</span>)}
    </section>
  );
}
`,
    'utf8'
  );
  await writeFile(
    path.join(dir, 'src/pages/UsersPage.tsx'),
    `
export function UsersPage() {
  const { users, error, retry } = useUsers();
  if (error) {
    return <Alert role="alert" message={error.message} action={<button onClick={retry}>Retry</button>} />;
  }
  return <section>{users.length === 0 ? <p>No data</p> : <UserList users={users} />}</section>;
}
`,
    'utf8'
  );

  const config = createDefaultConfig('https://example.com/orders');
  config.source.root = dir;
  const { result } = await analyzeSource(config);

  const findings = result.findings.filter((finding) => finding.kind === 'error-state-gap');
  assert.equal(findings.length, 1);
  assert.equal(findings[0].locations[0].file, 'src/pages/OrdersPage.tsx');
  assert.deepEqual(findings[0].details.tokens, ['orders']);
  assert.match(JSON.stringify(findings[0].details.samples), /No data/);
});

test('source runtime correlation links network responses to source API and UI hints', () => {
  const sourceAnalysis: SourceAnalysisResult = {
    enabled: true,
    status: 'passed',
    checkedAt: '',
    root: '/repo',
    scannedFiles: 2,
    scannedBytes: 100,
    summary: {
      routeFileCount: 0,
      routeCount: 0,
      eagerRouteImportCount: 0,
      heavyImportCount: 0,
      apiCallCount: 1,
      errorStateSignalCount: 1,
      emptyStateSignalCount: 0
    },
    routeFiles: [],
    routes: [],
    imports: [],
    apiCalls: [
      {
        file: 'src/api/users.ts',
        line: 10,
        method: 'GET',
        path: '/api/users',
        client: 'http',
        expression: "http.get('/api/users')"
      }
    ],
    stateSignals: [
      {
        file: 'src/api/users.ts',
        line: 13,
        kind: 'error',
        text: 'error.value = err'
      }
    ],
    findings: []
  };
  const networkRecords: NetworkRecord[] = [
    {
      id: 'REQ-001',
      method: 'GET',
      url: 'https://example.com/api/users?page=1',
      resourceType: 'fetch',
      requestHeaders: {},
      status: 200,
      ok: true,
      failed: false,
      startedAt: '',
      contentType: 'application/json',
      responseBodyPreview: JSON.stringify({ records: [{ id: 1, name: 'Alice' }] })
    },
    {
      id: 'REQ-002',
      method: 'GET',
      url: 'https://example.com/api/unrelated',
      resourceType: 'fetch',
      requestHeaders: {},
      status: 200,
      ok: true,
      failed: false,
      startedAt: '',
      contentType: 'application/json',
      responseBodyPreview: JSON.stringify({ data: [{ id: 1 }] })
    }
  ];
  const pageModel: PageModel = {
    url: 'https://example.com/users',
    title: '',
    meta: { h1: [], openGraph: {} },
    breadcrumbs: [],
    headings: [],
    structureTree: '',
    components: [{ id: 'CMP-users-list', type: 'list', label: 'users', text: 'Users', selector: '.users', tagName: 'div', visible: true, attributes: {}, childrenCount: 1, confidence: 0.9 }],
    forms: [],
    tables: [],
    buttons: [],
    inputs: [],
    images: [],
    links: [],
    stats: { domNodes: 1, visibleTextLength: 5, bodyTextSample: 'Users' }
  };

  const result = buildSourceRuntimeCorrelation({ sourceAnalysis, networkRecords, pageModel });

  assert.equal(result.status, 'passed');
  assert.equal(result.summary.networkRequestCount, 2);
  assert.equal(result.links[0].confidence, 'high');
  assert.equal(result.links[0].sourceMatches[0].file, 'src/api/users.ts');
  assert.deepEqual(result.links[0].componentIds, ['CMP-users-list']);
  assert.equal(result.links[0].responseListHints[0].path, '$.records');
  assert.equal(result.links[1].confidence, 'none');
  assert.equal(result.summary.unlinkedRequestCount, 1);
});

test('source health detects package scripts and TS/Vue syntax errors', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-source-health-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { build: 'vite build', typecheck: 'vue-tsc --noEmit', lint: 'eslint src' } }),
    'utf8'
  );
  await writeFile(path.join(dir, 'package-lock.json'), '{}', 'utf8');
  await writeFile(path.join(dir, 'src/good.ts'), 'export const ok = 1;\n', 'utf8');
  await writeFile(path.join(dir, 'src/bad.ts'), 'export const broken = ;\n', 'utf8');
  await writeFile(
    path.join(dir, 'src/BadView.vue'),
    `<template><div>Bad</div></template>
<script setup lang="ts">
const value =
</script>
`,
    'utf8'
  );

  const config = createDefaultConfig('https://example.com/users');
  config.source.root = dir;
  const { result, issues } = await analyzeSourceHealth(config);

  assert.equal(result.status, 'failed');
  assert.equal(result.packageManager, 'npm');
  assert.equal(result.packageScripts.some((script) => script.name === 'typecheck' && script.category === 'typecheck'), true);
  assert.equal(result.syntaxErrorCount >= 2, true);
  assert.equal(result.findings.some((finding) => finding.file === 'src/bad.ts'), true);
  assert.equal(result.findings.some((finding) => finding.file === 'src/BadView.vue'), true);
  assert.equal(result.scriptChecks.length, 0);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].category, 'frontend-source-health');
});

test('source health can run selected safe package scripts and record passes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-source-script-pass-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { typecheck: 'node -e "process.exit(0)"', lint: 'node -e "process.exit(0)"' } }),
    'utf8'
  );
  await writeFile(path.join(dir, 'package-lock.json'), '{}', 'utf8');
  await writeFile(path.join(dir, 'src/good.ts'), 'export const ok = 1;\n', 'utf8');

  const config = createDefaultConfig('https://example.com/users');
  config.source.root = dir;
  config.source.runScripts = true;
  config.source.scriptNames = ['typecheck'];
  config.source.scriptTimeoutMs = 30_000;

  const { result, issues } = await analyzeSourceHealth(config);

  assert.equal(result.status, 'passed');
  assert.equal(result.scriptChecks.length, 1);
  assert.equal(result.scriptChecks[0].scriptName, 'typecheck');
  assert.equal(result.scriptChecks[0].status, 'passed');
  assert.equal(issues.length, 0);
});

test('source health turns failed selected package scripts into actionable source issues', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-source-script-fail-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { lint: 'node -e "process.stderr.write(\\\"lint failed\\\"); process.exit(2)"' } }),
    'utf8'
  );
  await writeFile(path.join(dir, 'package-lock.json'), '{}', 'utf8');
  await writeFile(path.join(dir, 'src/good.ts'), 'export const ok = 1;\n', 'utf8');

  const config = createDefaultConfig('https://example.com/users');
  config.source.root = dir;
  config.source.runScripts = true;
  config.source.scriptNames = ['lint'];
  config.source.scriptTimeoutMs = 30_000;

  const { result, issues } = await analyzeSourceHealth(config);

  assert.equal(result.status, 'failed');
  assert.equal(result.syntaxErrorCount, 0);
  assert.equal(result.scriptChecks.length, 1);
  assert.equal(result.scriptChecks[0].status, 'failed');
  assert.match(result.scriptChecks[0].stderrPreview ?? '', /lint failed/);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].id, 'SOURCE-HEALTH-SCRIPT');
  assert.equal(issues[0].category, 'frontend-source-health');
});
