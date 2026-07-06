import type { FixTask, FrontLensConfig, Issue } from '../types.js';

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

function typeFor(issue: Issue): string {
  if (issue.category === 'security') return 'security-hardening';
  if (issue.category === 'backend-api-contract') return 'api-contract';
  if (issue.category.startsWith('backend')) return 'backend-api';
  if (issue.category.startsWith('integration')) return 'frontend-backend-integration';
  if (issue.category === 'frontend-visual') return 'visual-regression';
  if (issue.category.includes('performance') || issue.category.startsWith('resource')) return 'performance';
  if (issue.category === 'console-error') return 'runtime-error';
  return 'frontend-ui';
}

function expectedChange(issue: Issue): string {
  return issue.suggestion.frontend ?? issue.suggestion.backend ?? issue.suggestion.product ?? issue.suggestion.test ?? issue.description;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function generateFixTasks(issues: Issue[], config: FrontLensConfig): FixTask[] {
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
