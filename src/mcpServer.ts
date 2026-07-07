import { readFile } from 'node:fs/promises';
import { stdin, stdout } from 'node:process';
import { runQa } from './runner.js';
import { runCompatibility } from './matrix.js';
import type { BrowserName, Issue, QaResult, QaRunInput, Severity } from './types.js';
import { normalizeResult } from './resultNormalizer.js';
import { createResultDiff, writeResultDiff } from './diff/resultDiff.js';

interface JsonRpcRequest {
  jsonrpc?: '2.0';
  id?: string | number | null;
  method?: string;
  params?: unknown;
}

interface ToolCallParams {
  name?: string;
  arguments?: Record<string, unknown>;
}

class RpcError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown
  ) {
    super(message);
  }
}

const VERSION = '0.1.0';
const PROTOCOL_VERSION = '2025-03-26';
const SUPPORTED_PROTOCOL_VERSIONS = new Set([PROTOCOL_VERSION]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeBrowser(value: unknown): BrowserName | undefined {
  if (value === 'chromium' || value === 'firefox' || value === 'webkit') return value;
  if (value === undefined || value === null || value === '') return undefined;
  throw new RpcError(-32602, `Unsupported browser: ${String(value)}`, { expected: ['chromium', 'firefox', 'webkit'] });
}

function normalizeSeverity(value: unknown): Severity | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === 'critical' || value === 'high' || value === 'medium' || value === 'low' || value === 'info') return value;
  throw new RpcError(-32602, `Unsupported severity: ${String(value)}`, { expected: ['critical', 'high', 'medium', 'low', 'info'] });
}

function severityRank(severity: Severity): number {
  return { critical: 0, high: 1, medium: 2, low: 3, info: 4 }[severity];
}

async function readResult(reportPath: string): Promise<QaResult> {
  return normalizeResult(JSON.parse(await readFile(reportPath, 'utf8')));
}

function textContent(data: unknown, isError = false): { content: Array<{ type: 'text'; text: string }>; isError?: boolean } {
  return {
    isError: isError || undefined,
    content: [
      {
        type: 'text',
        text: typeof data === 'string' ? data : JSON.stringify(data, null, 2)
      }
    ]
  };
}

function schema(properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false
  };
}

function listTools(): Record<string, unknown> {
  return {
    tools: [
      {
        name: 'frontlens_qa',
        description: 'Run FrontLens Playwright QA for a target URL and return report artifact paths plus summary.',
        inputSchema: schema(
          {
            url: { type: 'string', description: 'Target page URL.' },
            outputDir: { type: 'string', description: 'Output directory for report artifacts.' },
            output: { type: 'string', description: 'Alias for outputDir.' },
            configPath: { type: 'string', description: 'Optional FrontLens config JSON/JS path.' },
            config: { type: 'string', description: 'Alias for configPath.' },
            browser: { type: 'string', enum: ['chromium', 'firefox', 'webkit'] },
            headless: { type: 'boolean' },
            storageState: { type: 'string' },
            sessionStorageState: { type: 'string' },
            trace: { type: 'boolean' },
            video: { type: 'boolean' },
            screenshot: { type: 'boolean' },
            simulateExceptions: { type: 'boolean', description: 'Enable or disable exception simulations. Default: enabled.' },
            ai: { type: 'boolean', description: 'Enable or disable heuristic AI analysis. Default: enabled.' },
            coverage: { type: 'boolean' },
            security: { type: 'boolean', description: 'Enable or disable security scan for this run.' },
            journeys: { type: 'boolean', description: 'Enable or disable user journey tests. Default: enabled with a safe smoke journey.' },
            contract: { type: 'boolean' },
            realtime: { type: 'boolean' },
            p2: { type: 'boolean', description: 'Enable or disable P2 visual/budget/network checks. Default: enabled.' },
            blockMutatingRequests: { type: 'boolean' }
          },
          ['url']
        )
      },
      {
        name: 'frontlens_inspect',
        description: 'Read an existing FrontLens result.json and return summary/artifact metadata.',
        inputSchema: schema({ report: { type: 'string' } }, ['report'])
      },
      {
        name: 'frontlens_issues',
        description: 'Read result.json and return issues, optionally filtered up to a severity threshold. Severity high returns critical + high.',
        inputSchema: schema({ report: { type: 'string' }, severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] }, full: { type: 'boolean' } }, ['report'])
      },
      {
        name: 'frontlens_network',
        description: 'Read result.json and return failed, slow, duplicated, and suspicious API/network requests.',
        inputSchema: schema({ report: { type: 'string' } }, ['report'])
      },
      {
        name: 'frontlens_coverage',
        description: 'Read result.json and return Chromium Coverage totals and top unused JS/CSS resources.',
        inputSchema: schema({ report: { type: 'string' } }, ['report'])
      },
      {
        name: 'frontlens_security',
        description: 'Read result.json and return security scan score, checks, and security issue suggestions.',
        inputSchema: schema({ report: { type: 'string' } }, ['report'])
      },
      {
        name: 'frontlens_fix_tasks',
        description: 'Read result.json and return machine-executable fix tasks for downstream frontend/backend/security skills.',
        inputSchema: schema({ report: { type: 'string' } }, ['report'])
      },
      {
        name: 'frontlens_diff',
        description: 'Compare two FrontLens result.json files by stable fingerprints and return added/resolved/persistent issues.',
        inputSchema: schema({ before: { type: 'string' }, after: { type: 'string' }, outputDir: { type: 'string' } }, ['before', 'after'])
      },
      {
        name: 'frontlens_suggestions',
        description: 'Read result.json and return frontend/backend/product/test fix suggestions.',
        inputSchema: schema({ report: { type: 'string' } }, ['report'])
      },
      {
        name: 'frontlens_matrix',
        description: 'Run FrontLens browser compatibility matrix for a URL.',
        inputSchema: schema(
          {
            url: { type: 'string' },
            outputDir: { type: 'string' },
            output: { type: 'string' },
            configPath: { type: 'string' },
            config: { type: 'string' },
            browsers: { type: 'string', description: 'Comma-separated browser list.' },
            headless: { type: 'boolean' },
            storageState: { type: 'string' },
            sessionStorageState: { type: 'string' },
            trace: { type: 'boolean' },
            video: { type: 'boolean' },
            screenshot: { type: 'boolean' },
            simulateExceptions: { type: 'boolean', description: 'Enable or disable exception simulations. Default: enabled.' },
            ai: { type: 'boolean', description: 'Enable or disable heuristic AI analysis. Default: enabled.' },
            coverage: { type: 'boolean' },
            security: { type: 'boolean', description: 'Enable or disable security scan for each browser run.' },
            journeys: { type: 'boolean', description: 'Enable or disable user journey tests. Default: enabled with a safe smoke journey.' },
            contract: { type: 'boolean' },
            realtime: { type: 'boolean' },
            p2: { type: 'boolean', description: 'Enable or disable P2 visual/budget/network checks. Default: enabled.' },
            blockMutatingRequests: { type: 'boolean' }
          },
          ['url']
        )
      }
    ]
  };
}

function validateArgs(args: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  if (!isRecord(args)) {
    throw new RpcError(-32602, 'Tool arguments must be an object.');
  }
  const unknown = Object.keys(args).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new RpcError(-32602, `Unknown argument(s): ${unknown.join(', ')}`, { allowed });
  }
  const missing = required.filter((key) => typeof args[key] !== 'string' || String(args[key]).trim() === '');
  if (missing.length > 0) {
    throw new RpcError(-32602, `Missing required argument(s): ${missing.join(', ')}`);
  }
  return args;
}

function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new RpcError(-32602, `Missing required argument: ${key}`);
  }
  return value;
}

async function callTool(params: ToolCallParams): Promise<Record<string, unknown>> {
  switch (params.name) {
    case 'frontlens_qa': {
      const args = validateArgs(params.arguments ?? {}, ['url', 'outputDir', 'output', 'configPath', 'config', 'browser', 'headless', 'storageState', 'sessionStorageState', 'trace', 'video', 'screenshot', 'simulateExceptions', 'ai', 'coverage', 'security', 'journeys', 'contract', 'realtime', 'p2', 'blockMutatingRequests'], ['url']);
      const url = requireString(args, 'url');
      const input: QaRunInput = {
        url,
        outputDir: typeof args.outputDir === 'string' ? args.outputDir : typeof args.output === 'string' ? args.output : undefined,
        configPath: typeof args.configPath === 'string' ? args.configPath : typeof args.config === 'string' ? args.config : undefined,
        browser: normalizeBrowser(args.browser),
        headless: typeof args.headless === 'boolean' ? args.headless : undefined,
        storageState: typeof args.storageState === 'string' ? args.storageState : undefined,
        sessionStorageState: typeof args.sessionStorageState === 'string' ? args.sessionStorageState : undefined,
        trace: typeof args.trace === 'boolean' ? args.trace : undefined,
        video: typeof args.video === 'boolean' ? args.video : undefined,
        screenshot: typeof args.screenshot === 'boolean' ? args.screenshot : undefined,
        simulateExceptions: typeof args.simulateExceptions === 'boolean' ? args.simulateExceptions : undefined,
        ai: typeof args.ai === 'boolean' ? args.ai : undefined,
        coverage: typeof args.coverage === 'boolean' ? args.coverage : undefined,
        security: typeof args.security === 'boolean' ? args.security : undefined,
        journeys: typeof args.journeys === 'boolean' ? args.journeys : undefined,
        contract: typeof args.contract === 'boolean' ? args.contract : undefined,
        realtime: typeof args.realtime === 'boolean' ? args.realtime : undefined,
        p2: typeof args.p2 === 'boolean' ? args.p2 : undefined,
        blockMutatingRequests: typeof args.blockMutatingRequests === 'boolean' ? args.blockMutatingRequests : undefined
      };
      const result = await runQa(input);
      return textContent({
        summary: result.summary,
        artifacts: result.artifacts,
        issueCount: result.issues.length,
        highPriorityIssues: result.issues
          .filter((issue) => issue.severity === 'critical' || issue.severity === 'high')
          .map((issue) => ({ id: issue.id, severity: issue.severity, category: issue.category, title: issue.title, suggestion: issue.suggestion, evidence: issue.evidence })),
        coverage: {
          status: result.coverage?.status ?? 'missing',
          totals: result.coverage?.totals
        },
        security: {
          status: result.security.status,
          score: result.security.score,
          summary: result.security.summary
        },
        apiContract: result.apiContract.summary,
        realtime: result.realtime.summary,
        fixTaskCount: result.fixTasks.length,
        qualityGate: result.qualityGate
      });
    }
    case 'frontlens_inspect': {
      const args = validateArgs(params.arguments ?? {}, ['report'], ['report']);
      const result = await readResult(requireString(args, 'report'));
      return textContent({
        summary: result.summary,
        artifacts: result.artifacts,
        metadata: {
          version: result.metadata.version,
          schemaVersion: result.metadata.schemaVersion,
          durationMs: result.metadata.durationMs,
          phaseErrors: result.metadata.phaseErrors
        },
        issueBreakdown: {
          critical: result.summary.criticalCount,
          high: result.summary.highCount,
          medium: result.summary.mediumCount,
          low: result.summary.lowCount,
          info: result.summary.infoCount
        },
        security: {
          status: result.security.status,
          score: result.security.score,
          summary: result.security.summary
        },
        qualityGate: result.qualityGate
      });
    }
    case 'frontlens_issues': {
      const args = validateArgs(params.arguments ?? {}, ['report', 'severity', 'full'], ['report']);
      const severity = normalizeSeverity(args.severity);
      const result = await readResult(requireString(args, 'report'));
      const issues = result.issues
        .filter((issue) => (severity ? severityRank(issue.severity) <= severityRank(severity) : true))
        .map((issue) =>
          args.full === true
            ? issue
            : {
                id: issue.id,
                fingerprint: issue.fingerprint,
                severity: issue.severity,
                category: issue.category,
                title: issue.title,
                confidence: issue.confidence,
                priority: issue.suggestion.priority,
                frontend: issue.suggestion.frontend,
                backend: issue.suggestion.backend,
                product: issue.suggestion.product,
                test: issue.suggestion.test,
                reproduceSteps: issue.reproduceSteps,
                evidence: issue.evidence
              }
        );
      return textContent(issues);
    }
    case 'frontlens_network': {
      const args = validateArgs(params.arguments ?? {}, ['report'], ['report']);
      const result = await readResult(requireString(args, 'report'));
      return textContent({
        requests: result.network.requests,
        failedRequests: result.network.failedRequests,
        slowRequests: result.network.slowRequests,
        duplicatedRequests: result.network.duplicatedRequests,
        suspiciousRequests: result.network.suspiciousRequests
      });
    }
    case 'frontlens_coverage': {
      const args = validateArgs(params.arguments ?? {}, ['report'], ['report']);
      const result = await readResult(requireString(args, 'report'));
      return textContent({
        status: result.coverage?.status ?? 'missing',
        message: result.coverage?.message,
        totals: result.coverage?.totals,
        topUnused: result.coverage?.topUnused ?? []
      });
    }
    case 'frontlens_security': {
      const args = validateArgs(params.arguments ?? {}, ['report'], ['report']);
      const result = await readResult(requireString(args, 'report'));
      return textContent({
        security: result.security,
        securityIssues: result.issues.filter((issue) => issue.category === 'security')
      });
    }
    case 'frontlens_fix_tasks': {
      const args = validateArgs(params.arguments ?? {}, ['report'], ['report']);
      const result = await readResult(requireString(args, 'report'));
      return textContent(result.fixTasks);
    }
    case 'frontlens_diff': {
      const args = validateArgs(params.arguments ?? {}, ['before', 'after', 'outputDir'], ['before', 'after']);
      const diff = createResultDiff(await readResult(requireString(args, 'before')), await readResult(requireString(args, 'after')));
      const artifacts = typeof args.outputDir === 'string' ? await writeResultDiff(diff, args.outputDir) : undefined;
      return textContent({ ...diff, artifacts });
    }
    case 'frontlens_suggestions': {
      const args = validateArgs(params.arguments ?? {}, ['report'], ['report']);
      const result = await readResult(requireString(args, 'report'));
      const suggestions = result.issues
        .filter((issue: Issue) => issue.suggestion.frontend || issue.suggestion.backend || issue.suggestion.test || issue.suggestion.product)
        .map((issue) => ({
          id: issue.id,
          title: issue.title,
          severity: issue.severity,
          category: issue.category,
          suggestion: issue.suggestion
        }));
      return textContent(suggestions);
    }
    case 'frontlens_matrix': {
      const args = validateArgs(params.arguments ?? {}, ['url', 'outputDir', 'output', 'configPath', 'config', 'browsers', 'headless', 'storageState', 'sessionStorageState', 'trace', 'video', 'screenshot', 'simulateExceptions', 'ai', 'coverage', 'security', 'journeys', 'contract', 'realtime', 'p2', 'blockMutatingRequests'], ['url']);
      const browsers = (typeof args.browsers === 'string' ? args.browsers : 'chromium,firefox,webkit')
        .split(',')
        .map((item) => normalizeBrowser(item.trim()))
        .filter((item): item is BrowserName => Boolean(item));
      const result = await runCompatibility({
        url: requireString(args, 'url'),
        outputDir: typeof args.outputDir === 'string' ? args.outputDir : typeof args.output === 'string' ? args.output : undefined,
        configPath: typeof args.configPath === 'string' ? args.configPath : typeof args.config === 'string' ? args.config : undefined,
        browsers,
        headless: typeof args.headless === 'boolean' ? args.headless : undefined,
        storageState: typeof args.storageState === 'string' ? args.storageState : undefined,
        sessionStorageState: typeof args.sessionStorageState === 'string' ? args.sessionStorageState : undefined,
        trace: typeof args.trace === 'boolean' ? args.trace : undefined,
        video: typeof args.video === 'boolean' ? args.video : undefined,
        screenshot: typeof args.screenshot === 'boolean' ? args.screenshot : undefined,
        simulateExceptions: typeof args.simulateExceptions === 'boolean' ? args.simulateExceptions : undefined,
        ai: typeof args.ai === 'boolean' ? args.ai : undefined,
        coverage: typeof args.coverage === 'boolean' ? args.coverage : undefined,
        security: typeof args.security === 'boolean' ? args.security : undefined,
        journeys: typeof args.journeys === 'boolean' ? args.journeys : undefined,
        contract: typeof args.contract === 'boolean' ? args.contract : undefined,
        realtime: typeof args.realtime === 'boolean' ? args.realtime : undefined,
        p2: typeof args.p2 === 'boolean' ? args.p2 : undefined,
        blockMutatingRequests: typeof args.blockMutatingRequests === 'boolean' ? args.blockMutatingRequests : undefined
      });
      return textContent(result);
    }
    default:
      throw new RpcError(-32602, `Unknown tool: ${params.name ?? '(missing)'}`);
  }
}

function response(id: JsonRpcRequest['id'], result: unknown): Record<string, unknown> {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function errorResponse(id: JsonRpcRequest['id'], error: unknown): Record<string, unknown> {
  const rpcError = error instanceof RpcError ? error : new RpcError(-32603, error instanceof Error ? error.message : String(error));
  return {
    jsonrpc: '2.0',
    id: id ?? null,
    error: {
      code: rpcError.code,
      message: rpcError.message,
      data: rpcError.data
    }
  };
}

function send(message: Record<string, unknown>): void {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  stdout.write(`Content-Length: ${body.byteLength}\r\n\r\n`);
  stdout.write(body);
}

let initialized = false;

async function handleMessage(message: JsonRpcRequest): Promise<void> {
  if (message.id === undefined || message.id === null) {
    return;
  }

  try {
    if (!message.method) {
      throw new RpcError(-32600, 'Missing JSON-RPC method.');
    }
    if (!initialized && !['initialize', 'ping'].includes(message.method)) {
      throw new RpcError(-32002, 'MCP server is not initialized.');
    }

    switch (message.method) {
      case 'initialize': {
        const params = isRecord(message.params) ? message.params : {};
        const requested = typeof params.protocolVersion === 'string' ? params.protocolVersion : PROTOCOL_VERSION;
        if (!SUPPORTED_PROTOCOL_VERSIONS.has(requested)) {
          throw new RpcError(-32602, `Unsupported MCP protocol version: ${requested}`, {
            requested,
            supported: [...SUPPORTED_PROTOCOL_VERSIONS]
          });
        }
        initialized = true;
        send(
          response(message.id, {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: { name: 'frontlens', version: VERSION }
          })
        );
        return;
      }
      case 'tools/list':
        send(response(message.id, listTools()));
        return;
      case 'tools/call': {
        const params = isRecord(message.params) ? (message.params as ToolCallParams) : {};
        try {
          send(response(message.id, await callTool(params)));
        } catch (error) {
          if (error instanceof RpcError) {
            throw error;
          }
          send(response(message.id, textContent(error instanceof Error ? error.message : String(error), true)));
        }
        return;
      }
      case 'ping':
        send(response(message.id, {}));
        return;
      default:
        throw new RpcError(-32601, `Unsupported method: ${message.method}`);
    }
  } catch (error) {
    send(errorResponse(message.id, error));
  }
}

interface ExtractedMessages {
  messages: JsonRpcRequest[];
  errors: Error[];
  rest: Buffer<ArrayBufferLike>;
}

function parseJsonMessage(body: Buffer<ArrayBufferLike>): JsonRpcRequest {
  try {
    return JSON.parse(body.toString('utf8')) as JsonRpcRequest;
  } catch (error) {
    throw new RpcError(-32700, error instanceof Error ? error.message : String(error));
  }
}

function extractMessages(buffer: Buffer<ArrayBufferLike>): ExtractedMessages {
  const messages: JsonRpcRequest[] = [];
  const errors: Error[] = [];
  let rest = buffer;

  while (rest.byteLength > 0) {
    if (rest.subarray(0, 'Content-Length:'.length).toString('ascii').toLowerCase() === 'content-length:') {
      const headerEnd = rest.indexOf(Buffer.from('\r\n\r\n'));
      if (headerEnd === -1) break;
      const header = rest.subarray(0, headerEnd).toString('ascii');
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        errors.push(new RpcError(-32600, 'Missing Content-Length header.'));
        rest = rest.subarray(headerEnd + 4);
        continue;
      }
      const length = Number(match[1]);
      const bodyStart = headerEnd + 4;
      const bodyEnd = bodyStart + length;
      if (rest.byteLength < bodyEnd) break;
      try {
        messages.push(parseJsonMessage(rest.subarray(bodyStart, bodyEnd)));
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
      rest = rest.subarray(bodyEnd);
      continue;
    }

    const newline = rest.indexOf(0x0a);
    if (newline === -1) break;
    const line = rest.subarray(0, newline).toString('utf8').trim();
    rest = rest.subarray(newline + 1);
    if (line) {
      try {
        messages.push(JSON.parse(line) as JsonRpcRequest);
      } catch (error) {
        errors.push(new RpcError(-32700, error instanceof Error ? error.message : String(error)));
      }
    }
  }

  return { messages, errors, rest };
}

export async function startMcpServer(): Promise<void> {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  stdin.on('data', (chunk: Buffer | string) => {
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    const extracted = extractMessages(buffer);
    buffer = extracted.rest;
    for (const error of extracted.errors) {
      send(errorResponse(null, error));
    }
    for (const message of extracted.messages) {
      void handleMessage(message);
    }
  });

  await new Promise<void>((resolve) => {
    stdin.on('end', resolve);
  });
}
