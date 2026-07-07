import type { AnalyzerContext, Issue, NetworkRecord } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { truncateMiddle } from '../utils/text.js';

function parseJsonPreview(record: NetworkRecord): unknown | undefined {
  if (!record.responseBodyPreview) {
    return undefined;
  }
  const contentType = record.contentType ?? '';
  if (!/json/i.test(contentType) && !/^[\[{]/.test(record.responseBodyPreview.trim())) {
    return undefined;
  }
  try {
    return JSON.parse(record.responseBodyPreview);
  } catch {
    return undefined;
  }
}

interface ListArrayCandidate {
  path: string;
  length: number;
  sampleKeys: string[];
}

const listKeyPattern = /^(data|records|rows|list|items|results|pageData)$/i;
const listUrlPattern = /list|page|search|query|table|records|rows|items|grid|datagrid/i;

function findListArrayCandidates(value: unknown, path = '$', depth = 0, inheritedListKey = false, candidates: ListArrayCandidate[] = []): ListArrayCandidate[] {
  if (depth > 4 || value === null || value === undefined) return candidates;
  if (Array.isArray(value)) {
    const firstObject = value.find((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item));
    const isObjectRows = value.length > 0 && Boolean(firstObject);
    if (inheritedListKey && isObjectRows) {
      candidates.push({
        path,
        length: value.length,
        sampleKeys: Object.keys(firstObject ?? {}).slice(0, 20)
      });
    }
    for (const item of value.slice(0, 3)) {
      findListArrayCandidates(item, `${path}[]`, depth + 1, false, candidates);
    }
    return candidates;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      findListArrayCandidates(item, `${path}.${key}`, depth + 1, listKeyPattern.test(key), candidates);
    }
  }
  return candidates;
}

function isLikelyTelemetryOrHeartbeat(record: NetworkRecord): boolean {
  const url = record.url.toLowerCase();
  const contentType = `${record.requestHeaders['content-type'] ?? ''} ${record.responseHeaders?.['content-type'] ?? ''}`.toLowerCase();
  return (
    /analytics|telemetry|beacon|collect|metrics|sentry|log|track|heartbeat|ping|rum|datadog|newrelic|grafana|prometheus/.test(url) ||
    /text\/plain/.test(contentType) && /beacon|analytics|collect|metrics|log/.test(url)
  );
}

function isSafetyBlockedMutation(context: AnalyzerContext, record: NetworkRecord): boolean {
  if (!context.config.safety.blockMutatingRequests || !/^(POST|PUT|PATCH|DELETE)$/i.test(record.method)) {
    return false;
  }
  return record.failed && /blockedbyclient|blocked|abort|aborted|intercept/i.test(record.failureText ?? '');
}

function isReliableDataTable(table: AnalyzerContext['pageModel']['tables'][number]): boolean {
  const semanticTable = table.tagName === 'table' || table.role === 'table' || table.role === 'grid' || table.role === 'treegrid';
  const className = table.attributes?.class ?? '';
  const uiLibraryTable = /(^|\s|[-_])(data[-_]?grid|ag-grid|table|data-table|el-table|ant-table|n-data-table|v-data-table|MuiDataGrid)(\s|[-_]|$)/i.test(className);
  const structuralEvidence = (table.rowCount ?? 0) > 0 || (table.columnCount ?? 0) > 0 || (table.headers?.length ?? 0) > 0;
  return table.visible && (semanticTable || (uiLibraryTable && structuralEvidence));
}

export function analyzeIntegration(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];
  const bodyText = context.pageModel.stats.bodyTextSample;
  const failedApi = context.networkRecords
    .filter((record) => record.resourceType === 'xhr' || record.resourceType === 'fetch')
    .filter((record) => !isSafetyBlockedMutation(context, record))
    .filter((record) => record.failed || (record.status !== undefined && record.status >= 400));

  if (failedApi.length > 0 && !/失败|错误|异常|重试|无权限|未登录|error|failed|retry|permission|unauthorized/i.test(bodyText)) {
    issues.push(
      factory.create({
        title: '接口异常后页面未发现明显错误反馈',
        category: 'integration-no-feedback',
        severity: 'high',
        confidence: 0.68,
        description: `检测到 ${failedApi.length} 个 XHR/Fetch 异常，但页面可见文本中未发现错误、重试、无权限或未登录等反馈。`,
        evidence: {
          screenshot: context.artifacts.screenshot,
          details: {
            failedApiIds: failedApi.map((record) => record.id),
            bodyTextSample: bodyText.slice(0, 500)
          }
        },
        reproduceSteps: ['打开目标页面', '观察接口异常请求', '检查页面是否出现用户可理解的错误反馈'],
        reason: '接口失败如果没有页面反馈，用户会误以为页面无数据或操作无响应，难以自助恢复。',
        suggestion: {
          frontend: '对接口失败统一展示错误状态、重试入口和必要的权限/登录引导。',
          backend: '返回稳定错误码、业务错误信息和 requestId，方便前端展示与问题追踪。',
          priority: 'P1'
        }
      })
    );
  }

  const tables = context.pageModel.tables.filter(isReliableDataTable);
  if (tables.length > 0) {
    const jsonResponses = context.networkRecords
      .filter((record) => record.resourceType === 'xhr' || record.resourceType === 'fetch')
      .filter((record) => record.status !== undefined && record.status >= 200 && record.status < 300)
      .map((record) => ({ record, data: parseJsonPreview(record) }))
      .filter((item): item is { record: NetworkRecord; data: unknown } => item.data !== undefined);

    const listCandidates = jsonResponses.flatMap((item) =>
      findListArrayCandidates(item.data)
        .filter((candidate) => candidate.length > 0)
        .filter((candidate) => {
          const lastKey = candidate.path.replace(/\[\]$/, '').split('.').pop() ?? '';
          const strongListKey = /^(records|rows|list|items|results|pageData)$/i.test(lastKey);
          const genericDataKey = /^data$/i.test(lastKey);
          return strongListKey || (genericDataKey && listUrlPattern.test(item.record.url));
        })
        .map((candidate) => ({ ...candidate, record: item.record }))
    );
    const maxReturnedArrayLength = Math.max(0, ...listCandidates.map((item) => item.length));
    const maxTableRows = Math.max(0, ...tables.map((table) => table.rowCount ?? 0));

    if (maxReturnedArrayLength > 0 && maxTableRows === 0) {
      const source = listCandidates.find((item) => item.length === maxReturnedArrayLength);
      const sourceRuntimeLink = source && context.sourceRuntimeCorrelation?.status === 'passed'
        ? context.sourceRuntimeCorrelation.links.find((link) => link.networkRequestId === source.record.id)
        : undefined;
      const sourceRuntimeConfidence = context.sourceRuntimeCorrelation?.status === 'passed' ? (sourceRuntimeLink?.confidence ?? 'none') : 'unavailable';
      const shouldSuppressUnboundListMismatch = context.sourceRuntimeCorrelation?.status === 'passed' && (sourceRuntimeConfidence === 'none' || sourceRuntimeConfidence === 'low');
      if (!shouldSuppressUnboundListMismatch) {
        issues.push(
          factory.create({
            title: '接口返回疑似有列表数据，但页面表格为空',
            category: 'integration-data-mismatch',
            severity: 'medium',
            confidence: sourceRuntimeConfidence === 'high' ? 0.72 : 0.66,
            description: `在疑似列表接口响应的 ${source?.path ?? '列表字段'} 中识别到 ${maxReturnedArrayLength} 条对象数组数据，但当前可见表格行数为 0。`,
            evidence: {
              screenshot: context.artifacts.screenshot,
              networkRequestId: source?.record.id,
              details: {
                maxReturnedArrayLength,
                maxTableRows,
                responsePath: source?.path,
                sampleKeys: source?.sampleKeys,
                tableIds: tables.map((table) => table.id),
                sourceRuntimeLinkId: sourceRuntimeLink?.id,
                sourceRuntimeConfidence,
                sourceApiMatches: sourceRuntimeLink?.sourceMatches.map((match) => ({
                  file: match.file,
                  line: match.line,
                  method: match.method,
                  path: match.path,
                  expression: match.expression
                })),
                sourceStateSignals: sourceRuntimeLink?.stateSignals.map((signal) => ({
                  file: signal.file,
                  line: signal.line,
                  kind: signal.kind,
                  text: signal.text
                })),
                sourceComponentIds: sourceRuntimeLink?.componentIds,
                guard: 'Only object arrays under list-like keys (data/records/rows/list/items/results) from XHR/fetch responses are considered. When sourceRuntimeCorrelation is available, unbound runtime responses are suppressed instead of reported.'
              }
            },
            reproduceSteps: ['打开目标页面', '查看列表接口响应', '对比页面表格行数'],
            reason: '该规则需要运行时响应、页面结构和源码 API/状态信号同时支撑；未能绑定到当前前端源码的数据响应会被过滤，避免把无关接口误判为页面空态缺陷。',
            suggestion: {
              frontend: '核对 sourceRuntimeLink 指向的源码 API 调用、状态写入和表格/列表渲染条件，再修复数据绑定、字段映射或空态判断。',
              test: '补充绑定到具体接口、状态字段和 DOM 行数的 E2E 断言，避免仅凭全局 Network 数组推断。',
              priority: 'P2'
            }
          })
        );
      }
    }

    const hasPagination = context.pageModel.components.some((component) => component.type === 'pagination');
    const paginationLikeRequest = context.networkRecords.find((record) => /[?&](page|pageNum|current|pageNo|pageSize|limit)=/i.test(record.url) || /pageSize|pageNum|current|pageNo|limit/i.test(record.postData ?? ''));
    if (hasPagination && !paginationLikeRequest) {
      issues.push(
        factory.create({
          title: '页面存在分页控件，但未发现分页参数请求',
          category: 'integration-pagination-mismatch',
          severity: 'low',
          confidence: 0.56,
          description: '页面识别到分页控件，但 Network 中未发现 page/pageSize/current/limit 等典型分页参数。',
          evidence: {
            screenshot: context.artifacts.screenshot,
            details: {
              paginationComponents: context.pageModel.components.filter((component) => component.type === 'pagination').map((component) => component.id)
            }
          },
          reason: '分页可能是前端本地分页，也可能接口参数命名不规范；若列表数据较大，应确认后端分页是否生效。',
          suggestion: {
            frontend: '确认分页切换会更新请求参数，并在搜索/重置后回到第一页。',
            backend: '列表接口建议统一分页参数命名和响应 total 字段。',
            priority: 'P3'
          }
        })
      );
    }
  }

  const interactionNetworkIds = new Set(context.interactionTests.flatMap((test) => test.observations.networkRequestIds ?? []));
  const successMutations = context.networkRecords.filter(
    (record) =>
      /POST|PUT|PATCH|DELETE/i.test(record.method) &&
      record.status !== undefined &&
      record.status >= 200 &&
      record.status < 300 &&
      !interactionNetworkIds.has(record.id) &&
      !isLikelyTelemetryOrHeartbeat(record)
  );
  if (successMutations.length > 0) {
    for (const record of successMutations.slice(0, 10)) {
      issues.push(
        factory.create({
          title: `页面加载期间发生写操作请求：${record.method} ${truncateMiddle(record.url, 90)}`,
          category: 'security',
          severity: 'medium',
          confidence: 0.66,
          description: '仅访问页面期间监听到成功的 POST/PUT/PATCH/DELETE 请求。',
          evidence: {
            networkRequestId: record.id,
            details: {
              method: record.method,
              url: record.url,
              status: record.status
            }
          },
          reproduceSteps: ['打开目标页面', `查看请求 ${record.id}`, '确认该写操作是否为预期行为'],
          reason: 'QA 工具默认不执行破坏性操作；页面首屏若自动触发写操作，可能存在埋点、状态更新或业务副作用风险。',
          suggestion: {
            frontend: '确认该请求是否仅为埋点/心跳；业务写操作不应在页面加载时自动触发。',
            backend: '对写接口增加幂等、鉴权和审计，避免误调用造成真实业务变更。',
            priority: 'P2'
          }
        })
      );
    }
  }

  return issues;
}
