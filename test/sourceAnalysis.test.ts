import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import { analyzeSource } from '../src/source/sourceAnalyzer.ts';

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
  await writeFile(path.join(dir, 'src/views/RulesView.vue'), '<template><div>Rules</div></template>', 'utf8');
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
