import type { DefectProofResult, FixTask, FrontLensConfig, Issue, IssueCategory, RootCauseGroup } from '../types.js';
import { proofReadyRootCauseGroups } from '../proof/proofReadiness.js';

function ownerFor(issue: Issue): FixTask['owner'] {
  if (issue.ownerHint) return issue.ownerHint;
  if (issue.category === 'security') {
    const details = issue.evidence.details && typeof issue.evidence.details === 'object' ? issue.evidence.details as Record<string, unknown> : {};
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

function typeForCategory(category: IssueCategory): string {
  if (category === 'security') return 'security-hardening';
  if (category === 'backend-api-contract') return 'api-contract';
  if (category.startsWith('backend')) return 'backend-api';
  if (category.startsWith('integration')) return 'frontend-backend-integration';
  if (category === 'frontend-visual') return 'visual-regression';
  if (category.includes('performance') || category.startsWith('resource')) return 'performance';
  if (category === 'console-error') return 'runtime-error';
  return 'frontend-ui';
}

function typeFor(issue: Issue): string {
  return typeForCategory(issue.category);
}

function expectedChange(issue: Issue): string {
  return issue.suggestion.frontend ?? issue.suggestion.backend ?? issue.suggestion.product ?? issue.suggestion.test ?? issue.description;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function safeOutputName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-|-$/g, '') || 'root-cause';
}

export function generateFixTasks(issues: Issue[], config: FrontLensConfig, rootCauseGroups?: RootCauseGroup[], defectProof?: DefectProofResult): FixTask[] {
  if (rootCauseGroups) {
    const issueById = new Map(issues.map((issue) => [issue.id, issue]));
    return proofReadyRootCauseGroups(rootCauseGroups, defectProof)
      .map((group, index) => {
        const representative = group.issueIds.map((id) => issueById.get(id)).find((issue): issue is Issue => Boolean(issue));
        const verificationOutput = `reports/frontlens/verify-${safeOutputName(group.id || group.rootCauseKey)}`;
        return {
          id: `FIX-${String(index + 1).padStart(3, '0')}`,
          issueIds: group.issueIds,
          owner: group.owner,
          type: typeForCategory(group.categories[0] ?? 'unknown'),
          title: group.title,
          priority: group.priority,
          target: group.selectors[0] ?? group.networkRequestIds[0] ?? group.resourceUrls[0] ?? representative?.affectedUrl,
          expectedChange: group.suggestedFix,
          evidence: representative?.evidence ?? {},
          verificationCommand: `node dist/cli.js qa --url ${shellQuote(config.target.url)} --output ${shellQuote(verificationOutput)} --no-trace --json`
        };
      });
  }

  const actionable = issues.filter((issue) => issue.severity !== 'info');
  return actionable.map((issue, index) => {
    const verificationOutput = `reports/frontlens/verify-${issue.fingerprint ?? issue.id}`;
    return {
      id: `FIX-${String(index + 1).padStart(3, '0')}`,
      issueIds: [issue.id],
      owner: ownerFor(issue),
      type: typeFor(issue),
      title: issue.title,
      priority: issue.suggestion.priority ?? (issue.severity === 'critical' ? 'P0' : issue.severity === 'high' ? 'P1' : issue.severity === 'medium' ? 'P2' : 'P3'),
      target: issue.evidence.selector ?? issue.evidence.networkRequestId ?? issue.evidence.resourceUrl ?? issue.affectedUrl,
      expectedChange: expectedChange(issue),
      evidence: issue.evidence,
      verificationCommand: `node dist/cli.js qa --url ${shellQuote(config.target.url)} --output ${shellQuote(verificationOutput)} --no-trace --json`
    };
  });
}
