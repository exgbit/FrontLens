import type { AnalyzerContext, ConsoleRecord, Issue } from '../types.js';
import { IssueFactory } from './issueFactory.js';
import { truncateMiddle } from '../utils/text.js';
import { isActionableConsoleError } from '../utils/console.js';

function classifyConsoleSeverity(record: ConsoleRecord): 'critical' | 'high' | 'medium' | 'low' {
  const text = record.text.toLowerCase();
  if (/uncaught|unhandled|syntaxerror|referenceerror|typeerror|chunkloaderror|白屏|crash/.test(text)) {
    return 'critical';
  }
  if (record.type === 'error' || /react|vue|angular|promise|failed/.test(text)) {
    return 'high';
  }
  if (record.type === 'warning' || record.type === 'warn') {
    return 'medium';
  }
  return 'low';
}

export function analyzeConsole(context: AnalyzerContext, factory: IssueFactory): {
  issues: Issue[];
  errors: ConsoleRecord[];
  warnings: ConsoleRecord[];
} {
  const errors = context.consoleRecords.filter(isActionableConsoleError);
  const warnings = context.consoleRecords.filter((record) => record.type === 'warning' || record.type === 'warn');
  const issues: Issue[] = [];

  for (const pageError of context.pageErrors) {
    issues.push(
      factory.create({
        title: `页面运行时错误：${truncateMiddle(pageError.message, 100)}`,
        category: 'console-error',
        severity: 'critical',
        confidence: 0.98,
        description: pageError.message,
        evidence: {
          consoleId: pageError.id,
          details: {
            name: pageError.name,
            stack: pageError.stack,
            consoleLog: context.artifacts.consoleLog
          }
        },
        reproduceSteps: ['打开目标页面', '观察浏览器 Console 或报告中的 pageErrors'],
        reason: '页面运行时错误可能中断组件渲染、事件处理或数据更新，是前端可用性的高优先级问题。',
        suggestion: {
          frontend: '根据堆栈定位异常组件或业务逻辑，补充空值保护、错误边界和异常状态测试。',
          test: '增加覆盖该页面首屏渲染和核心交互的 E2E/组件测试。',
          priority: 'P0'
        }
      })
    );
  }

  for (const record of errors.slice(0, 30)) {
    const severity = classifyConsoleSeverity(record);
    issues.push(
      factory.create({
        title: `Console ${record.type}: ${truncateMiddle(record.text, 100)}`,
        category: 'console-error',
        severity,
        confidence: 0.92,
        description: record.text,
        evidence: {
          consoleId: record.id,
          details: {
            location: record.location,
            argsPreview: record.argsPreview
          }
        },
        reproduceSteps: ['打开目标页面', `查看 Console 记录 ${record.id}`],
        reason: 'Console 错误通常表示资源加载、脚本执行、框架运行时或 Promise 处理存在异常。',
        suggestion: {
          frontend: '定位 Console 错误来源，修复异常分支，并避免在生产环境输出未处理错误。',
          backend: /failed|404|500|network/i.test(record.text) ? '如果错误来自接口或静态资源，请检查对应服务、路径、权限和响应头。' : undefined,
          priority: severity === 'critical' ? 'P0' : 'P1'
        }
      })
    );
  }

  for (const record of warnings.slice(0, 20)) {
    issues.push(
      factory.create({
        title: `Console Warning: ${truncateMiddle(record.text, 100)}`,
        category: 'console-error',
        severity: 'low',
        confidence: 0.75,
        description: record.text,
        evidence: {
          consoleId: record.id,
          details: {
            location: record.location
          }
        },
        reproduceSteps: ['打开目标页面', `查看 Console 警告 ${record.id}`],
        reason: '警告可能不会立即阻断页面，但常提示废弃 API、潜在性能问题或不规范用法。',
        suggestion: {
          frontend: '清理生产环境警告，优先处理框架、依赖和可访问性相关警告。',
          priority: 'P3'
        }
      })
    );
  }

  return { issues, errors, warnings };
}
