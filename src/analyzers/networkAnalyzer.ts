import type { AnalyzerContext, Issue, NetworkRecord } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { truncateMiddle } from '../utils/text.js';
import { isViteDevServerRun } from '../utils/devServer.js';

export interface NetworkAnalysisResult {
  issues: Issue[];
  failedRequests: NetworkRecord[];
  slowRequests: NetworkRecord[];
  duplicatedRequests: Array<{
    signature: string;
    count: number;
    requestIds: string[];
    urls: string[];
  }>;
  suspiciousRequests: NetworkRecord[];
}

function normalizeUrlForDuplicate(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.searchParams.sort();
    return `${parsed.origin}${parsed.pathname}?${parsed.searchParams.toString()}`;
  } catch {
    return url;
  }
}

function requestSignature(record: NetworkRecord): string {
  const body = record.postData ? record.postData.slice(0, 500) : '';
  return `${record.method} ${normalizeUrlForDuplicate(record.url)} ${body}`;
}

function isStaticResource(record: NetworkRecord): boolean {
  return ['image', 'stylesheet', 'script', 'font', 'media'].includes(record.resourceType);
}

function isApiLikeRequest(record: NetworkRecord): boolean {
  return ['xhr', 'fetch'].includes(record.resourceType) || record.protocol === 'rest' || record.protocol === 'graphql' || record.protocol === 'sse';
}

function timestampMs(record: NetworkRecord): number {
  const parsed = Date.parse(record.startedAt);
  return Number.isFinite(parsed) ? parsed : 0;
}

function maxBurstCount(records: NetworkRecord[], windowMs = 1500): number {
  const times = records.map(timestampMs).sort((a, b) => a - b);
  let best = 0;
  let left = 0;
  for (let right = 0; right < times.length; right += 1) {
    while (times[right] - times[left] > windowMs) left += 1;
    best = Math.max(best, right - left + 1);
  }
  return best;
}

function isSuccessfulDownload(record: NetworkRecord): boolean {
  const disposition = record.responseHeaders?.['content-disposition'] ?? record.responseHeaders?.['Content-Disposition'] ?? '';
  return Boolean(record.ok && /attachment/i.test(disposition));
}

function isMutatingMethod(method: string): boolean {
  return /^(POST|PUT|PATCH|DELETE)$/i.test(method);
}

function isSafetyBlockedMutation(context: AnalyzerContext, record: NetworkRecord): boolean {
  if (!context.config.safety.blockMutatingRequests || !isMutatingMethod(record.method)) {
    return false;
  }
  return record.failed && /blockedbyclient|blocked|abort|aborted|intercept/i.test(record.failureText ?? '');
}

function hasEmptyParams(record: NetworkRecord): boolean {
  try {
    const url = new URL(record.url);
    for (const [, value] of url.searchParams) {
      if (value === 'null' || value === 'undefined') {
        return true;
      }
    }
  } catch {
    // ignore invalid URLs
  }

  if (!record.postData) {
    return false;
  }
  const trimmed = record.postData.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return /=null|=undefined/i.test(trimmed);
  }
  try {
    const data = JSON.parse(trimmed) as unknown;
    const stack = [data];
    while (stack.length > 0) {
      const current = stack.pop();
      if (current && typeof current === 'object') {
        for (const value of Object.values(current as Record<string, unknown>)) {
            if (value === null || value === undefined || value === 'null' || value === 'undefined') {
            return true;
          }
          if (typeof value === 'object') {
            stack.push(value);
          }
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function analyzeNetwork(context: AnalyzerContext, factory: IssueFactory): NetworkAnalysisResult {
  const { networkRecords, config, artifacts } = context;
  const viteDevServerRun = isViteDevServerRun(networkRecords, config.target.url);
  const deliberateInteractionNetworkIds = new Set(
    [
      ...context.interactionTests
        .filter((test) => test.kind !== 'rapid-click')
        .flatMap((test) => test.observations.networkRequestIds ?? []),
      ...context.journeyTests.flatMap((journey) => journey.steps.flatMap((step) => step.networkRequestIds ?? []))
    ]
  );
  const safetyBlockedRequests = networkRecords.filter((record) => isSafetyBlockedMutation(context, record));
  const failedRequests = networkRecords.filter((record) => (record.failed || (record.status !== undefined && record.status >= 400)) && !isSuccessfulDownload(record) && !isSafetyBlockedMutation(context, record));
  const failedApiRequests = failedRequests.filter(isApiLikeRequest);
  const slowRequests = networkRecords.filter((record) => (record.durationMs ?? 0) >= config.analysis.slowRequestMs);
  const suspiciousRequests = networkRecords.filter((record) => hasEmptyParams(record));
  const duplicateMap = new Map<string, NetworkRecord[]>();

  for (const record of networkRecords.filter((item) => !deliberateInteractionNetworkIds.has(item.id))) {
    const signature = requestSignature(record);
    const group = duplicateMap.get(signature) ?? [];
    group.push(record);
    duplicateMap.set(signature, group);
  }

  const duplicatedRequests = Array.from(duplicateMap.entries())
    .filter(([, group]) => group.length >= 3)
    .map(([signature, group]) => ({
      signature,
      count: group.length,
      requestIds: group.map((record) => record.id),
      urls: [...new Set(group.map((record) => record.url))].slice(0, 5),
      burstCount: maxBurstCount(group)
    }))
    .filter((group) => group.burstCount >= 3)
    .map(({ burstCount: _burstCount, ...group }) => group);

  const issues: Issue[] = [];

  if (safetyBlockedRequests.length > 0) {
    issues.push(
      factory.create({
        title: `安全策略已拦截 ${safetyBlockedRequests.length} 个写操作请求`,
        category: 'security',
        severity: 'info',
        confidence: 0.92,
        description: `当前 safety.blockMutatingRequests=true，FrontLens 已阻断页面运行期间触发的 POST/PUT/PATCH/DELETE 请求，避免真实业务数据被修改。`,
        evidence: {
          details: {
            requestIds: safetyBlockedRequests.map((record) => record.id),
            requests: safetyBlockedRequests.slice(0, 20).map((record) => ({
              id: record.id,
              method: record.method,
              url: record.url,
              failureText: record.failureText
            }))
          }
        },
        reproduceSteps: ['使用默认安全配置运行 FrontLens', '查看 Network 日志中被安全策略拦截的写请求'],
        reason: 'QA 默认模式应避免新增、编辑、删除、提交等真实业务副作用；被拦截的写请求不应被误判为后端接口故障。',
        suggestion: {
          frontend: '确认页面首屏或非破坏性交互是否不应触发写操作；如确认为埋点/心跳，可在配置中关闭阻断或加入规则白名单。',
          backend: '对写接口保持幂等、鉴权和审计；如需完整联调测试，可显式开启对应 allow* 并关闭阻断。',
          priority: 'P3'
        }
      })
    );
  }

  for (const record of failedApiRequests.filter((item) => !isStaticResource(item))) {
    const status = record.status;
    const severity = status === 401 || status === 403 || (status !== undefined && status >= 500) ? 'high' : 'medium';
    const category = status === 401 || status === 403 ? 'backend-api-auth' : 'backend-api-status';
    issues.push(
      factory.create({
        title: `接口异常：${record.method} ${truncateMiddle(record.url, 90)} ${status ?? record.failureText ?? ''}`,
        category,
        severity,
        confidence: 0.96,
        description: `请求 ${record.method} ${record.url} 返回异常状态或加载失败。状态：${status ?? 'N/A'}，错误：${record.failureText ?? record.statusText ?? 'N/A'}。`,
        evidence: {
          networkRequestId: record.id,
          details: {
            status,
            failureText: record.failureText,
            durationMs: record.durationMs,
            networkLog: artifacts.networkLog
          }
        },
        reproduceSteps: ['打开目标页面', `观察 Network 请求 ${record.id}`, `确认接口 ${record.method} ${record.url} 的响应状态`],
        reason:
          status === 401
            ? '接口返回 401，说明登录态失效或鉴权信息缺失，页面可能无法获取业务数据。'
            : status === 403
              ? '接口返回 403，说明当前用户缺少权限，前端需要给出明确权限提示。'
              : status !== undefined && status >= 500
                ? '接口返回 5xx，说明后端服务或网关处理异常，会直接影响页面可用性。'
                : '请求加载失败，可能是网络、跨域、资源路径或服务不可达导致。',
        suggestion: {
          frontend:
            status === 401 || status === 403
              ? '增加统一鉴权错误处理：401 引导登录，403 展示“暂无权限”或联系管理员说明。'
              : '在请求失败时展示错误状态、重试入口和可理解的错误文案，避免页面静默失败。',
          backend:
            status !== undefined && status >= 500
              ? '检查接口服务日志、异常堆栈、网关转发和依赖服务状态，返回稳定错误码与错误信息。'
              : '确认接口路径、鉴权、CORS、参数校验和服务可用性。',
          test: '补充接口异常、鉴权失败和弱网失败场景的前端自动化测试。',
          priority: severity === 'high' ? 'P1' : 'P2'
        }
      })
    );
  }

  for (const record of slowRequests.filter((item) => isApiLikeRequest(item) && !isStaticResource(item)).slice(0, 20)) {
    issues.push(
      factory.create({
        title: `接口耗时过长：${record.method} ${truncateMiddle(record.url, 90)}`,
        category: 'backend-api-performance',
        severity: (record.durationMs ?? 0) >= config.analysis.slowRequestMs * 3 ? 'high' : 'medium',
        confidence: 0.88,
        description: `请求耗时 ${record.durationMs ?? 0}ms，超过阈值 ${config.analysis.slowRequestMs}ms。`,
        evidence: {
          networkRequestId: record.id,
          details: {
            durationMs: record.durationMs,
            thresholdMs: config.analysis.slowRequestMs
          }
        },
        reproduceSteps: ['打开目标页面', `观察 Network 请求 ${record.id} 的 Duration`],
        reason: '慢接口会延长首屏或交互等待时间，如果前端没有 Loading 和超时提示，会造成明显体验问题。',
        suggestion: {
          frontend: '为该请求增加 Loading、超时提示和必要的请求取消逻辑，避免重复触发。',
          backend: '分析接口查询条件、索引、缓存、依赖服务和返回字段体积，优先优化 P95/P99 耗时。',
          priority: 'P2'
        }
      })
    );
  }

  const duplicatedApiRequests = duplicatedRequests.filter((item) => {
    const firstId = item.requestIds[0];
    const record = networkRecords.find((candidate) => candidate.id === firstId);
    return record ? isApiLikeRequest(record) && !isStaticResource(record) : true;
  });

  for (const duplicate of duplicatedApiRequests.slice(0, 10)) {
    issues.push(
      factory.create({
        title: `疑似重复请求：${truncateMiddle(duplicate.signature, 90)}`,
        category: 'backend-api-consistency',
        severity: duplicate.count >= 8 ? 'high' : 'medium',
        confidence: 0.78,
        description: `同一请求签名在本次页面访问中出现 ${duplicate.count} 次。`,
        evidence: {
          details: duplicate
        },
        reproduceSteps: ['打开目标页面', '查看 Network 请求列表', `筛选请求 ID：${duplicate.requestIds.join(', ')}`],
        reason: '重复请求可能来自重复渲染、重复 useEffect/watch、轮询缺少退出条件，或按钮/筛选事件被重复绑定。',
        suggestion: {
          frontend: '检查数据加载触发条件，给请求增加去重、缓存或防抖；确认组件卸载时清理轮询/监听。',
          backend: '如果该接口确实会被高频调用，建议增加缓存、限流和幂等处理。',
          priority: duplicate.count >= 8 ? 'P1' : 'P2'
        }
      })
    );
  }

  if (suspiciousRequests.length > 0) {
    const examples = suspiciousRequests.slice(0, 20);
    issues.push(
      factory.create({
        title: `接口参数疑似为空或异常：${suspiciousRequests.length} 个请求`,
        category: 'backend-api-params',
        severity: suspiciousRequests.some((record) => /undefined|null/i.test(`${record.url} ${record.postData ?? ''}`)) ? 'medium' : 'low',
        confidence: 0.7,
        description: `请求 URL 或请求体中检测到空字符串、null 或 undefined 参数，共 ${suspiciousRequests.length} 个。`,
        evidence: {
          networkRequestId: examples[0]?.id,
          details: {
            requestIds: examples.map((record) => record.id),
            examples: examples.map((record) => ({
              id: record.id,
              method: record.method,
              url: record.url,
              postData: record.postData?.slice(0, 1000)
            }))
          }
        },
        reproduceSteps: ['打开目标页面', '检查 Network 中疑似空参数请求的 QueryString 或 Payload'],
        reason: '空参数可能导致后端默认查询、筛选失效、返回过多数据或出现参数校验错误；如果字段语义允许为空，可在配置或规则中降级。',
        suggestion: {
          frontend: '提交请求前清理空参数，并区分“未选择”和“选择全部”的业务语义。',
          backend: '对关键参数增加类型与必填校验，返回明确错误码和字段级错误信息。',
          priority: 'P3'
        }
      })
    );
  }

  if (networkRecords.length >= 120 && !viteDevServerRun) {
    issues.push(
      factory.create({
        title: `页面请求数量过多：${networkRecords.length} 个请求`,
        category: 'frontend-performance',
        severity: networkRecords.length >= 250 ? 'high' : 'medium',
        confidence: 0.8,
        description: `首次访问页面期间共监听到 ${networkRecords.length} 个请求。`,
        evidence: {
          details: {
            requestCount: networkRecords.length
          }
        },
        reason: '请求数量过多会拖慢首屏、增加失败概率，也会放大弱网环境下的体验问题。',
        suggestion: {
          frontend: '合并首屏必要请求，延迟加载非关键资源，减少重复预取与无效轮询。',
          backend: '对聚合数据提供批量接口或 BFF 聚合接口，减少前端 N+1 请求。',
          priority: networkRecords.length >= 250 ? 'P1' : 'P2'
        }
      })
    );
  }

  return {
    issues,
    failedRequests,
    slowRequests,
    duplicatedRequests,
    suspiciousRequests
  };
}
