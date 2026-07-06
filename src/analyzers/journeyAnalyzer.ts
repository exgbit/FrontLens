import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

export function analyzeJourneys(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];
  for (const journey of context.journeyTests.filter((item) => item.status === 'failed' || item.status === 'warning')) {
    const failed = journey.steps.find((step) => step.status === 'failed');
    issues.push(factory.create({
      title: `用户旅程失败：${journey.name}`,
      category: 'integration-journey',
      severity: journey.status === 'failed' ? 'high' : 'medium',
      confidence: journey.status === 'failed' ? 0.9 : 0.72,
      description: journey.issue ?? `用户旅程 ${journey.name} 未通过。`,
      evidence: { details: { journeyId: journey.id, failedStep: failed, finalUrl: journey.finalUrl } },
      reproduceSteps: journey.steps.map((step) => `${step.index + 1}. ${step.action} ${step.target ?? ''} ${step.value ?? ''}`),
      reason: '用户旅程代表核心业务路径，失败说明页面交互、路由或接口联动存在阻断。',
      suggestion: journey.suggestion ?? { frontend: '按失败步骤修复页面交互和状态流。', backend: '检查对应步骤触发的接口和鉴权。', test: '将该旅程纳入 E2E 回归。', priority: 'P1' }
    }));
  }
  return issues;
}
