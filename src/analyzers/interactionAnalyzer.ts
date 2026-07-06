import type { AnalyzerContext, InteractionTestResult, Issue, IssueCategory, Severity } from '../types.js';
import { IssueFactory } from './issueFactory.js';

function categoryFor(test: InteractionTestResult): IssueCategory {
  switch (test.kind) {
    case 'search':
      return 'integration-filter-mismatch';
    case 'reset':
      return 'frontend-form';
    case 'pagination':
      return 'integration-pagination-mismatch';
    case 'dialog':
      return 'frontend-interaction';
    case 'tab':
      return 'frontend-interaction';
    case 'table-sort':
      return 'frontend-table';
    case 'table-selection':
      return 'frontend-table';
    case 'refresh':
      return 'frontend-interaction';
    case 'download':
      return 'frontend-interaction';
    case 'rapid-click':
      return 'frontend-interaction';
    case 'upload':
      return 'frontend-interaction';
    case 'form-validation':
      return 'frontend-form';
  }
}

function severityFor(test: InteractionTestResult): Severity {
  if (test.status === 'failed') {
    if ((test.observations.consoleIds?.length ?? 0) > 0 || (test.observations.pageErrorIds?.length ?? 0) > 0) {
      return 'high';
    }
    return test.kind === 'search' || test.kind === 'pagination' || test.kind === 'table-sort' || test.kind === 'rapid-click' || test.kind === 'form-validation' ? 'medium' : 'low';
  }
  if (test.status === 'warning') {
    return 'low';
  }
  return 'info';
}

export function analyzeInteractions(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  return context.interactionTests
    .filter((test) => test.status === 'failed' || test.status === 'warning')
    .map((test) =>
      factory.create({
        title: `安全交互测试${test.status === 'failed' ? '失败' : '异常'}：${test.kind} / ${test.target}`,
        category: categoryFor(test),
        severity: severityFor(test),
        confidence: test.status === 'failed' ? 0.82 : 0.58,
        description: test.issue ?? `${test.kind} 交互测试状态为 ${test.status}。`,
        evidence: {
          selector: test.selector,
          details: {
            interactionTestId: test.id,
            kind: test.kind,
            status: test.status,
            actions: test.actions,
            observations: test.observations
          }
        },
        reproduceSteps: test.actions.length > 0 ? test.actions : ['打开目标页面', `执行 ${test.kind} 安全交互测试`],
        reason:
          test.status === 'failed'
            ? '真实点击/输入过程中出现失败或错误，说明该交互路径存在可复现的稳定性或逻辑问题。'
            : '交互执行后未观察到预期的请求、页面状态或 URL 变化，可能是按钮无效、状态反馈不足，或页面只有本地逻辑。',
        suggestion: test.suggestion ?? {
          frontend: '检查该交互的事件绑定、状态更新、Loading/错误反馈，以及是否需要禁用不可用操作。',
          test: '补充该交互路径的 E2E 测试断言。',
          priority: test.status === 'failed' ? 'P2' : 'P3'
        }
      })
    );
}
