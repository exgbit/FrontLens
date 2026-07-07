import type { FrontLensConfig, Issue, IssueCategory, RootCauseGroup, Severity, SourceAnalysisResult, SourceLocation, SourceRuntimeLink } from '../types.js';

const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const priorityRank: Record<RootCauseGroup['priority'], number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

type Owner = RootCauseGroup['owner'];
type Priority = RootCauseGroup['priority'];

type GroupDraft = Omit<RootCauseGroup, 'id' | 'issueCount' | 'summary' | 'verificationCommand'> & { issues: Issue[] };

function ownerFor(issue: Issue): Owner {
  if (issue.ownerHint) return issue.ownerHint;
  if (issue.category === 'security') {
    const details = detailsOf(issue);
    const category = String(details.category ?? '');
    const rule = String(details.rule ?? '');
    if (/xss|mixed-content|subresource-integrity|third-party/.test(`${category} ${rule}`)) return 'frontend';
    if (/headers|transport|fingerprint/.test(`${category} ${rule}`)) return 'backend';
    return 'security';
  }
  if (issue.suggestion.backend && !issue.suggestion.frontend) return 'backend';
  if (issue.category.startsWith('backend')) return 'backend';
  if (issue.suggestion.product && !issue.suggestion.frontend && !issue.suggestion.backend) return 'product';
  if (issue.suggestion.test && !issue.suggestion.frontend && !issue.suggestion.backend) return 'test';
  return 'frontend';
}

function priorityFor(issue: Issue): Priority {
  return issue.suggestion.priority ?? (issue.severity === 'critical' ? 'P0' : issue.severity === 'high' ? 'P1' : issue.severity === 'medium' ? 'P2' : 'P3');
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function detailsOf(issue: Issue): Record<string, unknown> {
  return issue.evidence.details && typeof issue.evidence.details === 'object' ? issue.evidence.details as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/issue-\d+/g, '')
    .replace(/req-\d+/g, '')
    .replace(/\b(401|403|404|500|timeout|api-500|api-404|api-401|api-403|api-timeout)\b/g, 'api-error')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function endpointFrom(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  try {
    const url = new URL(value);
    return `${url.pathname}${url.search ? '?*' : ''}`;
  } catch {
    return value.replace(/https?:\/\/[^/]+/i, '').replace(/\?.*$/, '?*');
  }
}

function comparableEndpoint(value: unknown): string | undefined {
  const endpoint = endpointFrom(value);
  if (!endpoint) return undefined;
  return endpoint.replace(/\?\*$/, '').replace(/\/+/g, '/');
}

function endpointsMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  const left = a.replace(/\/+$/, '');
  const right = b.replace(/\/+$/, '');
  return left === right || left.endsWith(right) || right.endsWith(left);
}

function groupKey(issue: Issue): string {
  const details = detailsOf(issue);
  const owner = ownerFor(issue);
  const target = endpointFrom(details.target) ?? endpointFrom(issue.affectedUrl) ?? endpointFrom(issue.evidence.resourceUrl);
  const rule = String(details.rule ?? '');
  const securityCategory = String(details.category ?? '');

  if (issue.category === 'security') {
    if (/headers|csp|nosniff|frame|referrer|coop|corp/i.test(`${securityCategory} ${rule} ${issue.title}`)) return `${owner}:security:deployment-headers`;
    if (/transport|https|hsts/i.test(`${securityCategory} ${rule} ${issue.title}`)) return `${owner}:security:transport`;
    if (/fingerprint|server/i.test(`${securityCategory} ${rule} ${issue.title}`)) return `${owner}:security:fingerprint`;
    return `${owner}:security:${securityCategory || normalizeText(rule || issue.title)}`;
  }

  if (issue.category === 'integration-no-feedback') return `${owner}:integration-no-feedback:${target ?? issue.affectedUrl ?? 'page'}`;
  if (issue.category.startsWith('integration')) return `${owner}:${issue.category}:${target ?? issue.evidence.selector ?? normalizeText(issue.title)}`;
  if (issue.category === 'frontend-accessibility') return `${owner}:frontend-accessibility:${rule || normalizeText(issue.title)}`;
  if (issue.category === 'frontend-performance' || issue.category === 'resource-performance' || issue.category === 'resource-loading') return `${owner}:performance:${target ?? normalizeText(issue.suggestion.frontend ?? issue.title)}`;
  if (issue.category.startsWith('backend')) return `${owner}:${issue.category}:${target ?? issue.evidence.networkRequestId ?? normalizeText(issue.title)}`;
  if (issue.category === 'console-error') return `${owner}:console:${issue.evidence.consoleId ?? normalizeText(issue.title)}`;
  if (issue.evidence.selector) return `${owner}:${issue.category}:${issue.evidence.selector}`;
  return `${owner}:${issue.category}:${normalizeText(issue.suggestion.frontend ?? issue.suggestion.backend ?? issue.suggestion.test ?? issue.suggestion.product ?? issue.title)}`;
}

function uniq<T>(items: Array<T | undefined | null>): T[] {
  return [...new Set(items.filter((item) => item !== undefined && item !== null))] as T[];
}

function sourceKey(location: SourceLocation): string {
  return `${location.file}:${location.line}:${location.column ?? ''}`;
}

function uniqSourceLocations(items: SourceLocation[]): SourceLocation[] {
  const seen = new Set<string>();
  const result: SourceLocation[] = [];
  for (const item of items) {
    const key = sourceKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push({
      file: item.file,
      line: item.line,
      ...(item.column !== undefined ? { column: item.column } : {})
    });
  }
  return result;
}

function maybeLocation(value: unknown): SourceLocation | undefined {
  if (!isRecord(value)) return undefined;
  const file = typeof value.file === 'string' ? value.file : typeof value.sourceFile === 'string' ? value.sourceFile : undefined;
  const lineValue = typeof value.line === 'number' ? value.line : typeof value.lineNumber === 'number' ? value.lineNumber : undefined;
  const columnValue = typeof value.column === 'number' ? value.column : undefined;
  if (!file || !lineValue || lineValue < 1) return undefined;
  const location: SourceLocation = {
    file,
    line: lineValue
  };
  if (columnValue !== undefined) location.column = columnValue;
  return location;
}

function locationsFromArray(value: unknown): SourceLocation[] {
  return Array.isArray(value) ? value.map(maybeLocation).filter((item): item is SourceLocation => Boolean(item)) : [];
}

function issueTargetEndpoint(issue: Issue): string | undefined {
  const details = detailsOf(issue);
  return comparableEndpoint(details.target) ?? comparableEndpoint(issue.affectedUrl) ?? comparableEndpoint(issue.evidence.resourceUrl);
}

function runtimeLinksFor(issue: Issue, runtimeLinks: SourceRuntimeLink[]): SourceRuntimeLink[] {
  if (runtimeLinks.length === 0) return [];
  const target = issueTargetEndpoint(issue);
  return runtimeLinks.filter((link) => {
    if (issue.evidence.networkRequestId && link.networkRequestId === issue.evidence.networkRequestId) return true;
    return link.confidence !== 'none' && endpointsMatch(target, comparableEndpoint(link.url) ?? link.path);
  });
}

function sourceFindingsForIssue(issue: Issue, sourceAnalysis?: SourceAnalysisResult): SourceLocation[] {
  if (!sourceAnalysis || sourceAnalysis.status !== 'passed') return [];
  const details = detailsOf(issue);
  const rule = String(details.rule ?? '');
  if (issue.category === 'frontend-accessibility' && rule) {
    return sourceAnalysis.findings
      .filter((finding) => finding.kind === 'ui-accessibility' && String(finding.details?.rule ?? '') === rule)
      .flatMap((finding) => finding.locations);
  }
  return [];
}

function sourceLocationsFor(issue: Issue, runtimeLinks: SourceRuntimeLink[] = [], sourceAnalysis?: SourceAnalysisResult): SourceLocation[] {
  const details = detailsOf(issue);
  const linkedRuntimeLocations = runtimeLinksFor(issue, runtimeLinks)
    .filter((link) => link.confidence === 'high' || link.confidence === 'medium')
    .flatMap((link) => [...link.sourceMatches, ...link.stateSignals]);
  return uniqSourceLocations([
    maybeLocation({ file: details.sourceFile, line: details.line, column: details.column }),
    ...locationsFromArray(details.locations),
    ...locationsFromArray(details.sourceApiMatches),
    ...locationsFromArray(details.sourceStateSignals),
    ...locationsFromArray(details.findings),
    ...locationsFromArray(details.imports),
    ...linkedRuntimeLocations,
    ...sourceFindingsForIssue(issue, sourceAnalysis)
  ].filter((item): item is SourceLocation => Boolean(item)));
}

function mergeSeverity(a: Severity, b: Severity): Severity {
  return severityRank[b] < severityRank[a] ? b : a;
}

function mergePriority(a: Priority, b: Priority): Priority {
  return priorityRank[b] < priorityRank[a] ? b : a;
}

function suggestedFix(issue: Issue): string {
  return issue.suggestion.frontend ?? issue.suggestion.backend ?? issue.suggestion.product ?? issue.suggestion.test ?? issue.description;
}

function titleFor(issues: Issue[]): string {
  const sorted = [...issues].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const first = sorted[0];
  if (!first) return '未分类问题';
  const duplicateCount = issues.length - 1;
  return duplicateCount > 0 ? `${first.title}（合并 ${issues.length} 个 raw issues）` : first.title;
}

function summaryFor(group: Omit<RootCauseGroup, 'summary' | 'verificationCommand'>): string {
  const categoryText = group.categories.join(', ');
  return `${group.priority}/${group.severity}/${group.owner}: ${group.issueCount} 个 raw issue，类别 ${categoryText}。${group.suggestedFix}`;
}

export function buildRootCauseGroups(issues: Issue[], config: FrontLensConfig, sourceRuntimeCorrelation?: { links: SourceRuntimeLink[] }, sourceAnalysis?: SourceAnalysisResult): RootCauseGroup[] {
  const groups = new Map<string, GroupDraft>();
  const runtimeLinks = sourceRuntimeCorrelation?.links ?? [];
  for (const issue of issues) {
    const key = groupKey(issue);
    const owner = ownerFor(issue);
    const priority = priorityFor(issue);
    const existing = groups.get(key);
    if (!existing) {
      groups.set(key, {
        rootCauseKey: key,
        title: issue.title,
        status: issue.severity === 'info' ? 'reference' : 'actionable',
        owner,
        priority,
        severity: issue.severity,
        issueIds: [issue.id],
        categories: [issue.category],
        selectors: issue.evidence.selector ? [issue.evidence.selector] : [],
        networkRequestIds: issue.evidence.networkRequestId ? [issue.evidence.networkRequestId] : [],
        consoleIds: issue.evidence.consoleId ? [issue.evidence.consoleId] : [],
        pageErrorIds: uniq([issue.evidence.pageErrorId, ...(issue.evidence.pageErrorIds ?? [])]),
        resourceUrls: issue.evidence.resourceUrl ? [issue.evidence.resourceUrl] : [],
        sourceLocations: sourceLocationsFor(issue, runtimeLinks, sourceAnalysis),
        suggestedFix: suggestedFix(issue),
        issues: [issue]
      });
      continue;
    }
    existing.issues.push(issue);
    const previousPriority = existing.priority;
    const previousSeverity = existing.severity;
    existing.status = existing.status === 'actionable' || issue.severity !== 'info' ? 'actionable' : 'reference';
    existing.severity = mergeSeverity(existing.severity, issue.severity);
    existing.priority = mergePriority(existing.priority, priority);
    existing.issueIds = uniq([...existing.issueIds, issue.id]);
    existing.categories = uniq([...existing.categories, issue.category]) as IssueCategory[];
    existing.selectors = uniq([...existing.selectors, ...(issue.evidence.selector ? [issue.evidence.selector] : [])]);
    existing.networkRequestIds = uniq([...existing.networkRequestIds, ...(issue.evidence.networkRequestId ? [issue.evidence.networkRequestId] : [])]);
    existing.consoleIds = uniq([...existing.consoleIds, ...(issue.evidence.consoleId ? [issue.evidence.consoleId] : [])]);
    existing.pageErrorIds = uniq([...existing.pageErrorIds, ...(issue.evidence.pageErrorId ? [issue.evidence.pageErrorId] : []), ...(issue.evidence.pageErrorIds ?? [])]);
    existing.resourceUrls = uniq([...existing.resourceUrls, ...(issue.evidence.resourceUrl ? [issue.evidence.resourceUrl] : [])]);
    existing.sourceLocations = uniqSourceLocations([...existing.sourceLocations, ...sourceLocationsFor(issue, runtimeLinks, sourceAnalysis)]);
    if (priorityRank[priority] < priorityRank[previousPriority] || severityRank[issue.severity] < severityRank[previousSeverity]) {
      existing.suggestedFix = suggestedFix(issue);
    }
  }

  const verificationCommand = `node dist/cli.js qa --url ${shellQuote(config.target.url)} --output ${shellQuote('reports/frontlens/verify-root-cause')} --no-trace --json`;
  return [...groups.values()]
    .map((draft, index) => {
      const { issues: groupedIssues, ...rest } = draft;
      const groupWithoutSummary = {
        ...rest,
        id: `RC-${String(index + 1).padStart(3, '0')}`,
        title: titleFor(groupedIssues),
        issueCount: groupedIssues.length
      };
      return {
        ...groupWithoutSummary,
        summary: summaryFor(groupWithoutSummary),
        verificationCommand
      };
    })
    .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority] || severityRank[a.severity] - severityRank[b.severity] || b.issueCount - a.issueCount || a.id.localeCompare(b.id))
    .map((group, index) => ({ ...group, id: `RC-${String(index + 1).padStart(3, '0')}` }));
}
