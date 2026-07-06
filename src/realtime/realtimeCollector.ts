import type { BrowserContext, WebSocket } from 'playwright';
import type { FrontLensConfig, GraphQLRecord, NetworkRecord, RealtimeResult, SseRecord, WebSocketRecord } from '../types.js';
import { createId } from '../utils/id.js';
import { redactText, redactUrl } from '../utils/redact.js';
import { compactText } from '../utils/text.js';
import { graphqlOperationType } from '../utils/graphql.js';

function previewPayload(payload: string | Buffer): string {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  return compactText(redactText(text), 500);
}

function parseJson(value: string | undefined): unknown {
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

function asRecordArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) {
    return value.filter(isRecord);
  }
  return isRecord(value) ? [value] : [];
}

function variablesPreview(value: unknown): string | undefined {
  return value === undefined ? undefined : compactText(redactText(JSON.stringify(value)), 500);
}

function hasGraphqlErrors(response: Record<string, unknown> | undefined, fallbackPreview: string | undefined): boolean {
  return Array.isArray(response?.errors) || (!response && /"errors"\s*:/i.test(fallbackPreview ?? ''));
}

function errorPreview(response: Record<string, unknown> | undefined, fallbackPreview: string | undefined): string | undefined {
  if (response) {
    return compactText(redactText(JSON.stringify(response)), 500);
  }
  return fallbackPreview ? compactText(redactText(fallbackPreview), 500) : undefined;
}

export class RealtimeCollector {
  private readonly webSockets = new Map<WebSocket, WebSocketRecord>();
  private wsCounter = 0;

  constructor(private readonly config: FrontLensConfig) {}

  attach(context: BrowserContext): void {
    if (!this.config.realtime.enabled || !this.config.realtime.captureWebSocket) return;
    context.on('page', (page) => {
      page.on('websocket', (ws) => this.onWebSocket(ws));
    });
  }

  private onWebSocket(ws: WebSocket): void {
    if (this.webSockets.size >= this.config.realtime.maxMessages && this.config.realtime.maxMessages > 0) {
      return;
    }
    const record: WebSocketRecord = {
      id: createId('WS', ++this.wsCounter),
      url: redactUrl(ws.url()),
      openedAt: new Date().toISOString(),
      framesSent: 0,
      framesReceived: 0,
      errors: [],
      samples: []
    };
    this.webSockets.set(ws, record);
    const maxSamples = Math.max(0, this.config.realtime.maxMessages);
    ws.on('framesent', (event) => {
      record.framesSent += 1;
      if (record.samples.length < maxSamples) record.samples.push({ direction: 'sent', timestamp: new Date().toISOString(), payloadPreview: previewPayload(event.payload) });
    });
    ws.on('framereceived', (event) => {
      record.framesReceived += 1;
      if (record.samples.length < maxSamples) record.samples.push({ direction: 'received', timestamp: new Date().toISOString(), payloadPreview: previewPayload(event.payload) });
    });
    ws.on('socketerror', (error) => record.errors.push(redactText(error)));
    ws.on('close', () => {
      record.closedAt = new Date().toISOString();
    });
  }

  build(networkRecords: NetworkRecord[], options: { excludedNetworkRequestIds?: Iterable<string> } = {}): RealtimeResult {
    if (!this.config.realtime.enabled) {
      return createEmptyRealtimeResult(this.config);
    }
    const excluded = new Set(options.excludedNetworkRequestIds ?? []);
    const recordsForRealtime = excluded.size > 0 ? networkRecords.filter((record) => !excluded.has(record.id)) : networkRecords;

    const graphql: GraphQLRecord[] = recordsForRealtime
      .filter((record) => record.protocol === 'graphql')
      .flatMap((record) => {
        const operations = asRecordArray(parseJson(record.postData ?? undefined));
        const responses = asRecordArray(parseJson(record.responseBodyPreview));
        const count = Math.max(operations.length, responses.length, 1);
        return Array.from({ length: count }, (_, operationIndex) => {
          const body = operations[operationIndex] ?? (operations.length === 1 ? operations[0] : undefined);
          const response = responses[operationIndex] ?? (responses.length === 1 ? responses[0] : undefined);
          const query = typeof body?.query === 'string' ? body.query : undefined;
          const operationName =
            typeof body?.operationName === 'string'
              ? body.operationName
              : operations.length <= 1
                ? record.graphql?.operationName
                : undefined;
          const hasErrors = hasGraphqlErrors(response, record.responseBodyPreview);
          return {
            id: '',
            networkRequestId: record.id,
            operationName,
            operationType: (() => {
              const detected = graphqlOperationType(query, operationName);
              return detected !== 'unknown' ? detected : operations.length <= 1 ? (record.graphql?.operationType ?? 'unknown') : 'unknown';
            })(),
            status: record.status,
            hasErrors,
            errorPreview: hasErrors ? errorPreview(response, record.responseBodyPreview) : undefined,
            variablesPreview: variablesPreview(body?.variables) ?? (operations.length <= 1 ? record.graphql?.variablesPreview : undefined)
          } satisfies GraphQLRecord;
        });
      })
      .map((record, index) => ({ ...record, id: createId('GQL', index + 1) }));

    const sse: SseRecord[] = this.config.realtime.captureSse
      ? recordsForRealtime
          .filter((record) => record.protocol === 'sse' || /text\/event-stream/i.test(record.contentType ?? ''))
          .map((record, index) => ({
            id: createId('SSE', index + 1),
            networkRequestId: record.id,
            url: record.url,
            status: record.status,
            contentType: record.contentType,
            durationMs: record.durationMs
          }))
      : [];

    const webSockets = this.config.realtime.captureWebSocket ? Array.from(this.webSockets.values()) : [];
    return {
      enabled: this.config.realtime.enabled,
      checkedAt: new Date().toISOString(),
      graphql,
      webSockets,
      sse,
      summary: {
        graphqlOperationCount: graphql.length,
        graphqlErrorCount: graphql.filter((item) => item.hasErrors).length,
        webSocketCount: webSockets.length,
        webSocketErrorCount: webSockets.filter((item) => item.errors.length > 0).length,
        sseCount: sse.length
      }
    };
  }
}

export function createEmptyRealtimeResult(config: FrontLensConfig): RealtimeResult {
  return {
    enabled: config.realtime.enabled,
    checkedAt: new Date().toISOString(),
    graphql: [],
    webSockets: [],
    sse: [],
    summary: {
      graphqlOperationCount: 0,
      graphqlErrorCount: 0,
      webSocketCount: 0,
      webSocketErrorCount: 0,
      sseCount: 0
    }
  };
}
