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
  const high = issues.filter((issue) => issue.severity === 'critical' || issue.severity === 'high');
  const backend = issues.filter((issue) => issue.category.startsWith('backend') || issue.category.startsWith('integration'));
  const frontend = issues.filter((issue) => issue.category.startsWith('frontend') || issue.category === 'console-error');
  const perf = issues.filter((issue) => issue.category.includes('performance') || issue.category === 'resource-performance');
  const security = issues.filter((issue) => issue.category === 'security');

  const suggestions = [
    high.length > 0 ? `优先处理 ${high.length} 个 Critical/High 问题，避免核心流程不可用或危险操作风险。` : '当前未发现 Critical/High 问题，优先处理体验和稳定性优化。',
    backend.length > 0 ? `接口/前后端联动问题共 ${backend.length} 个，建议先统一错误码、分页/筛选参数和异常反馈。` : '接口层未发现明显高风险问题，可继续关注参数规范和异常反馈。',
    frontend.length > 0 ? `前端 UI/交互/Console 问题共 ${frontend.length} 个，建议按可复现步骤逐项修复。` : '前端基础交互稳定性较好，继续补充回归测试。',
    perf.length > 0 ? `性能/资源问题共 ${perf.length} 个，建议结合截图、resource timing 和 Network 优化首屏。` : '当前性能规则未发现明显高风险项。',
    security.length > 0 ? `安全扫描问题共 ${security.length} 个，建议优先处理安全响应头、Cookie、敏感信息和接口泄露证据。` : '安全扫描未发现明显风险项，继续在 CI 中保持回归。'
  ];

  return {
    summary: `AI Heuristic 综合分析：基于 ${issues.length} 个非 AI 归一化问题，其中高优先级 ${high.length} 个、接口/联动 ${backend.length} 个、前端类 ${frontend.length} 个、性能类 ${perf.length} 个、安全类 ${security.length} 个。`,
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
    issues: [
      normalizeIssueLike({
        id: 'AI-001',
        title: 'AI 综合分析摘要',
        category: 'unknown',
        severity: 'info',
        confidence: 0.7,
        description: heuristic.summary,
        evidence: {
          details: {
            contextPath
          }
        },
        reproduceSteps: ['运行 FrontLens QA', '查看 aiAnalysis 和 ai-context.json'],
        reason: '基于页面结构、问题列表、Network、Console、性能和交互测试结果进行综合归纳。',
        suggestion: {
          frontend: heuristic.suggestions.join(' '),
          test: '修复后重新运行 FrontLens，对比 result.json 中的问题变化。',
          priority: 'P3'
        },
        source: 'ai'
      })
    ]
  };
}
