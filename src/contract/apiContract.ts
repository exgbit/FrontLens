import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { ApiContractResult, FrontLensConfig, Issue, NetworkRecord } from '../types.js';
import { IssueFactory } from '../analyzers/issueFactory.js';

interface OpenApiDoc {
  paths?: Record<string, Record<string, { responses?: Record<string, unknown>; requestBody?: unknown }>>;
}

interface ContractOutput {
  result: ApiContractResult;
  issues: Issue[];
}

interface ApiContractAnalyzeOptions {
  excludedNetworkRequestIds?: Iterable<string>;
}

function createEmpty(config: FrontLensConfig): ApiContractResult {
  return {
    enabled: config.contract.enabled,
    schemaPath: config.contract.schemaPath,
    checkedAt: new Date().toISOString(),
    summary: { endpointCount: 0, undocumentedCount: 0, statusMismatchCount: 0, schemaMismatchCount: 0, inferredCount: 0 },
    endpoints: []
  };
}

function parseJson(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function shapeOf(value: unknown, depth = 0): unknown {
  if (depth > 3) return '...';
  if (value === null) return 'null';
  if (Array.isArray(value)) return value.length ? [shapeOf(value[0], depth + 1)] : [];
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).slice(0, 40).map(([key, item]) => [key, shapeOf(item, depth + 1)]));
  }
  return typeof value;
}

function normalizePath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname.replace(/\/[0-9a-f]{8,}(?=\/|$)/gi, '/{id}').replace(/\/\d+(?=\/|$)/g, '/{id}');
  } catch {
    return url.split('?')[0] || url;
  }
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openApiPathRegex(schemaPath: string): RegExp {
  const parts = schemaPath.split(/(\{[^/{}]+\})/g);
  const source = parts.map((part) => (/^\{[^/{}]+\}$/.test(part) ? '[^/]+' : escapeRegex(part))).join('');
  return new RegExp(`^${source}$`);
}

function matchOpenApiPath(doc: OpenApiDoc | undefined, method: string, requestPath: string): { path: string; operation: { responses?: Record<string, unknown>; requestBody?: unknown } } | undefined {
  if (!doc?.paths) return undefined;
  const methodKey = method.toLowerCase();
  for (const [schemaPath, item] of Object.entries(doc.paths)) {
    const operation = item?.[methodKey];
    if (!operation) continue;
    const regex = openApiPathRegex(schemaPath);
    if (schemaPath === requestPath || regex.test(requestPath)) return { path: schemaPath, operation };
  }
  return undefined;
}

async function loadOpenApi(config: FrontLensConfig): Promise<OpenApiDoc | undefined> {
  if (!config.contract.schemaPath) return undefined;
  const absolute = path.isAbsolute(config.contract.schemaPath) ? config.contract.schemaPath : path.resolve(process.cwd(), config.contract.schemaPath);
  const text = await readFile(absolute, 'utf8');
  return JSON.parse(text) as OpenApiDoc;
}

function groupRequests(records: NetworkRecord[]): Map<string, NetworkRecord[]> {
  const groups = new Map<string, NetworkRecord[]>();
  for (const record of records.filter((item) => ['xhr', 'fetch'].includes(item.resourceType) || item.protocol === 'graphql' || item.protocol === 'sse')) {
    const key = `${record.method.toUpperCase()} ${normalizePath(record.url)}`;
    const list = groups.get(key) ?? [];
    list.push(record);
    groups.set(key, list);
  }
  return groups;
}

function makeIssues(result: ApiContractResult, artifacts: { screenshot?: string }): Issue[] {
  const factory = new IssueFactory();
  const issues: Issue[] = [];
  for (const endpoint of result.endpoints) {
    for (const item of endpoint.issues) {
      issues.push(
        factory.create({
          title: `API Contract：${item.message}`,
          category: 'backend-api-contract',
          severity: item.severity,
          confidence: 0.82,
          description: `${endpoint.method} ${endpoint.path} 违反接口契约规则 ${item.rule}。`,
          evidence: {
            screenshot: artifacts.screenshot,
            networkRequestId: item.networkRequestIds[0],
            details: { endpoint, rule: item.rule, requestIds: item.networkRequestIds }
          },
          reproduceSteps: ['运行 FrontLens QA', `查看 Network 请求 ${item.networkRequestIds.join(', ')}`, '对比 apiContract.endpoints 中的契约分析结果'],
          reason: '接口契约不一致会导致前端字段使用、错误处理和回归测试不稳定。',
          suggestion: {
            frontend: '根据契约调整请求参数和响应字段消费，并为字段缺失补充兜底。',
            backend: '同步 OpenAPI/接口实现，保证状态码、Content-Type 和响应字段符合约定。',
            test: '补充基于 OpenAPI 的契约测试。',
            priority: item.severity === 'high' ? 'P1' : 'P2'
          }
        })
      );
    }
  }
  return issues;
}

function makeSchemaLoadIssue(config: FrontLensConfig, error: unknown, artifacts: { screenshot?: string }): Issue {
  const factory = new IssueFactory();
  const message = error instanceof Error ? error.message : String(error);
  return factory.create({
    title: `API Contract：OpenAPI schema 加载失败`,
    category: 'backend-api-contract',
    severity: 'high',
    confidence: 0.95,
    description: `无法读取或解析 contract.schemaPath：${config.contract.schemaPath ?? '(missing)'}`,
    evidence: {
      screenshot: artifacts.screenshot,
      details: {
        schemaPath: config.contract.schemaPath,
        error: message
      }
    },
    reproduceSteps: ['检查 FrontLens 配置中的 contract.schemaPath', '确认文件存在、可读且为 JSON OpenAPI 文档', '重新运行 FrontLens QA'],
    reason: '显式配置的 OpenAPI 契约文件不可用时，契约检查会退化或失效，可能掩盖接口漂移。',
    suggestion: {
      backend: '修复 OpenAPI 文件路径或格式；如使用 YAML，请先转换为 JSON 或扩展 FrontLens YAML 支持。',
      test: '在 CI 中校验 schemaPath 可读且可解析。',
      priority: 'P1'
    },
    source: 'rule'
  });
}

export async function analyzeApiContract(config: FrontLensConfig, networkRecords: NetworkRecord[], artifacts: { screenshot?: string }, options: ApiContractAnalyzeOptions = {}): Promise<ContractOutput> {
  if (!config.contract.enabled) return { result: createEmpty(config), issues: [] };
  const excluded = new Set(options.excludedNetworkRequestIds ?? []);
  const recordsForContract = excluded.size > 0 ? networkRecords.filter((record) => !excluded.has(record.id)) : networkRecords;
  let schemaLoadError: unknown;
  const openApi = await loadOpenApi(config).catch((error: unknown) => {
    schemaLoadError = error;
    return undefined;
  });
  const schemaLoadIssues = schemaLoadError && config.contract.schemaPath ? [makeSchemaLoadIssue(config, schemaLoadError, artifacts)] : [];
  if (!openApi && !config.contract.inferFromTraffic) {
    return { result: createEmpty(config), issues: schemaLoadIssues };
  }
  const endpoints: ApiContractResult['endpoints'] = [];

  for (const [key, records] of groupRequests(recordsForContract)) {
    const [method, requestPath] = key.split(' ');
    const statuses = [...new Set(records.map((record) => record.status).filter((status): status is number => typeof status === 'number'))].sort((a, b) => a - b);
    const contentTypes = [...new Set(records.map((record) => record.contentType).filter((item): item is string => Boolean(item)))];
    const firstJsonResponse = records.map((record) => parseJson(record.responseBodyPreview)).find((value) => value !== undefined);
    const firstJsonRequest = records.map((record) => parseJson(record.postData)).find((value) => value !== undefined);
    const issues: ApiContractResult['endpoints'][number]['issues'] = [];
    const matched = matchOpenApiPath(openApi, method, requestPath);

    if (openApi && !matched) {
      issues.push({ rule: 'undocumented-endpoint', severity: config.contract.strict ? 'high' : 'medium', message: `接口未在 OpenAPI 中声明：${method} ${requestPath}`, networkRequestIds: records.map((record) => record.id) });
    }
    if (matched?.operation.responses && statuses.length) {
      const declared = new Set(Object.keys(matched.operation.responses).map((item) => item.toLowerCase()));
      const mismatch = statuses.filter((status) => !declared.has('default') && !declared.has(String(status).toLowerCase()) && !(status >= 200 && status < 300 && declared.has('2xx')) && !(status >= 400 && status < 500 && declared.has('4xx')) && !(status >= 500 && declared.has('5xx')));
      if (mismatch.length) {
        issues.push({ rule: 'undocumented-status-code', severity: 'medium', message: `状态码未在 OpenAPI responses 中声明：${mismatch.join(', ')}`, networkRequestIds: records.filter((record) => mismatch.includes(record.status ?? -1)).map((record) => record.id) });
      }
    }
    if (records.some((record) => record.ok === false && (record.status ?? 0) >= 500)) {
      issues.push({ rule: 'server-error-contract', severity: 'high', message: `${method} ${requestPath} 返回 5xx，违反稳定性契约`, networkRequestIds: records.filter((record) => (record.status ?? 0) >= 500).map((record) => record.id) });
    }
    if (contentTypes.some((type) => /html/i.test(type)) && records.some((record) => ['xhr', 'fetch'].includes(record.resourceType))) {
      issues.push({ rule: 'unexpected-html-response', severity: 'medium', message: 'API 请求返回 HTML，可能是错误页、登录页或网关兜底页', networkRequestIds: records.filter((record) => /html/i.test(record.contentType ?? '')).map((record) => record.id) });
    }

    endpoints.push({
      method,
      path: matched?.path ?? requestPath,
      requestCount: records.length,
      statusCodes: statuses,
      contentTypes,
      requestShape: shapeOf(firstJsonRequest),
      responseShape: shapeOf(firstJsonResponse),
      schemaMatched: openApi ? Boolean(matched) && issues.length === 0 : undefined,
      issues
    });
  }

  const result: ApiContractResult = {
    enabled: config.contract.enabled,
    schemaPath: config.contract.schemaPath,
    checkedAt: new Date().toISOString(),
    summary: {
      endpointCount: endpoints.length,
      undocumentedCount: endpoints.filter((endpoint) => endpoint.issues.some((issue) => issue.rule === 'undocumented-endpoint')).length,
      statusMismatchCount: endpoints.filter((endpoint) => endpoint.issues.some((issue) => issue.rule === 'undocumented-status-code')).length,
      schemaMismatchCount: endpoints.filter((endpoint) => endpoint.issues.some((issue) => issue.rule === 'unexpected-html-response' || issue.rule === 'server-error-contract')).length,
      inferredCount: openApi ? 0 : endpoints.length
    },
    endpoints: endpoints.sort((a, b) => `${a.method} ${a.path}`.localeCompare(`${b.method} ${b.path}`))
  };
  return { result, issues: [...schemaLoadIssues, ...makeIssues(result, artifacts)] };
}
