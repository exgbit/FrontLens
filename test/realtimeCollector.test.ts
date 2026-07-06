import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeCollector } from '../src/realtime/realtimeCollector.ts';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import type { NetworkRecord } from '../src/types.ts';

test('RealtimeCollector expands batched GraphQL operations with per-operation errors', () => {
  const config = createDefaultConfig('https://example.com/graphql');
  const collector = new RealtimeCollector(config);
  const request: NetworkRecord = {
    id: 'REQ-0001',
    url: 'https://example.com/graphql',
    method: 'POST',
    resourceType: 'fetch',
    requestHeaders: { 'content-type': 'application/json' },
    postData: JSON.stringify([
      { operationName: 'ViewerQuery', query: 'query ViewerQuery { viewer { id } }', variables: { token: 'secret-token' } },
      { operationName: 'UpdateName', query: 'mutation UpdateName { updateName(name: "A") { id } }' }
    ]),
    status: 200,
    ok: true,
    failed: false,
    startedAt: '2026-01-01T00:00:00.000Z',
    contentType: 'application/json',
    protocol: 'graphql',
    responseBodyPreview: JSON.stringify([{ data: { viewer: { id: 'u1' } } }, { errors: [{ message: 'boom' }] }])
  };

  const result = collector.build([request]);

  assert.equal(result.graphql.length, 2);
  assert.equal(result.graphql[0].operationName, 'ViewerQuery');
  assert.equal(result.graphql[0].operationType, 'query');
  assert.equal(result.graphql[0].hasErrors, false);
  assert.match(result.graphql[0].variablesPreview ?? '', /REDACTED/);
  assert.equal(result.graphql[1].operationName, 'UpdateName');
  assert.equal(result.graphql[1].operationType, 'mutation');
  assert.equal(result.graphql[1].hasErrors, true);
  assert.equal(result.summary.graphqlOperationCount, 2);
  assert.equal(result.summary.graphqlErrorCount, 1);
});
