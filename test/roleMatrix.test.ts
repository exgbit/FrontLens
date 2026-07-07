import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRoleMatrixResult, loadRoleMatrixRoles, parseRoleSpec, writeRoleMatrixResult } from '../src/roles/roleMatrix.ts';
import { normalizeResult } from '../src/resultNormalizer.ts';

function qa(role: string, buttons: string[], issues: Array<{ title: string; fingerprint: string; category?: string }> = []) {
  return normalizeResult({
    summary: {
      url: 'https://example.com/admin/users',
      title: 'Users',
      score: 90,
      testedAt: '2026-07-07T00:00:00.000Z',
      browser: 'chromium',
      viewport: { width: 1440, height: 900 }
    },
    pageModel: {
      url: 'https://example.com/admin/users',
      title: 'Users',
      stats: { domNodes: 20, visibleTextLength: 100, bodyTextSample: `${role} ${buttons.join(' ')}` },
      components: buttons.map((label, index) => ({ id: `${role}-btn-${index}`, type: 'button', label, text: label, visible: true, attributes: {}, confidence: 0.9 })),
      buttons: buttons.map((label, index) => ({ id: `${role}-btn-${index}`, type: 'button', label, text: label, visible: true, attributes: {}, confidence: 0.9 }))
    },
    issues: issues.map((issue) => ({
      title: issue.title,
      fingerprint: issue.fingerprint,
      category: issue.category ?? 'frontend-accessibility',
      severity: 'medium',
      confidence: 0.9,
      description: issue.title,
      evidence: {},
      reason: issue.title,
      suggestion: { frontend: 'Fix', priority: 'P2' },
      source: 'rule'
    }))
  });
}

test('role matrix compares action/issue differences and flags low-privilege dangerous actions as review candidates', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-role-'));
  try {
    const result = createRoleMatrixResult(
      [
        {
          role: { name: 'admin', storageState: '.auth/admin.json' },
          outputDir: path.join(dir, 'admin'),
          result: qa('admin', ['View', 'Edit', 'Delete User'], [
            { title: 'Missing accessible name', fingerprint: 'fp-common' },
            { title: 'Admin-only performance issue', fingerprint: 'fp-admin', category: 'frontend-performance' }
          ])
        },
        {
          role: { name: 'viewer', storageState: '.auth/viewer.json', expectedForbiddenTexts: ['Delete User'] },
          outputDir: path.join(dir, 'viewer'),
          result: qa('viewer', ['View', 'Delete User'], [{ title: 'Missing accessible name', fingerprint: 'fp-common' }])
        }
      ],
      'https://example.com/admin/users',
      dir
    );
    await writeRoleMatrixResult(result);

    assert.equal(result.comparison.successfulRoleCount, 2);
    assert.deepEqual(result.comparison.sharedActionLabels, ['Delete User', 'View']);
    assert.deepEqual(result.comparison.roleSpecificActionLabels.admin, ['Edit']);
    assert.deepEqual(result.comparison.roleSpecificIssueTitles.admin, ['Admin-only performance issue']);
    assert.deepEqual(result.comparison.lowPrivilegeDangerousActionRoles, ['viewer']);
    assert.deepEqual(result.comparison.expectedForbiddenViolations.viewer, ['Delete User']);
    assert.equal(result.comparison.permissionRiskCount >= 2, true);
    assert.match(await readFile(result.artifacts.markdown, 'utf8'), /Role Matrix Report/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('parse role spec supports anonymous and sessionStorage sidecar syntax', () => {
  assert.deepEqual(parseRoleSpec('guest='), { name: 'guest', storageState: undefined, sessionStorageState: undefined });
  assert.deepEqual(parseRoleSpec('admin=.auth/admin.json|.auth/admin.session.json'), {
    name: 'admin',
    storageState: '.auth/admin.json',
    sessionStorageState: '.auth/admin.session.json'
  });
});

test('role matrix loads role JSON with expected permission contracts', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'frontlens-role-config-'));
  try {
    const file = path.join(dir, 'roles.json');
    await writeFile(
      file,
      JSON.stringify({
        roles: [
          {
            name: 'viewer',
            storageState: '.auth/viewer.json',
            expectedForbiddenTexts: ['Delete']
          }
        ]
      }),
      'utf8'
    );
    assert.deepEqual(await loadRoleMatrixRoles(file), [
      {
        name: 'viewer',
        storageState: '.auth/viewer.json',
        sessionStorageState: undefined,
        expectedAllowedTexts: undefined,
        expectedForbiddenTexts: ['Delete']
      }
    ]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
