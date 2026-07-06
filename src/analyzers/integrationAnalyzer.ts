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

function findArrayLengths(value: unknown, lengths: number[] = [], depth = 0): number[] {
  if (depth > 4 || value === null || value === undefined) {
    return lengths;
  }
  if (Array.isArray(value)) {
    lengths.push(value.length);
    for (const item of value.slice(0, 3)) {
      findArrayLengths(item, lengths, depth + 1);
    }
    return lengths;
  }
  if (typeof value === 'object') {
    for (const item of Object.values(value as Record<string, unknown>)) {
      findArrayLengths(item, lengths, depth + 1);
    }
  }
  return lengths;
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
  return table.tagName === 'table' || table.role === 'grid' || (table.rowCount ?? 0) > 0 || (table.headers?.length ?? 0) > 0 || table.confidence >= 0.8;
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
      .filter((record) => record.status !== undefined && record.status >= 200 && record.status < 300)
      .map((record) => ({ record, data: parseJsonPreview(record) }))
      .filter((item): item is { record: NetworkRecord; data: unknown } => item.data !== undefined);

    const maxReturnedArrayLength = Math.max(0, ...jsonResponses.flatMap((item) => findArrayLengths(item.data)));
    const maxTableRows = Math.max(0, ...tables.map((table) => table.rowCount ?? 0));

    if (maxReturnedArrayLength > 0 && maxTableRows === 0) {
      const source = jsonResponses.find((item) => findArrayLengths(item.data).some((length) => length === maxReturnedArrayLength));
      issues.push(
        factory.create({
          title: '接口返回疑似有列表数据，但页面表格为空',
          category: 'integration-data-mismatch',
          severity: 'medium',
          confidence: 0.58,
          description: `接口响应中识别到数组数据最大长度 ${maxReturnedArrayLength}，但页面表格行数为 0。`,
          evidence: {
            screenshot: context.artifacts.screenshot,
            networkRequestId: source?.record.id,
            details: {
              maxReturnedArrayLength,
              maxTableRows,
              tableIds: tables.map((table) => table.id)
            }
          },
          reproduceSteps: ['打开目标页面', '查看列表接口响应', '对比页面表格行数'],
          reason: '这可能表示字段映射、状态更新、接口选择或表格渲染条件存在问题；也可能是接口并非当前表格数据源。',
          suggestion: {
            frontend: '确认列表接口与表格数据源绑定关系，检查 setState/store 更新和字段映射逻辑。',
            backend: '统一列表响应结构，例如 { records, total, page, pageSize }，减少前端推断成本。',
            test: '补充“接口返回有数据时表格展示行数与字段正确”的自动化断言。',
            priority: 'P2'
          }
        })
      );
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
