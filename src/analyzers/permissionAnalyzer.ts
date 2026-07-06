import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

export function analyzePermissions(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  return context.permissionChecks
    .filter((check) => check.rule !== 'api-auth')
    .filter((check) => check.status === 'failed' || (check.status === 'warning' && check.rule !== 'permission-markers'))
    .map((check) =>
      factory.create({
        title: `${check.title}：${check.count} 处`,
        category: 'frontend-permission',
        severity: check.severity,
        confidence: 0.78,
        description: check.description,
        evidence: {
          selector: check.evidence[0]?.selector,
          networkRequestId: check.evidence[0]?.networkRequestId,
          details: {
            permissionCheckId: check.id,
            rule: check.rule,
            evidence: check.evidence
          }
        },
        reproduceSteps: ['打开目标页面', `执行权限规则检查：${check.rule}`, '查看 evidence 中的组件或请求'],
        reason: '权限问题会导致越权、误操作、无权限无反馈或不同角色体验不一致。',
        suggestion: check.suggestion
      })
    );
}
