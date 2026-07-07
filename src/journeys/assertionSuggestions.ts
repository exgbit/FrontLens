import type {
  AssertionSuggestionAction,
  AssertionSuggestionItem,
  AssertionSuggestionResult,
  ComponentRecord,
  JourneyAssertionAuditItem,
  JourneyTestResult,
  NetworkRecord,
  QaResult,
  RequirementCoverageItem
} from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

export type AssertionSuggestionInput = Pick<
  QaResult,
  'pageModel' | 'network' | 'requirementCoverage' | 'journeyTests' | 'journeyAssertionAudit'
>;

function unique<T>(items: T[]): T[] {
  return [...new Set(items.filter(Boolean))];
}

function priorityRank(priority: AssertionSuggestionItem['priority']): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function add(items: AssertionSuggestionItem[], input: Omit<AssertionSuggestionItem, 'id'>): void {
  items.push({
    ...input,
    id: `AS-${String(items.length + 1).padStart(3, '0')}`,
    evidenceRefs: unique(input.evidenceRefs),
    notes: unique(input.notes)
  });
}

function cleanText(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function isUsefulText(value: string): boolean {
  if (value.length < 2 || value.length > 80) return false;
  if (/^(ok|yes|no|true|false|submit|button)$/i.test(value)) return false;
  return /[\p{L}\p{N}]/u.test(value);
}

function textCandidates(result: AssertionSuggestionInput): string[] {
  const values = [
    result.pageModel.title,
    ...(result.pageModel.meta?.h1 ?? []),
    ...(result.pageModel.headings ?? []).map((item) => item.text),
    ...(result.pageModel.buttons ?? []).map((item) => item.label ?? item.text),
    ...(result.pageModel.links ?? []).map((item) => item.label ?? item.text)
  ].map(cleanText).filter(isUsefulText);
  return unique(values).slice(0, 8);
}

function selectorCandidates(result: AssertionSuggestionInput): ComponentRecord[] {
  return [
    ...(result.pageModel.forms ?? []),
    ...(result.pageModel.tables ?? []),
    ...(result.pageModel.inputs ?? []),
    ...(result.pageModel.buttons ?? []),
    ...(result.pageModel.components ?? [])
  ]
    .filter((item) => item.visible !== false && Boolean(item.selector))
    .filter((item) => (item.selector ?? '').length <= 160)
    .slice(0, 12);
}

function requestById(result: AssertionSuggestionInput): Map<string, NetworkRecord> {
  return new Map((result.network.requests ?? []).map((request) => [request.id, request]));
}

function requestPattern(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search ? parsed.search.replace(/=[^&]+/g, '=*') : ''}`;
  } catch {
    return url.replace(/^https?:\/\/[^/]+/i, '').replace(/=[^&]+/g, '=*');
  }
}

function requestCandidates(result: AssertionSuggestionInput, ids: string[] = []): NetworkRecord[] {
  const byId = requestById(result);
  const preferred = ids.map((id) => byId.get(id)).filter((item): item is NetworkRecord => Boolean(item));
  const fallback = (result.network.requests ?? [])
    .filter((request) => ['xhr', 'fetch'].includes(request.resourceType) || /\/api\/|graphql/i.test(request.url))
    .filter((request) => !request.failed && typeof request.status === 'number' && request.status >= 200 && request.status < 400)
    .slice(0, 8);
  return unique([...preferred, ...fallback]).slice(0, 5);
}

function journeyNetworkIds(journey: JourneyTestResult): string[] {
  return unique(journey.steps.flatMap((step) => step.networkRequestIds ?? []));
}

function auditByJourney(result: AssertionSuggestionInput): Map<string, JourneyAssertionAuditItem> {
  return new Map(result.journeyAssertionAudit.items.map((item) => [item.journeyId, item]));
}

function weakJourneyItems(result: AssertionSuggestionInput): Array<{ journey: JourneyTestResult; audit?: JourneyAssertionAuditItem }> {
  const audits = auditByJourney(result);
  return result.journeyTests
    .map((journey) => ({ journey, audit: audits.get(journey.id) }))
    .filter(({ journey, audit }) => journey.status !== 'failed' && journey.status !== 'skipped' && (!audit || audit.quality === 'path-only' || audit.quality === 'weakly-asserted' || audit.quality === 'runtime-partial'));
}

function requirementNeedsAssertion(item: RequirementCoverageItem): boolean {
  return item.source === 'provided' && item.status !== 'passed';
}

function exampleStep(action: AssertionSuggestionAction, target: string, value?: string): string {
  const tail = value ? `, value: ${JSON.stringify(value)}` : '';
  return `{ action: '${action}', target: ${JSON.stringify(target)}${tail} }`;
}

function addRequestSuggestion(items: AssertionSuggestionItem[], request: NetworkRecord, input: {
  priority: AssertionSuggestionItem['priority'];
  journeyId?: string;
  requirementId?: string;
  reason: string;
  evidenceRefs: string[];
  confidence: AssertionSuggestionItem['confidence'];
}): void {
  const pattern = requestPattern(request.url);
  add(items, {
    source: 'api',
    priority: input.priority,
    action: 'expectRequest',
    target: pattern,
    value: request.status && request.status >= 200 && request.status < 300 ? '2xx' : String(request.status ?? 'ok'),
    journeyId: input.journeyId,
    requirementId: input.requirementId,
    confidence: input.confidence,
    reason: input.reason,
    evidenceRefs: [...input.evidenceRefs, request.id],
    exampleStep: exampleStep('expectRequest', pattern, request.status && request.status >= 200 && request.status < 300 ? '2xx' : String(request.status ?? 'ok')),
    notes: ['API 断言证明关键请求成功，但仍应搭配 UI 文本/选择器断言证明用户可见结果。']
  });
}

export function buildAssertionSuggestions(result: AssertionSuggestionInput): AssertionSuggestionResult {
  const items: AssertionSuggestionItem[] = [];
  const texts = textCandidates(result);
  const selectors = selectorCandidates(result);
  const weakJourneys = weakJourneyItems(result);

  for (const { journey, audit } of weakJourneys.slice(0, 12)) {
    const priority: AssertionSuggestionItem['priority'] = (journey.requirementIds?.length ?? 0) > 0 || journey.source === 'requirement-generated' ? 'P1' : 'P2';
    const networkIds = journeyNetworkIds(journey);
    const requests = requestCandidates(result, networkIds);
    const finalUrl = cleanText(journey.finalUrl);

    if (finalUrl && finalUrl !== journey.startUrl) {
      add(items, {
        source: 'journey',
        priority,
        action: 'expectUrl',
        target: finalUrl,
        journeyId: journey.id,
        confidence: 'high',
        reason: `Journey ${journey.id} changes URL; add URL assertion so path replay proves navigation result.`,
        evidenceRefs: ['journeyTests', journey.id],
        exampleStep: exampleStep('expectUrl', finalUrl),
        notes: audit ? [`current quality=${audit.quality}`] : []
      });
    }

    const text = texts[0];
    if (text) {
      add(items, {
        source: 'page-model',
        priority,
        action: 'expectText',
        target: 'body',
        value: text,
        journeyId: journey.id,
        confidence: 'medium',
        reason: `Journey ${journey.id} is ${audit?.quality ?? 'not-audited'}; add a business-specific visible text assertion.`,
        evidenceRefs: ['pageModel', 'journeyAssertionAudit', journey.id],
        exampleStep: exampleStep('expectText', 'body', text),
        notes: ['Replace this with a more specific success/empty/error text when PRD provides one.']
      });
    } else if (selectors[0]?.selector) {
      add(items, {
        source: 'page-model',
        priority,
        action: 'expectVisible',
        target: selectors[0].selector,
        journeyId: journey.id,
        confidence: 'medium',
        reason: `Journey ${journey.id} needs a non-generic visibility assertion.`,
        evidenceRefs: ['pageModel', selectors[0].id, 'journeyAssertionAudit', journey.id],
        exampleStep: exampleStep('expectVisible', selectors[0].selector),
        notes: ['Prefer a stable data-testid or ARIA role selector over generated CSS when available.']
      });
    }

    if (requests[0]) {
      addRequestSuggestion(items, requests[0], {
        priority,
        journeyId: journey.id,
        confidence: networkIds.length > 0 ? 'high' : 'medium',
        reason: `Journey ${journey.id} should prove the key API request succeeds.`,
        evidenceRefs: ['journeyTests', 'network']
      });
    }
  }

  for (const req of result.requirementCoverage.items.filter(requirementNeedsAssertion).slice(0, 12)) {
    const selector = req.evidence.selectors[0] || selectors[0]?.selector;
    if (selector) {
      add(items, {
        source: 'requirement',
        priority: req.priority,
        action: 'expectVisible',
        target: selector,
        requirementId: req.id,
        confidence: req.evidence.selectors.length ? 'high' : 'medium',
        reason: `Requirement ${req.id} is ${req.status}; add visible selector assertion to make it executable.`,
        evidenceRefs: ['requirementCoverage', req.id, selector],
        exampleStep: exampleStep('expectVisible', selector),
        notes: req.gaps
      });
    } else if (texts[0]) {
      add(items, {
        source: 'requirement',
        priority: req.priority,
        action: 'expectText',
        target: 'body',
        value: texts[0],
        requirementId: req.id,
        confidence: 'low',
        reason: `Requirement ${req.id} lacks selector/API binding; use this as a draft assertion only.`,
        evidenceRefs: ['requirementCoverage', req.id, 'pageModel'],
        exampleStep: exampleStep('expectText', 'body', texts[0]),
        notes: ['需要产品/QA 确认更具体的成功文本。', ...req.gaps]
      });
    }

    const ids = [...req.evidence.networkRequestIds];
    const request = requestCandidates(result, ids)[0];
    if (request) {
      addRequestSuggestion(items, request, {
        priority: req.priority,
        requirementId: req.id,
        confidence: ids.length > 0 ? 'high' : 'medium',
        reason: `Requirement ${req.id} should be backed by an API success assertion.`,
        evidenceRefs: ['requirementCoverage', req.id, 'network']
      });
    }
  }

  const sorted = items
    .sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority) || a.id.localeCompare(b.id))
    .slice(0, 80);
  const weakJourneyCount = weakJourneys.length;
  const requirementSuggestionCount = sorted.filter((item) => item.requirementId).length;
  const journeySuggestionCount = sorted.filter((item) => item.journeyId).length;
  const highConfidenceCount = sorted.filter((item) => item.confidence === 'high').length;
  const needsInputCount = weakJourneyCount + result.requirementCoverage.items.filter(requirementNeedsAssertion).length > 0 && sorted.length === 0 ? 1 : 0;
  const status: AssertionSuggestionResult['status'] = sorted.length > 0 ? 'ready' : needsInputCount > 0 ? 'needs-input' : 'skipped';

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      totalCount: sorted.length,
      journeySuggestionCount,
      requirementSuggestionCount,
      highConfidenceCount,
      weakJourneyCount,
      needsInputCount
    },
    items: sorted,
    notes: [
      'Assertion suggestions are draft journeySteps for QA review; they do not execute until added to requirements/journey config and rerun.',
      'Prefer business-specific success text, stable selectors, and expectRequest assertions bound to the exact flow.',
      'Do not treat suggested assertions as passed evidence; they are a path from path-only coverage to runtime-verified business validation.'
    ]
  };
}

function cell(value: unknown): string {
  return markdownEscape(truncateMiddle(String(value ?? '-'), 140));
}

export function formatAssertionSuggestions(result: AssertionSuggestionResult): string {
  const rows = result.items.map((item) => `| ${item.id} | ${item.priority} | ${item.action} | ${item.confidence} | ${cell(item.journeyId ?? item.requirementId ?? '-')} | ${cell(item.target)} | ${cell(item.value ?? '-')} | ${cell(item.reason)} | ${cell(item.exampleStep)} |`);
  return `# FrontLens Assertion Suggestions

## Status

- Status: **${result.status}**
- Suggestions: **${result.summary.totalCount}**（journey ${result.summary.journeySuggestionCount}, requirement ${result.summary.requirementSuggestionCount}, high-confidence ${result.summary.highConfidenceCount}）
- Weak/path-only journeys needing assertions: **${result.summary.weakJourneyCount}**
- Needs input: **${result.summary.needsInputCount}**

## Suggested expect* steps

${rows.length ? ['| ID | Pri | Action | Confidence | Journey/Req | Target | Value | Reason | Example step |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No concrete assertion suggestions generated.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
