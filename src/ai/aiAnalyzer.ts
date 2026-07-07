import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { AiAnalysisResult, AnalyzerContext, Issue } from '../types.js';
import { writeJson, writeText } from '../utils/fs.js';
import { normalizeIssueLike } from '../resultNormalizer.js';
import { redactUrl } from '../utils/redact.js';

const execFileAsync = promisify(execFile);

function trimJsonContext(value: unknown, maxBytes: number): unknown {
  const json = JSON.stringify(value);
  if (Buffer.byteLength(json, 'utf8') <= maxBytes) {
    return value;
  }
  return {
    truncated: true,
    maxBytes,
    preview: json.slice(0, maxBytes)
  };
}

function heuristicSummary(issues: Issue[]): { summary: string; suggestions: string[] } {
  const actionable = issues.filter((issue) => issue.severity !== 'info' && issue.confidence >= 0.6);
  const referenceOnly = issues.length - actionable.length;
  const high = actionable.filter((issue) => issue.severity === 'critical' || issue.severity === 'high');
  const backend = actionable.filter((issue) => issue.category.startsWith('backend') || issue.category.startsWith('integration'));
  const frontend = actionable.filter((issue) => issue.category.startsWith('frontend') || issue.category === 'console-error');
  const perf = actionable.filter((issue) => issue.category.includes('performance') || issue.category === 'resource-performance');
  const security = actionable.filter((issue) => issue.category === 'security');

  const suggestions = [
    high.length > 0 ? `优先处理 ${high.length} 个 Critical/High 可执行问题；逐项以截图、Network、Console 或源码证据复核。` : '当前未发现 Critical/High 可执行问题；不要把参考观察项当成必须修改。',
    backend.length > 0 ? `接口/前后端联动可执行问题共 ${backend.length} 个；仅在证据能绑定具体接口与 UI 状态时下结论。` : '接口层未发现已确认的高风险联动问题；疑似数据不一致需继续用源码或 E2E 复核。',
    frontend.length > 0 ? `前端 UI/交互/Console 可执行问题共 ${frontend.length} 个；优先修复运行时错误、可访问性硬性问题和阻塞流程。` : '前端基础交互未发现已确认阻塞项；样式/层级类观察默认归为产品决策。',
    perf.length > 0 ? `性能/资源可执行问题共 ${perf.length} 个；结合构建产物、Coverage 和 Network 判断是否是当前页面真实成本。` : '当前性能规则未发现明显高风险项。',
    security.length > 0 ? `安全扫描可执行问题共 ${security.length} 个；区分前端代码、部署响应头和测试环境噪音。` : '安全扫描未发现已确认的应用层高风险项。',
    referenceOnly > 0 ? `${referenceOnly} 个信息/低置信项仅作参考，不进入修复任务。` : '无额外参考观察项。'
  ];

  return {
    summary: `AI Heuristic 综合分析：基于 ${actionable.length} 个可执行问题和 ${referenceOnly} 个参考观察项；高优先级 ${high.length} 个、接口/联动 ${backend.length} 个、前端类 ${frontend.length} 个、性能类 ${perf.length} 个、安全类 ${security.length} 个。`,
    suggestions
  };
}

function parseCommandOutput(stdout: string): { summary?: string; suggestions?: string[]; issues?: Issue[] } {
  const parsed = JSON.parse(stdout) as unknown;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('AI command output must be a JSON object.');
  }
  const obj = parsed as { summary?: unknown; suggestions?: unknown; issues?: unknown };
  return {
    summary: typeof obj.summary === 'string' ? obj.summary : undefined,
    suggestions: Array.isArray(obj.suggestions) ? obj.suggestions.filter((item): item is string => typeof item === 'string') : undefined,
    issues: Array.isArray(obj.issues) ? (obj.issues as Issue[]) : undefined
  };
}

export async function runAiAnalyzer(context: AnalyzerContext, issues: Issue[]): Promise<AiAnalysisResult> {
  const provider = context.config.ai.provider;
  if (!context.config.analysis.ai) {
    return {
      enabled: false,
      provider,
      status: 'skipped',
      suggestions: [],
      issues: []
    };
  }

  const aiContext = trimJsonContext(
    {
      summary: {
        url: redactUrl(context.config.target.url),
        title: context.pageModel.title,
        issueCount: issues.length
      },
      pageModel: context.pageModel,
      issues,
      network: context.networkRecords.slice(0, 80),
      console: context.consoleRecords.slice(0, 80),
      performance: context.performanceMetrics,
      apiContract: context.apiContract,
      realtime: context.realtime,
      interactionTests: context.interactionTests,
      journeyTests: context.journeyTests,
      accessibilityChecks: context.accessibilityChecks,
      responsiveChecks: context.responsiveChecks,
      exceptionSimulations: context.exceptionSimulations,
      security: context.security,
      p2: context.p2,
      artifacts: context.artifacts
    },
    context.config.ai.maxContextBytes
  );

  const contextPath = path.join(context.artifacts.outputDir, 'ai-context.json');
  await writeJson(contextPath, aiContext);

  if (provider === 'command') {
    if (!context.config.ai.command) {
      return {
        enabled: true,
        provider,
        status: 'failed',
        contextPath,
        suggestions: [],
        issues: [],
        error: 'ai.provider=command requires ai.command.'
      };
    }

    try {
      const { stdout, stderr } = await execFileAsync(context.config.ai.command, [contextPath], {
        cwd: process.cwd(),
        timeout: 120_000,
        maxBuffer: 5 * 1024 * 1024
      });
      const rawOutputPath = path.join(context.artifacts.outputDir, 'ai-output.json');
      await writeText(rawOutputPath, stdout);
      const parsed = parseCommandOutput(stdout);
      return {
        enabled: true,
        provider,
        status: 'passed',
        contextPath,
        rawOutputPath,
        summary: parsed.summary,
        suggestions: parsed.suggestions ?? [],
        issues: (parsed.issues ?? []).map((issue, index) => normalizeIssueLike({ ...issue, source: 'ai' }, index)),
        error: stderr || undefined
      };
    } catch (error: unknown) {
      return {
        enabled: true,
        provider,
        status: 'failed',
        contextPath,
        suggestions: [],
        issues: [],
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  const heuristic = heuristicSummary(issues);
  return {
    enabled: true,
    provider: 'heuristic',
    status: 'passed',
    contextPath,
    summary: heuristic.summary,
    suggestions: heuristic.suggestions,
    issues: []
  };
}
