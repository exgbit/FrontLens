import type { BrowserContext, Request, Response } from 'playwright';
import type { AnalysisConfig, NetworkRecord } from '../types.js';
import { createId } from '../utils/id.js';
import { redactHeaders, redactText, redactUrl } from '../utils/redact.js';
import { compactText } from '../utils/text.js';
import { graphqlOperationType as detectGraphqlOperationType } from '../utils/graphql.js';

const MAX_NETWORK_RECORDS = 5000;

function parseJson(value: string | null | undefined): unknown {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function graphqlOperations(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

function classifyGraphQL(url: string, headers: Record<string, string>, postData: string | null | undefined): NetworkRecord['graphql'] | undefined {
  const contentType = headers['content-type'] ?? headers['Content-Type'] ?? '';
  const raw = postData ?? '';
  const operations = graphqlOperations(parseJson(raw));
  const firstOperation = operations.find((item) => typeof item.query === 'string') ?? operations[0];
  const hasGraphqlSignal = /graphql/i.test(url) || /graphql/i.test(contentType) || operations.some((item) => typeof item.query === 'string');
  if (!hasGraphqlSignal) {
    return undefined;
  }
  const operationTypes = [...new Set(operations.map((item) => detectGraphqlOperationType(typeof item.query === 'string' ? item.query : undefined, typeof item.operationName === 'string' ? item.operationName : undefined)).filter((item) => item !== 'unknown'))];
  const variables =
    operations.length > 1
      ? compactText(
          redactText(
            JSON.stringify(
              operations.map((item, index) => ({
                index,
                operationName: typeof item.operationName === 'string' ? item.operationName : undefined,
                variables: item.variables
              }))
            )
          ),
          1000
        )
      : firstOperation?.variables === undefined
        ? undefined
        : compactText(redactText(JSON.stringify(firstOperation.variables)), 1000);
  return {
    operationName: operations.length === 1 && typeof firstOperation?.operationName === 'string' ? firstOperation.operationName : operations.length > 1 ? `batch(${operations.length})` : undefined,
    operationType: operationTypes.length === 1 ? operationTypes[0] : 'unknown',
    variablesPreview: variables
  };
}

export class NetworkCollector {
  private readonly records = new Map<Request, NetworkRecord>();
  private readonly pending = new Set<Promise<void>>();
  private counter = 0;

  constructor(private readonly analysisConfig: AnalysisConfig) {}

  attach(context: BrowserContext): void {
    context.on('request', (request) => this.onRequest(request));
    context.on('response', (response) => this.track(this.onResponse(response)));
    context.on('requestfailed', (request) => this.onRequestFailed(request));
    context.on('requestfinished', (request) => this.track(this.onRequestFinished(request)));
  }

  list(): NetworkRecord[] {
    return Array.from(this.records.values()).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }

  async flush(timeoutMs = 2000): Promise<void> {
    const pending = [...this.pending];
    if (pending.length === 0) return;
    await Promise.race([
      Promise.allSettled(pending).then(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs))
    ]);
  }

  private track(promise: Promise<void>): void {
    this.pending.add(promise);
    promise.catch(() => undefined).finally(() => this.pending.delete(promise));
  }

  private onRequest(request: Request): void {
    if (this.records.size >= MAX_NETWORK_RECORDS) {
      return;
    }
    const now = new Date();
    const id = createId('REQ', ++this.counter);
    const headers = redactHeaders(request.headers());
    const rawPostData = request.postData();
    const postData = rawPostData ? redactText(rawPostData) : rawPostData;
    const graphql = classifyGraphQL(request.url(), headers, postData);
    const record: NetworkRecord = {
      id,
      url: redactUrl(request.url()),
      method: request.method(),
      resourceType: request.resourceType(),
      requestHeaders: headers,
      postData,
      failed: false,
      startedAt: now.toISOString(),
      protocol: graphql ? 'graphql' : 'unknown',
      graphql
    };
    Object.defineProperty(record, 'rawUrl', {
      value: request.url(),
      enumerable: false,
      configurable: false
    });
    this.records.set(request, record);
  }

  private async onResponse(response: Response): Promise<void> {
    const request = response.request();
    const record = this.records.get(request);
    if (!record) {
      return;
    }

    record.status = response.status();
    record.statusText = response.statusText();
    record.ok = response.ok();
    record.responseHeaders = redactHeaders(await response.allHeaders().catch(() => response.headers()));
    record.contentType = record.responseHeaders?.['content-type'] ?? record.responseHeaders?.['Content-Type'];
    if (/text\/event-stream/i.test(record.contentType ?? '')) {
      record.protocol = 'sse';
      record.sse = { detected: true };
    } else if (record.protocol !== 'graphql') {
      record.protocol = ['xhr', 'fetch'].includes(record.resourceType) ? 'rest' : 'unknown';
    }
  }

  private onRequestFailed(request: Request): void {
    const record = this.records.get(request);
    if (!record) {
      return;
    }
    record.failed = true;
    record.failureText = request.failure()?.errorText;
    record.endedAt = new Date().toISOString();
    record.durationMs = Math.max(0, new Date(record.endedAt).getTime() - new Date(record.startedAt).getTime());
  }

  private async onRequestFinished(request: Request): Promise<void> {
    const record = this.records.get(request);
    if (!record) {
      return;
    }
    record.endedAt = new Date().toISOString();
    record.durationMs = Math.max(0, new Date(record.endedAt).getTime() - new Date(record.startedAt).getTime());

    const response = await request.response().catch(() => null);
    if (!response) {
      return;
    }

    record.status ??= response.status();
    record.statusText ??= response.statusText();
    record.ok ??= response.ok();
    record.responseHeaders ??= redactHeaders(await response.allHeaders().catch(() => response.headers()));
    record.contentType ??= record.responseHeaders?.['content-type'] ?? record.responseHeaders?.['Content-Type'];
    if (/text\/event-stream/i.test(record.contentType ?? '')) {
      record.protocol = 'sse';
      record.sse = { detected: true };
    } else if (record.protocol !== 'graphql') {
      record.protocol = ['xhr', 'fetch'].includes(record.resourceType) ? 'rest' : 'unknown';
    }

    const contentType = record.contentType ?? '';
    const shouldPreview = /json|text|javascript|xml|html|graphql|form/i.test(contentType);
    if (!shouldPreview) {
      return;
    }
    if (/text\/event-stream/i.test(contentType)) {
      record.responseBodyTruncated = true;
      return;
    }

    const maxBytes = this.analysisConfig.maxResponsePreviewBytes;
    const contentLength = Number(record.responseHeaders?.['content-length'] ?? record.responseHeaders?.['Content-Length'] ?? 0);
    if (Number.isFinite(contentLength) && contentLength > maxBytes * 4) {
      record.encodedBodySize = contentLength;
      record.responseBodyTruncated = true;
      return;
    }
    const body = await response.body().catch(() => null);
    if (!body) {
      return;
    }
    record.encodedBodySize = body.byteLength;
    const previewBytes = body.byteLength > maxBytes ? body.subarray(0, maxBytes) : body;
    record.responseBodyPreview = redactText(previewBytes.toString('utf8'));
    record.responseBodyTruncated = body.byteLength > maxBytes;
  }
}
