import type { AnalyzerContext, CoverageEntry, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { truncateMiddle } from '../utils/text.js';

function severityFor(entry: CoverageEntry): Issue['severity'] {
  if (entry.unusedBytes >= 500_000 && entry.unusedPercent >= 80) return 'medium';
  if (entry.unusedBytes >= 200_000 && entry.unusedPercent >= 70) return 'medium';
  return 'low';
}

export function analyzeCoverage(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  if (!context.config.analysis.coverage || context.coverage.status !== 'passed') {
    return [];
  }

  const issues: Issue[] = [];
  const minBytes = context.config.analysis.coverageMinBytes;
  const minPercent = context.config.analysis.coverageUnusedPercent;

  for (const type of ['js', 'css'] as const) {
    const total = context.coverage.totals[type];
    if (total.totalBytes >= minBytes * 3 && total.unusedPercent >= minPercent + 15) {
      issues.push(
        factory.create({
          title: `${type.toUpperCase()} 未使用比例偏高：${total.unusedPercent}%`,
          category: 'frontend-performance',
          severity: total.unusedBytes >= 1_000_000 ? 'medium' : 'low',
          confidence: 0.78,
          description: `Chromium Coverage 统计显示 ${type.toUpperCase()} 总量约 ${Math.round(total.totalBytes / 1024)}KB，未使用约 ${Math.round(total.unusedBytes / 1024)}KB。`,
          evidence: {
            details: {
              type,
              total,
              coverageLog: context.artifacts.coverageLog
            }
          },
          reproduceSteps: ['使用 FrontLens 打开目标页面', '启用 Chromium Coverage', '查看 coverage.json 的 totals 和 topUnused'],
          reason: '首屏加载了大量当前页面未执行或未命中的 JS/CSS，通常来自路由未拆分、功能模块静态引入、整包工具库、样式未按需加载或首屏加载了非当前模块资源。',
          suggestion: {
            frontend: '优先按路由/组件拆包，减少全量工具库和非当前页面功能的静态引入；CSS 优先确认按需加载配置，只有确认动态类名安全后才做裁剪。',
            test: '在 CI 中跟踪 coverage.totals 与 topUnused，避免新依赖显著增加未使用体积。',
            priority: 'P3'
          }
        })
      );
    }
  }

  const offenders = context.coverage.topUnused.filter((entry) => entry.unusedBytes >= minBytes && entry.unusedPercent >= minPercent).slice(0, 10);
  for (const entry of offenders) {
    issues.push(
      factory.create({
        title: `未使用${entry.type.toUpperCase()}资源偏多：${truncateMiddle(entry.url, 100)}`,
        category: 'resource-performance',
        severity: severityFor(entry),
        confidence: entry.source === 'network' ? 0.82 : 0.72,
        description: `该资源总量约 ${Math.round(entry.totalBytes / 1024)}KB，未使用约 ${Math.round(entry.unusedBytes / 1024)}KB（${entry.unusedPercent}%）。`,
        evidence: {
          resourceUrl: entry.url,
          details: {
            coverageEntry: entry,
            coverageLog: context.artifacts.coverageLog
          }
        },
        reproduceSteps: ['打开目标页面', '查看 coverage.json 的 topUnused', `定位资源 ${entry.id}`],
        reason: entry.type === 'js' ? 'JS 未使用比例高会增加下载、解析和编译成本，并可能放大主线程压力。' : 'CSS 未使用比例高会增加下载和样式计算成本，也可能说明样式构建未做按需裁剪。',
        suggestion: {
          frontend: entry.type === 'js' ? '对该脚本做代码分割、按需导入、Tree Shaking 或延迟加载。' : '先验证组件库/主题样式是否已按需加载，再谨慎拆分主题样式或裁剪确认不会误删的静态类名。',
          backend: entry.source === 'network' ? '确保静态资源开启 gzip/br、长缓存与 CDN，避免重复传输未使用大资源。' : undefined,
          priority: 'P3'
        }
      })
    );
  }

  return issues;
}
