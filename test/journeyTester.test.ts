import test from 'node:test';
import assert from 'node:assert/strict';
import { findExpectedRequest } from '../src/journeys/journeyTester.ts';
import type { NetworkRecord } from '../src/types.ts';

function request(overrides: Partial<NetworkRecord>): NetworkRecord {
  return {
    id: 'REQ-1',
    url: 'https://example.com/api/users/list?page=1',
    method: 'GET',
    resourceType: 'xhr',
    requestHeaders: {},
    status: 200,
    ok: true,
    failed: false,
    startedAt: '2026-07-07T00:00:01.000Z',
    ...overrides
  };
}

test('findExpectedRequest matches URL patterns and 2xx/default status', () => {
  const result = findExpectedRequest([
    request({ id: 'REQ-1', status: 200, ok: true }),
    request({ id: 'REQ-2', url: 'https://example.com/api/orders', status: 200, ok: true })
  ], '/api/users', '2xx', '2026-07-07T00:00:00.000Z');

  assert.deepEqual(result.matched.map((item) => item.id), ['REQ-1']);
  assert.deepEqual(result.passed.map((item) => item.id), ['REQ-1']);
});

test('findExpectedRequest supports regex patterns and status comparisons', () => {
  const records = [
    request({ id: 'REQ-1', url: 'https://example.com/api/users/list', status: 500, ok: false }),
    request({ id: 'REQ-2', url: 'https://example.com/api/users/detail', status: 204, ok: true })
  ];

  const failed = findExpectedRequest(records, 'regex=/api/users/(list|detail)', '<400', '2026-07-07T00:00:00.000Z');
  assert.deepEqual(failed.matched.map((item) => item.id), ['REQ-1', 'REQ-2']);
  assert.deepEqual(failed.passed.map((item) => item.id), ['REQ-2']);
});

test('findExpectedRequest ignores requests before journey start', () => {
  const result = findExpectedRequest([
    request({ id: 'REQ-OLD', startedAt: '2026-07-06T23:59:59.000Z' }),
    request({ id: 'REQ-NEW', startedAt: '2026-07-07T00:00:02.000Z' })
  ], '/api/users', '200', '2026-07-07T00:00:00.000Z');

  assert.deepEqual(result.matched.map((item) => item.id), ['REQ-NEW']);
  assert.deepEqual(result.passed.map((item) => item.id), ['REQ-NEW']);
});
