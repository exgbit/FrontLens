import type { BrowserName, Issue, QaSummary } from './types.js';

function severityPenalty(issue: Issue): number {
  const base = (() => {
    switch (issue.severity) {
      case 'critical':
        return 25;
      case 'high':
        return 12;
      case 'medium':
        return 5;
      case 'low':
        return 2;
      case 'info':
        return 0;
    }
  })();
  if (base === 0) return 0;
  const confidence = issue.confidence ?? 1;
  const confidenceFactor = confidence < 0.6 ? 0.45 : confidence < 0.75 ? 0.75 : 1;
  return base * confidenceFactor;
}

function categoryKey(issue: Issue): string {
  return issue.category.split('-')[0] || issue.category;
}

export function calculateScore(issues: Issue[]): number {
  const penaltyByCategory = new Map<string, number>();
  for (const issue of issues) {
    const key = categoryKey(issue);
    penaltyByCategory.set(key, (penaltyByCategory.get(key) ?? 0) + severityPenalty(issue));
  }
  // Cap each broad category so one noisy rule family (for example security headers
  // or table heuristics) cannot drive the entire report to 0 by itself.
  const cappedPenalty = Array.from(penaltyByCategory.values()).reduce((sum, value) => sum + Math.min(35, value), 0);
  let score = Math.max(0, Math.min(100, Math.round(100 - cappedPenalty)));
  if (issues.some((issue) => issue.severity === 'critical')) {
    score = Math.min(score, 70);
  }
  if (issues.some((issue) => issue.severity === 'critical' && (issue.category === 'frontend-routing' || /页面打开失败|导航|白屏|首屏/.test(issue.title)))) {
    score = Math.min(score, 50);
  }
  return score;
}

export function buildSummary(input: {
  url: string;
  title: string;
  issues: Issue[];
  testedAt: string;
  browser: BrowserName;
  viewport: { width: number; height: number };
}): QaSummary {
  const count = (severity: Issue['severity']) => input.issues.filter((issue) => issue.severity === severity).length;
  return {
    url: input.url,
    title: input.title,
    score: calculateScore(input.issues),
    issueCount: input.issues.length,
    criticalCount: count('critical'),
    highCount: count('high'),
    mediumCount: count('medium'),
    lowCount: count('low'),
    infoCount: count('info'),
    testedAt: input.testedAt,
    browser: input.browser,
    viewport: input.viewport
  };
}
