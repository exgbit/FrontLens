import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { handoffOutputPermissions, unsafePermissionHandoffReason, windowsAclInheritanceArgs, windowsAclResetArgs } from '../src/utils/fs.ts';

test('Windows ACL handoff enables inheritance recursively without granting broad users', () => {
  const args = windowsAclInheritanceArgs('C:\\work\\reports\\run-1', true);
  assert.deepEqual(args, ['C:\\work\\reports\\run-1', '/inheritance:e', '/T', '/C', '/Q']);
  assert.equal(args.some((item) => /everyone|users|S-1-1-0|grant/i.test(item)), false);
});

test('Windows ACL handoff can target only a newly created directory', () => {
  assert.deepEqual(windowsAclInheritanceArgs('C:\\work\\reports\\run-1', false), [
    'C:\\work\\reports\\run-1',
    '/inheritance:e',
    '/C',
    '/Q'
  ]);
});

test('Windows ACL handoff resets sandbox-only explicit DACL without granting broad principals', () => {
  const args = windowsAclResetArgs('C:\\work\\reports\\run-1', true);
  assert.deepEqual(args, ['C:\\work\\reports\\run-1', '/reset', '/T', '/C', '/Q']);
  assert.equal(args.some((item) => /everyone|users|S-1-1-0|grant/i.test(item)), false);
});

test('output permission handoff is a safe no-op outside Windows', async () => {
  if (process.platform === 'win32') return;
  const result = await handoffOutputPermissions(path.join(process.cwd(), 'reports', 'permission-test'));
  assert.equal(result.status, 'skipped');
  assert.match(result.message, /not required/i);
});

test('recursive permission repair rejects roots, home/workspace and broad top-level targets', () => {
  const root = path.parse(process.cwd()).root;
  assert.match(unsafePermissionHandoffReason(root) ?? '', /filesystem root/);
  assert.match(unsafePermissionHandoffReason(process.cwd()) ?? '', /source workspace/);
  assert.match(unsafePermissionHandoffReason(path.dirname(process.cwd())) ?? '', /ancestor/);
  const broad = path.join(root, 'generated');
  assert.match(unsafePermissionHandoffReason(broad, path.join(root, 'work', 'repo'), path.join(root, 'home', 'user')) ?? '', /top-level/);
  const specific = path.join(root, 'work', 'reports', 'run-1');
  assert.equal(unsafePermissionHandoffReason(specific, path.join(root, 'other', 'repo'), path.join(root, 'home', 'user')), undefined);
});
