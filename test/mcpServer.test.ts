import test from 'node:test';
import assert from 'node:assert/strict';
import { validateArgs } from '../src/mcpServer.ts';

test('MCP required-argument validation accepts required arrays used by role matrix', () => {
  const roles = [{ name: 'viewer' }];
  const result = validateArgs({ url: 'https://example.com', roles }, ['url', 'roles'], ['url', 'roles']);
  assert.equal(result.roles, roles);
});

test('MCP required-argument validation rejects empty required arrays', () => {
  assert.throws(
    () => validateArgs({ url: 'https://example.com', roles: [] }, ['url', 'roles'], ['url', 'roles']),
    /Missing required argument\(s\): roles/
  );
});
