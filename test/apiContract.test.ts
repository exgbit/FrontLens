import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeApiContract } from '../src/contract/apiContract.ts';
import { createDefaultConfig } from '../src/defaultConfig.ts';
import type { NetworkRecord } from '../src/types.ts';

function record(url: string, id: string): NetworkRecord {
  return {
    id,
    url,
    method: 'GET',
    resourceType: 'fetch',
    requestHeaders: {},
    failed: false,
    startedAt: '2026-01-01T00:00:00.000Z',
    status: 200,
    ok: true,
    contentType: 'application/json',
    responseBodyPreview: '{"ok":true}'
  };
}

test('OpenAPI path matching escapes regex metacharacters outside path params', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-contract-'));
  const schemaPath = path.join(dir, 'openapi.json');
  await writeFile(
    schemaPath,
    JSON.stringify({
      openapi: '3.0.0',
      paths: {
        '/api/v1/users/{id}.json': {
          get: {
            responses: {
              '200': {
                description: 'OK'
              }
            }
          }
        }
      }
    }),
    'utf8'
  );

  const config = createDefaultConfig('https://example.com');
  config.contract.schemaPath = schemaPath;

  const { result } = await analyzeApiContract(
    config,
    [record('https://example.com/api/v1/users/123.json', 'REQ-0001'), record('https://example.com/api/v1/users/123xjson', 'REQ-0002')],
    {}
  );

  const matched = result.endpoints.find((endpoint) => endpoint.path === '/api/v1/users/{id}.json');
  const unmatched = result.endpoints.find((endpoint) => endpoint.path === '/api/v1/users/123xjson');

  assert.equal(matched?.schemaMatched, true);
  assert.equal(unmatched?.issues.some((issue) => issue.rule === 'undocumented-endpoint'), true);
  assert.equal(result.summary.undocumentedCount, 1);
});

test('OpenAPI default response accepts any status code', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-contract-'));
  const schemaPath = path.join(dir, 'openapi.json');
  await writeFile(
    schemaPath,
    JSON.stringify({
      openapi: '3.0.0',
      paths: {
        '/api/v1/users': {
          get: {
            responses: {
              default: { description: 'Any response' }
            }
          }
        }
      }
    }),
    'utf8'
  );

  const config = createDefaultConfig('https://example.com');
  config.contract.schemaPath = schemaPath;

  const { result } = await analyzeApiContract(config, [{ ...record('https://example.com/api/v1/users', 'REQ-0001'), status: 418, ok: false }], {});
  assert.equal(result.endpoints[0].issues.some((issue) => issue.rule === 'undocumented-status-code'), false);
  assert.deepEqual(result.endpoints[0].networkRequestIds, ['REQ-0001']);
});

test('OpenAPI schema load failure is reported instead of silently skipped', async () => {
  const config = createDefaultConfig('https://example.com');
  config.contract.schemaPath = path.join(tmpdir(), 'frontlens-missing-openapi.json');
  config.contract.inferFromTraffic = false;

  const { result, issues } = await analyzeApiContract(config, [record('https://example.com/api/v1/users', 'REQ-0001')], {});
  assert.equal(result.endpoints.length, 0);
  assert.equal(issues.some((issue) => issue.category === 'backend-api-contract' && /加载失败/.test(issue.title)), true);
});
