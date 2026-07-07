import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

export function analyzeExceptions(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  return context.exceptionSimulations
    .filter((item) => item.status === 'failed' || item.status === 'warning')
    .map((item) => {
      const category = item.kind === 'page-refresh' ? 'frontend-routing' : 'integration-no-feedback';
      const observations = item.observations as {
        networkRequestIds?: string[];
        consoleIds?: string[];
        pageErrorIds?: string[];
      };
      return factory.create({
        title: `异常场景测试${item.status === 'failed' ? '失败' : '异常'}：${item.kind}`,
        category,
        severity: item.status === 'failed' ? 'high' : 'medium',
        confidence: item.status === 'failed' ? 0.86 : 0.72,
        description: item.issue ?? `${item.kind} 异常模拟状态为 ${item.status}。`,
        evidence: {
          networkRequestId: observations.networkRequestIds?.[0],
          consoleId: observations.consoleIds?.[0],
          pageErrorIds: observations.pageErrorIds,
          details: {
            exceptionSimulationId: item.id,
            kind: item.kind,
            target: item.target,
            observations: item.observations
          }
        },
        reproduceSteps: ['开启异常模拟运行 FrontLens', `执行异常场景：${item.kind}`, '观察页面反馈、Network 和 Console'],
        reason:
          category === 'frontend-routing'
            ? '异常场景导致运行时错误或刷新失败，说明页面缺少稳健的异常恢复能力。'
            : '接口异常/超时模拟后页面没有可理解的错误反馈或重试入口，用户难以区分失败、空数据和权限状态。',
        suggestion: item.suggestion ?? {
          frontend: '增加异常状态、重试入口、超时处理和统一错误提示。',
          backend: '提供稳定错误码、错误信息和 requestId。',
          test: '补充 500/404/超时/断网/刷新场景测试。',
          priority: item.status === 'failed' ? 'P1' : 'P2'
        }
      });
    });
}
