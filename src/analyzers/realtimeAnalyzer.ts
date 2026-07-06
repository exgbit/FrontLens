import type { AnalyzerContext, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';

export function analyzeRealtime(context: AnalyzerContext, factory: IssueFactory): Issue[] {
  const issues: Issue[] = [];
  for (const operation of context.realtime.graphql.filter((item) => item.hasErrors || (item.status ?? 200) >= 400)) {
    issues.push(factory.create({
      title: `GraphQL 操作异常：${operation.operationName ?? operation.networkRequestId}`,
      category: 'backend-realtime',
      severity: (operation.status ?? 200) >= 500 ? 'high' : 'medium',
      confidence: 0.86,
      description: `GraphQL ${operation.operationType} 操作返回错误或异常状态。`,
      evidence: { networkRequestId: operation.networkRequestId, details: operation },
      reproduceSteps: ['运行 FrontLens QA', `查看 GraphQL 请求 ${operation.networkRequestId}`, '检查 realtime.graphql 中的 errorPreview'],
      reason: 'GraphQL errors 字段或异常状态会导致前端数据不完整、局部渲染失败或错误提示缺失。',
      suggestion: { frontend: '处理 GraphQL errors 并展示局部错误/重试入口。', backend: '修复 resolver 错误，统一 GraphQL error code 和 message。', test: '补充 GraphQL operationName 契约测试。', priority: 'P2' }
    }));
  }
  for (const ws of context.realtime.webSockets.filter((item) => item.errors.length > 0)) {
    issues.push(factory.create({
      title: `WebSocket 连接异常：${ws.url}`,
      category: 'backend-realtime',
      severity: 'medium',
      confidence: 0.8,
      description: `WebSocket 捕获到 ${ws.errors.length} 个 socket error。`,
      evidence: { details: ws },
      reproduceSteps: ['运行 FrontLens QA', '查看 realtime.webSockets 中的 errors 和 frames'],
      reason: 'WebSocket 异常会导致实时数据不同步、订阅丢失或页面状态陈旧。',
      suggestion: { frontend: '增加断线重连、订阅恢复和用户可见状态提示。', backend: '检查 WS 网关、鉴权、心跳和订阅协议。', test: '补充 WS 断线/重连回归。', priority: 'P2' }
    }));
  }
  for (const sse of context.realtime.sse.filter((item) => (item.status ?? 200) >= 400)) {
    issues.push(factory.create({
      title: `SSE 连接异常：${sse.url}`,
      category: 'backend-realtime',
      severity: 'medium',
      confidence: 0.78,
      description: `SSE 请求状态码 ${sse.status}。`,
      evidence: { networkRequestId: sse.networkRequestId, details: sse },
      reproduceSteps: ['运行 FrontLens QA', `查看 SSE 请求 ${sse.networkRequestId}`],
      reason: 'SSE 连接失败会导致实时事件丢失。',
      suggestion: { frontend: '增加 SSE 错误提示和重连策略。', backend: '检查 event-stream 响应头、鉴权和心跳。', test: '补充 SSE 连接回归。', priority: 'P2' }
    }));
  }
  return issues;
}
