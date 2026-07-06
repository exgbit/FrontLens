import type { AnalyzerContext, Issue, NetworkRecord, ResourceRecord } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { truncateMiddle } from '../utils/text.js';
import { isViteDevResource, isViteDevServerRun } from '../utils/devServer.js';

function isStaticResource(record: NetworkRecord): boolean {
  return ['image', 'stylesheet', 'script', 'font'].includes(record.resourceType);
}

function isStaticResourceEntry(resource: ResourceRecord): boolean {
  return ['img', 'image', 'css', 'link', 'script', 'font', 'media', 'audio', 'video'].includes(resource.initiatorType);
}

export function analyzeResources(context: AnalyzerContext, factory: IssueFactory): {
  issues: Issue[];
  failed: NetworkRecord[];
  slow: ResourceRecord[];
  large: ResourceRecord[];
  duplicated: Array<{ url: string; count: number; totalTransferSize?: number }>;
} {
  const failed = context.networkRecords.filter((record) => isStaticResource(record) && (record.failed || (record.status !== undefined && record.status >= 400)));
  const staticEntries = context.resourceRecords.filter((resource) => isStaticResourceEntry(resource));
  const viteDevServerRun = isViteDevServerRun(context.networkRecords, context.config.target.url);
  const issueEntries = viteDevServerRun ? staticEntries.filter((resource) => !isViteDevResource(resource, context.config.target.url)) : staticEntries;
  const slow = issueEntries.filter((resource) => resource.durationMs >= context.config.analysis.slowResourceMs);
  const large = issueEntries.filter((resource) => (resource.transferSize ?? resource.encodedBodySize ?? 0) >= context.config.analysis.largeResourceBytes);
  const duplicateMap = new Map<string, ResourceRecord[]>();

  for (const resource of issueEntries) {
    const list = duplicateMap.get(resource.name) ?? [];
    list.push(resource);
    duplicateMap.set(resource.name, list);
  }

  const duplicated = Array.from(duplicateMap.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([url, list]) => ({
      url,
      count: list.length,
      totalTransferSize: list.reduce((sum, item) => sum + (item.transferSize ?? 0), 0)
    }))
    .sort((a, b) => b.count - a.count);

  const issues: Issue[] = [];

  for (const record of failed.slice(0, 30)) {
    issues.push(
      factory.create({
        title: `静态资源加载失败：${truncateMiddle(record.url, 100)}`,
        category: 'resource-loading',
        severity: record.resourceType === 'script' || record.resourceType === 'stylesheet' ? 'high' : 'medium',
        confidence: 0.95,
        description: `${record.resourceType} 资源加载失败，状态：${record.status ?? 'N/A'}，错误：${record.failureText ?? record.statusText ?? 'N/A'}。`,
        evidence: {
          networkRequestId: record.id,
          resourceUrl: record.url
        },
        reproduceSteps: ['打开目标页面', `查看 Network 静态资源请求 ${record.id}`],
        reason: '关键 JS/CSS 加载失败会导致页面功能或样式异常；图片/字体失败会影响视觉呈现。',
        suggestion: {
          frontend: '检查资源引用路径、构建产物路径、CDN 配置和缓存版本号。',
          backend: '检查静态资源服务、CDN 回源、鉴权规则和 MIME/缓存响应头。',
          priority: record.resourceType === 'script' || record.resourceType === 'stylesheet' ? 'P1' : 'P2'
        }
      })
    );
  }

  for (const resource of slow.slice(0, 20)) {
    issues.push(
      factory.create({
        title: `资源加载过慢：${truncateMiddle(resource.name, 100)}`,
        category: 'resource-performance',
        severity: resource.durationMs >= context.config.analysis.slowResourceMs * 3 ? 'medium' : 'low',
        confidence: 0.82,
        description: `资源加载耗时 ${resource.durationMs}ms，超过阈值 ${context.config.analysis.slowResourceMs}ms。`,
        evidence: {
          resourceUrl: resource.name,
          details: resource
        },
        reproduceSteps: ['打开目标页面', '查看 PerformanceResourceTiming 资源耗时'],
        reason: '慢资源会拖慢首屏和交互可用时间，尤其是阻塞渲染的 CSS、字体和 JS。',
        suggestion: {
          frontend: '压缩资源、开启缓存、拆分非关键 JS、延迟加载图片和非首屏资源。',
          backend: '检查 CDN、缓存头、压缩策略、HTTP/2/3 和静态资源服务性能。',
          priority: 'P3'
        }
      })
    );
  }

  for (const resource of large.slice(0, 20)) {
    const size = resource.transferSize ?? resource.encodedBodySize ?? 0;
    issues.push(
      factory.create({
        title: `资源体积过大：${truncateMiddle(resource.name, 100)}`,
        category: 'resource-performance',
        severity: size >= context.config.analysis.largeResourceBytes * 3 ? 'medium' : 'low',
        confidence: 0.84,
        description: `资源体积约 ${Math.round(size / 1024)}KB，超过阈值 ${Math.round(context.config.analysis.largeResourceBytes / 1024)}KB。`,
        evidence: {
          resourceUrl: resource.name,
          details: resource
        },
        reproduceSteps: ['打开目标页面', '查看资源 transferSize / encodedBodySize'],
        reason: '大体积资源会增加首屏下载时间，移动端和弱网环境影响更明显。',
        suggestion: {
          frontend: '图片使用 WebP/AVIF 和响应式尺寸；JS 做代码分割；CSS 删除未使用样式。',
          backend: '开启 gzip/br 压缩和长缓存，必要时使用 CDN。',
          priority: 'P3'
        }
      })
    );
  }

  for (const duplicate of duplicated.slice(0, 10)) {
    issues.push(
      factory.create({
        title: `重复加载资源：${truncateMiddle(duplicate.url, 100)}`,
        category: 'resource-performance',
        severity: 'low',
        confidence: 0.78,
        description: `同一资源加载 ${duplicate.count} 次。`,
        evidence: {
          resourceUrl: duplicate.url,
          details: duplicate
        },
        reason: '重复加载会浪费带宽，也可能说明缓存头、资源引用或构建注入存在问题。',
        suggestion: {
          frontend: '去重资源引用，检查动态插入 script/link 的逻辑，避免组件重复加载同一资源。',
          backend: '确认静态资源缓存策略和 URL 版本策略稳定。',
          priority: 'P3'
        }
      })
    );
  }

  return { issues, failed, slow, large, duplicated };
}
