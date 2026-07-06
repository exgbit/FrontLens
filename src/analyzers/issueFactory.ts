import type { Issue, IssueCategory, IssueEvidence, IssueSuggestion, Severity } from '../types.js';
import { createIssueId, createStableFingerprint } from '../utils/id.js';

export class IssueFactory {
  private counter = 0;

  create(input: {
    title: string;
    category: IssueCategory;
    severity: Severity;
    confidence?: number;
    description: string;
    evidence?: IssueEvidence;
    reproduceSteps?: string[];
    reason: string;
    suggestion: IssueSuggestion;
    source?: Issue['source'];
  }): Issue {
    const issue: Issue = {
      id: createIssueId(++this.counter),
      title: input.title,
      category: input.category,
      severity: input.severity,
      confidence: input.confidence ?? 0.9,
      description: input.description,
      evidence: input.evidence ?? {},
      reproduceSteps: input.reproduceSteps ?? ['打开目标页面', '观察页面、接口、Console 与采集证据'],
      reason: input.reason,
      suggestion: input.suggestion,
      source: input.source ?? 'rule'
    };
    issue.fingerprint = createStableFingerprint([
      issue.category,
      issue.severity,
      issue.title,
      issue.evidence.networkRequestId,
      issue.evidence.consoleId,
      issue.evidence.pageErrorId,
      issue.evidence.selector,
      issue.evidence.resourceUrl
    ]);
    return issue;
  }
}
