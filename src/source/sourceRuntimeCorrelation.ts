import type { ComponentRecord, NetworkRecord, PageModel, SourceAnalysisResult, SourceRuntimeCorrelationResult, SourceRuntimeLink, SourceRuntimeListHint } from '../types.js';

function parsePath(url: string): string {
  try {
    return new URL(url, 'http://frontlens.local').pathname.replace(/\/+/g, '/');
  } catch {
    return url.split('?')[0].replace(/\/+/g, '/');
  }
}

function normalizeApiPath(value: string | undefined): string {
  if (!value) return '';
  return value
    .replace(/[`'"]/g, '')
    .replace(/\$\{[^}]+\}/g, '*')
    .replace(/:\w+/g, '*')
    .split('?')[0]
    .replace(/\/+/g, '/')
    .trim();
}

function pathTokens(value: string): string[] {
  return value
    .split(/[/?#&=._:-]+/)
    .map((item) => item.toLowerCase().trim())
    .filter((item) => item.length >= 3 && !/^(api|v1|v2|v3|list|page|query|get|post|put|delete|search)$/.test(item))
    .slice(-5);
}

function pathsMatch(runtimePath: string, sourcePath: string | undefined): boolean {
  const source = normalizeApiPath(sourcePath);
  if (!source) return false;
  if (source.includes('*')) {
    const pattern = source.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]+');
    return new RegExp(`${pattern}$`).test(runtimePath);
  }
  return runtimePath === source || runtimePath.endsWith(source) || source.endsWith(runtimePath);
}

function parseJsonPreview(record: NetworkRecord): unknown | undefined {
  if (!record.responseBodyPreview) return undefined;
  const text = record.responseBodyPreview.trim();
  if (!/json/i.test(record.contentType ?? '') && !/^[\[{]/.test(text)) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

const listKeyPattern = /^(data|records|rows|list|items|results|pageData)$/i;

function findListHints(value: unknown, path = '$', depth = 0, inheritedListKey = false, hints: SourceRuntimeListHint[] = []): SourceRuntimeListHint[] {
  if (depth > 4 || value === null || value === undefined) return hints;
  if (Array.isArray(value)) {
    const firstObject = value.find((item): item is Record<string, unknown> => item !== null && typeof item === 'object' && !Array.isArray(item));
    if (inheritedListKey && value.length > 0 && firstObject) {
      hints.push({ path, length: value.length, sampleKeys: Object.keys(firstObject).slice(0, 20) });
    }
    for (const item of value.slice(0, 3)) findListHints(item, `${path}[]`, depth + 1, false, hints);
    return hints;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      findListHints(child, `${path}.${key}`, depth + 1, listKeyPattern.test(key), hints);
    }
  }
  return hints;
}

function componentText(component: ComponentRecord): string {
  return [
    component.id,
    component.type,
    component.label,
    component.text,
    component.placeholder,
    component.selector,
    component.attributes?.['aria-label'],
    component.attributes?.title
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function relatedComponents(pageModel: PageModel, tokens: string[]): string[] {
  const tokenSet = new Set(tokens);
  return pageModel.components
    .filter((component) => {
      const text = componentText(component);
      return [...tokenSet].some((token) => text.includes(token));
    })
    .map((component) => component.id)
    .filter((id, index, all) => all.indexOf(id) === index)
    .slice(0, 20);
}

function confidenceFor(input: { sourceCount: number; directSourceCount: number; componentCount: number; stateCount: number; listHintCount: number }): SourceRuntimeLink['confidence'] {
  if (input.sourceCount === 0) return 'none';
  if (input.directSourceCount === 0) return 'low';
  if (input.componentCount > 0 && (input.stateCount > 0 || input.listHintCount > 0)) return 'high';
  if (input.componentCount > 0 || input.stateCount > 0 || input.listHintCount > 0) return 'medium';
  return 'low';
}

export function createEmptySourceRuntimeCorrelation(status: SourceRuntimeCorrelationResult['status'] = 'skipped', error?: string): SourceRuntimeCorrelationResult {
  return {
    enabled: false,
    status,
    checkedAt: new Date().toISOString(),
    summary: {
      networkRequestCount: 0,
      linkedRequestCount: 0,
      strongLinkCount: 0,
      unlinkedRequestCount: 0,
      listResponseLinkCount: 0
    },
    links: [],
    gaps: error ? [error] : [],
    error
  };
}

export function buildSourceRuntimeCorrelation(input: {
  sourceAnalysis: SourceAnalysisResult;
  networkRecords: NetworkRecord[];
  pageModel: PageModel;
}): SourceRuntimeCorrelationResult {
  if (!input.sourceAnalysis.enabled || input.sourceAnalysis.status !== 'passed') {
    return {
      ...createEmptySourceRuntimeCorrelation('skipped', input.sourceAnalysis.error ?? 'Source analysis was not available.'),
      enabled: input.sourceAnalysis.enabled
    };
  }

  const runtimeRequests = input.networkRecords.filter((record) => record.resourceType === 'xhr' || record.resourceType === 'fetch');
  const links: SourceRuntimeLink[] = runtimeRequests.map((record, index) => {
    const runtimePath = parsePath(record.url);
    const tokens = pathTokens(runtimePath);
    const directSourceMatches = input.sourceAnalysis.apiCalls.filter((call) => pathsMatch(runtimePath, call.path));
    const tokenSourceMatches = input.sourceAnalysis.apiCalls.filter((call) => {
      if (directSourceMatches.includes(call)) return false;
      const expression = `${call.expression} ${call.file}`.toLowerCase();
      return tokens.length > 0 && tokens.some((token) => expression.includes(token));
    });
    const sourceMatches = [...directSourceMatches, ...tokenSourceMatches];
    const sourceFiles = new Set(sourceMatches.map((match) => match.file));
    const stateSignals = input.sourceAnalysis.stateSignals
      .filter((signal) => sourceFiles.has(signal.file) || tokens.some((token) => signal.text.toLowerCase().includes(token) || signal.file.toLowerCase().includes(token)))
      .slice(0, 20);
    const componentIds = relatedComponents(input.pageModel, tokens);
    const responseListHints = findListHints(parseJsonPreview(record)).slice(0, 10);
    const confidence = confidenceFor({ sourceCount: sourceMatches.length, directSourceCount: directSourceMatches.length, componentCount: componentIds.length, stateCount: stateSignals.length, listHintCount: responseListHints.length });
    const notes = [
      directSourceMatches.length ? `directly matched ${directSourceMatches.length} source API call(s)` : sourceMatches.length ? `weak-token matched ${sourceMatches.length} source API call(s)` : 'no source API call matched',
      componentIds.length ? `matched ${componentIds.length} UI/component hint(s)` : 'no specific UI/component hint matched',
      stateSignals.length ? `matched ${stateSignals.length} source state signal(s)` : 'no source state signal matched',
      responseListHints.length ? `detected ${responseListHints.length} list-like response hint(s)` : ''
    ].filter(Boolean);
    return {
      id: `SRC-LINK-${String(index + 1).padStart(3, '0')}`,
      networkRequestId: record.id,
      method: record.method,
      url: record.url,
      path: runtimePath,
      status: record.status,
      sourceMatches: sourceMatches.slice(0, 20),
      stateSignals,
      componentIds,
      responseListHints,
      confidence,
      notes
    };
  });

  const linked = links.filter((link) => link.confidence !== 'none');
  const gaps = links
    .filter((link) => link.confidence === 'none')
    .slice(0, 20)
    .map((link) => `${link.networkRequestId} ${link.method} ${link.path} 未匹配到源码 API 调用。`);

  return {
    enabled: true,
    status: 'passed',
    checkedAt: new Date().toISOString(),
    summary: {
      networkRequestCount: runtimeRequests.length,
      linkedRequestCount: linked.length,
      strongLinkCount: links.filter((link) => link.confidence === 'high').length,
      unlinkedRequestCount: links.filter((link) => link.confidence === 'none').length,
      listResponseLinkCount: links.filter((link) => link.responseListHints.length > 0 && (link.confidence === 'medium' || link.confidence === 'high')).length
    },
    links,
    gaps
  };
}
