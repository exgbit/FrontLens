import type { QaResult, ReportContentAuditFinding, ReportContentAuditResult, ReportProfile } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';

function add(findings: ReportContentAuditFinding[], input: Omit<ReportContentAuditFinding, 'id'>): void {
  findings.push({ id: `RCA-${String(findings.length + 1).padStart(3, '0')}`, ...input });
}

function normalizeText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function includesPhrase(markdown: string, phrase: string): boolean {
  const normalizedPhrase = normalizeText(phrase);
  if (!normalizedPhrase) return false;
  return normalizeText(markdown).includes(normalizedPhrase);
}

function countHeading2(markdown: string): number {
  return markdown.split('\n').filter((line) => /^##\s+/.test(line)).length;
}

function countTableRows(markdown: string): number {
  return markdown.split('\n').filter((line) => /^\|/.test(line.trim())).length;
}

function countContentLines(markdown: string): number {
  return markdown.split('\n').filter((line) => line.trim().length > 0).length;
}

function excerpt(markdown: string, phrase: string): string {
  const normalized = normalizeText(markdown);
  const normalizedPhrase = normalizeText(phrase);
  const index = normalizedPhrase ? normalized.indexOf(normalizedPhrase) : -1;
  if (index < 0) return truncateMiddle(phrase, 220);
  return truncateMiddle(normalized.slice(Math.max(0, index - 80), Math.min(normalized.length, index + normalizedPhrase.length + 80)), 260);
}

function removeClaimGuardSections(markdown: string): string {
  const lines = markdown.split('\n');
  const kept: string[] = [];
  let inClaimGuard = false;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      inClaimGuard = /claim guard|结论护栏|禁止过度承诺/i.test(line);
    }
    if (!inClaimGuard) {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

function hasCoverageBoundary(markdown: string): boolean {
  const lower = markdown.toLowerCase();
  const hasCoverage = lower.includes('qa coverage') || markdown.includes('覆盖');
  const hasGap = lower.includes('gap') || markdown.includes('缺口') || markdown.includes('待补') || lower.includes('needs-input') || lower.includes('skipped');
  return hasCoverage && hasGap;
}

function hasRawScoreCaveat(markdown: string): boolean {
  const lower = markdown.toLowerCase();
  if (!lower.includes('raw score')) return true;
  return lower.includes('trend') || markdown.includes('趋势') || markdown.includes('不能直接等同') || markdown.includes('不等同') || markdown.includes('不是最终');
}

function forbiddenPhrases(result: QaResult): string[] {
  return [
    ...result.claimGuard.forbiddenClaims,
    ...result.claimGuard.items.flatMap((item) => item.forbiddenWording)
  ]
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, all) => all.indexOf(item) === index);
}

function auditForbiddenWording(result: QaResult, markdown: string, findings: ReportContentAuditFinding[]): void {
  const phrases = forbiddenPhrases(result);
  const conclusionMarkdown = removeClaimGuardSections(markdown);
  for (const phrase of phrases) {
    if (!includesPhrase(conclusionMarkdown, phrase)) continue;
    add(findings, {
      severity: 'blocker',
      category: 'forbidden-wording',
      title: 'User-facing report contains claimGuard forbidden wording.',
      evidence: excerpt(markdown, phrase),
      recommendation: 'Remove or rewrite this wording with claimGuard.allowedWording; keep unsupported business/release/security/performance claims conditional.'
    });
  }
}

function auditProfileDepth(profile: ReportProfile, markdown: string, findings: ReportContentAuditFinding[]): void {
  const containsRawIssueDetails = /##\s*十三、问题详情/.test(markdown) || markdown.includes('<details><summary>Evidence details') || /^# FrontLens QA Evidence Appendix/m.test(markdown);
  if ((profile === 'executive' || profile === 'professional') && containsRawIssueDetails) {
    add(findings, {
      severity: 'blocker',
      category: 'profile-depth',
      title: `${profile} report includes raw evidence appendix/details.`,
      evidence: 'Detected raw issue-details or evidence appendix section in the primary report.',
      recommendation: 'Keep report.md decision-oriented for executive/professional profiles; put raw details only in evidence-report.md or use --report-profile full intentionally.'
    });
  }

  const headings = countHeading2(markdown);
  const tableRows = countTableRows(markdown);
  const contentLines = countContentLines(markdown);
  if (profile === 'executive' && (markdown.length > 6000 || headings > 6 || tableRows > 30 || contentLines > 90)) {
    add(findings, {
      severity: 'warning',
      category: 'profile-depth',
      title: 'Executive report may be too detailed for a decision brief.',
      evidence: `length=${markdown.length}, h2=${headings}, tableRows=${tableRows}, contentLines=${contentLines}`,
      recommendation: 'Prefer a one-page sign-off/fix queue summary; keep raw evidence and large matrices in sidecar artifacts.'
    });
  }
  if (profile === 'professional' && (markdown.length > 20000 || headings > 14 || tableRows > 110 || contentLines > 220)) {
    add(findings, {
      severity: 'warning',
      category: 'profile-depth',
      title: 'Professional report may be too detailed for default review.',
      evidence: `length=${markdown.length}, h2=${headings}, tableRows=${tableRows}, contentLines=${contentLines}`,
      recommendation: 'Keep report.md focused on sign-off, proof-ready root causes, non-defect buckets, coverage gaps, and next actions; move selector-level evidence to evidence-report.md sidecars.'
    });
  }
}

function auditRawScoreCaveat(markdown: string, findings: ReportContentAuditFinding[]): void {
  if (!hasRawScoreCaveat(markdown)) {
    add(findings, {
      severity: 'warning',
      category: 'raw-score-caveat',
      title: 'Raw score appears without a trend-only/actionability caveat.',
      evidence: 'The report mentions Raw score but does not state that raw score is not the final quality/release decision.',
      recommendation: 'Add wording that raw score is a scanner trend signal; final decisions should use adjustedScore, qaSignoff, professionalSummary, defectProof, and qaCoverage.'
    });
  }
}

function auditCoverageBoundary(result: QaResult, markdown: string, findings: ReportContentAuditFinding[]): void {
  if (result.qaCoverage.status === 'sufficient') return;
  if (!hasCoverageBoundary(markdown)) {
    add(findings, {
      severity: 'warning',
      category: 'coverage-boundary',
      title: `QA coverage is ${result.qaCoverage.status} but the report does not clearly surface coverage gaps.`,
      evidence: `qaCoverage.status=${result.qaCoverage.status}; gaps=${result.qaCoverage.summary.partialCount + result.qaCoverage.summary.skippedCount + result.qaCoverage.summary.needsInputCount + result.qaCoverage.summary.failedCount}`,
      recommendation: 'Show skipped/partial/needs-input/failed rows as coverage boundaries; do not let readers interpret the run as full professional acceptance.'
    });
  }
}

function auditArtifactReference(result: QaResult, markdown: string, findings: ReportContentAuditFinding[]): void {
  if (result.artifactIntegrity.status === 'failed' && !markdown.includes('missing artifact') && !markdown.includes('missing ') && !markdown.includes('缺失')) {
    add(findings, {
      severity: 'warning',
      category: 'artifact-reference',
      title: 'Artifact integrity failed but the report does not visibly warn about missing evidence paths.',
      evidence: result.artifactIntegrity.summary,
      recommendation: 'Surface missing artifact paths inline or in the artifact integrity section before citing screenshots/videos/DOM as proof.'
    });
  }
  if (result.artifactIntegrity.status === 'warning' && result.artifactIntegrity.skippedCount > 0 && !/skipped|non-portable|unchecked|未检查|不可移植/.test(markdown)) {
    add(findings, {
      severity: 'warning',
      category: 'artifact-reference',
      title: 'Artifact integrity has unchecked/non-portable paths but the report does not surface them.',
      evidence: `skipped=${result.artifactIntegrity.skippedCount}; ${result.artifactIntegrity.summary}`,
      recommendation: 'Mention skipped/non-portable artifact paths so copied reports do not cite screenshots/videos/downloads that cannot be verified on this machine.'
    });
  }
}

function auditSummaryShape(result: QaResult, markdown: string, findings: ReportContentAuditFinding[]): void {
  const hasDecisionSignals = markdown.includes('QA sign-off') && markdown.includes('Adjusted score') && (markdown.includes('Fix queue') || markdown.includes('核心缺陷') || markdown.includes('Core fixes'));
  if (!hasDecisionSignals) {
    add(findings, {
      severity: 'warning',
      category: 'summary-shape',
      title: 'Primary report lacks core professional decision signals.',
      evidence: `profile=${result.metadata.config.report.profile}`,
      recommendation: 'Include QA sign-off, adjustedScore, proof-ready fix queue/root causes, non-defect buckets, and coverage caveats near the top.'
    });
  }
}

export function createSkippedReportContentAudit(profile: ReportProfile = 'professional', reason = 'Report content audit has not run yet.'): ReportContentAuditResult {
  return {
    status: 'skipped',
    checkedAt: new Date().toISOString(),
    profile,
    summary: {
      findingCount: 0,
      blockerCount: 0,
      warningCount: 0,
      infoCount: 0
    },
    findings: [],
    notes: [reason]
  };
}

export function runReportContentAudit(result: QaResult, markdown: string): ReportContentAuditResult {
  const findings: ReportContentAuditFinding[] = [];
  const profile = result.metadata.config.report.profile;

  auditForbiddenWording(result, markdown, findings);
  auditProfileDepth(profile, markdown, findings);
  auditRawScoreCaveat(markdown, findings);
  auditCoverageBoundary(result, markdown, findings);
  auditArtifactReference(result, markdown, findings);
  auditSummaryShape(result, markdown, findings);

  const blockerCount = findings.filter((item) => item.severity === 'blocker').length;
  const warningCount = findings.filter((item) => item.severity === 'warning').length;
  const infoCount = findings.filter((item) => item.severity === 'info').length;
  return {
    status: blockerCount > 0 ? 'failed' : warningCount > 0 ? 'warning' : 'passed',
    checkedAt: new Date().toISOString(),
    profile,
    summary: {
      findingCount: findings.length,
      blockerCount,
      warningCount,
      infoCount
    },
    findings,
    notes: [
      'Report content audit inspects the generated human-facing Markdown, not only result.json.',
      'It prevents forbidden overclaim wording, raw-evidence leakage or excessive detail in concise profiles, missing raw-score caveats, and hidden coverage/artifact boundaries.'
    ]
  };
}

export function formatReportContentAudit(audit: ReportContentAuditResult): string {
  const rows = audit.findings.map((finding) => `| ${markdownEscape(finding.id)} | ${markdownEscape(finding.severity)} | ${markdownEscape(finding.category)} | ${markdownEscape(finding.title)} | ${markdownEscape(truncateMiddle(finding.evidence, 180))} | ${markdownEscape(finding.recommendation)} |`);
  return `# FrontLens Report Content Audit

- Status: **${audit.status}**
- Profile: **${audit.profile}**
- Findings: ${audit.summary.findingCount}（blockers ${audit.summary.blockerCount}, warnings ${audit.summary.warningCount}, info ${audit.summary.infoCount}）

${rows.length ? ['| ID | Severity | Category | Finding | Evidence | Recommendation |', '| --- | --- | --- | --- | --- | --- |', ...rows, ''].join('\n') : 'No generated-report content problems found.'}

## Notes

${audit.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
