import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

export function analyzeExceptions(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  return context.exceptionSimulations
    .filter((item) => item.status === 'failed' || item.status === 'warning')
    .map((item) =>
      factory.create({
        title: `异常场景测试${item.status === 'failed' ? '失败' : '异常'}：${item.kind}`,
        category: item.kind === 'page-refresh' ? 'frontend-routing' : 'integration-no-feedback',
        severity: item.status === 'failed' ? 'high' : 'medium',
        confidence: item.status === 'failed' ? 0.86 : 0.72,
        description: item.issue ?? `${item.kind} 异常模拟状态为 ${item.status}。`,
        evidence: {
          details: {
            exceptionSimulationId: item.id,
            kind: item.kind,
            target: item.target,
            observations: item.observations
          }
        },
        reproduceSteps: ['开启异常模拟运行 FrontLens', `执行异常场景：${item.kind}`, '观察页面反馈、Network 和 Console'],
        reason: item.status === 'failed' ? '异常场景导致运行时错误或刷新失败，说明页面缺少稳健的异常恢复能力。' : '异常场景下页面没有明显反馈，用户难以判断失败原因或恢复方式。',
        suggestion: item.suggestion ?? {
          frontend: '增加异常状态、重试入口、超时处理和统一错误提示。',
          backend: '提供稳定错误码、错误信息和 requestId。',
          test: '补充 500/404/超时/断网/刷新场景测试。',
          priority: item.status === 'failed' ? 'P1' : 'P2'
        }
      })
    );
}
