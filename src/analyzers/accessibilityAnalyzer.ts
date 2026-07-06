import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

export function analyzeAccessibility(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  if (!context.config.analysis.accessibility) {
    return [];
  }

  return context.accessibilityChecks
    .filter((check) => check.status === 'failed')
    .map((check) =>
      factory.create({
        title: `${check.title}：${check.count} 处`,
        category: 'frontend-accessibility',
        severity: check.severity,
        confidence: 0.86,
        description: check.description,
        evidence: {
          selector: check.nodes[0]?.selector,
          details: {
            accessibilityCheckId: check.id,
            rule: check.rule,
            count: check.count,
            nodes: check.nodes
          }
        },
        reproduceSteps: ['打开目标页面', `执行可访问性规则检查：${check.rule}`, '定位 evidence.nodes 中的 selector'],
        reason: '可访问性问题会影响键盘、读屏、低视力和移动端用户，也会降低自动化测试稳定性。',
        suggestion: check.suggestion
      })
    );
}
