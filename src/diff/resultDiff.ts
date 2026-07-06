import path from 'node:path';
import type { Issue, QaResult, ResultDiff } from '../types.js';
import { writeJson, writeText, ensureDir } from '../utils/fs.js';

function byFingerprint(issues: Issue[]): Map<string, Issue> {
  return new Map(issues.map((issue) => [issue.fingerprint ?? `${issue.category}:${issue.title}`, issue]));
}

export function createResultDiff(before: QaResult, after: QaResult): ResultDiff {
  const beforeMap = byFingerprint(before.issues);
  const afterMap = byFingerprint(after.issues);
  const addedIssues = [...afterMap.entries()].filter(([fingerprint]) => !beforeMap.has(fingerprint)).map(([, issue]) => issue);
  const resolvedIssues = [...beforeMap.entries()].filter(([fingerprint]) => !afterMap.has(fingerprint)).map(([, issue]) => issue);
  const persistentIssues = [...afterMap.entries()].filter(([fingerprint]) => beforeMap.has(fingerprint)).map(([fingerprint, issue]) => ({ before: beforeMap.get(fingerprint)!, after: issue }));
  const changedSeverity = persistentIssues
    .filter((item) => item.before.severity !== item.after.severity)
    .map((item) => ({ fingerprint: item.after.fingerprint ?? '', before: item.before.severity, after: item.after.severity, title: item.after.title }));
  return {
    before: { url: before.summary.url, score: before.summary.score, issueCount: before.summary.issueCount, testedAt: before.summary.testedAt },
    after: { url: after.summary.url, score: after.summary.score, issueCount: after.summary.issueCount, testedAt: after.summary.testedAt },
    scoreDelta: after.summary.score - before.summary.score,
    addedIssues,
    resolvedIssues,
    persistentIssues,
    changedSeverity,
    securityScoreDelta: after.security && before.security ? after.security.score - before.security.score : undefined,
    performance: {
      fcpDeltaMs: after.performance.paint.firstContentfulPaintMs !== undefined && before.performance.paint.firstContentfulPaintMs !== undefined ? after.performance.paint.firstContentfulPaintMs - before.performance.paint.firstContentfulPaintMs : undefined,
      loadDeltaMs: after.performance.navigation?.loadMs !== undefined && before.performance.navigation?.loadMs !== undefined ? after.performance.navigation.loadMs - before.performance.navigation.loadMs : undefined,
      transferDeltaBytes: after.performance.resources.totalTransferSize - before.performance.resources.totalTransferSize
    }
  };
}

function issueRows(issues: Issue[]): string {
  if (!issues.length) return 'None.';
  return ['| Severity | Category | Title | Fingerprint |', '| --- | --- | --- | --- |', ...issues.map((issue) => `| ${issue.severity} | ${issue.category} | ${issue.title} | ${issue.fingerprint ?? '-'} |`)].join('\n');
}

export async function writeResultDiff(diff: ResultDiff, outputDir: string): Promise<{ json: string; markdown: string }> {
  await ensureDir(outputDir);
  const json = path.join(outputDir, 'diff.json');
  const markdown = path.join(outputDir, 'diff.md');
  await writeJson(json, diff);
  await writeText(
    markdown,
    `# FrontLens Result Diff

- Before: ${diff.before.url} / score ${diff.before.score} / issues ${diff.before.issueCount}
- After: ${diff.after.url} / score ${diff.after.score} / issues ${diff.after.issueCount}
- Score delta: ${diff.scoreDelta}
- Security score delta: ${diff.securityScoreDelta ?? '-'}

## Added Issues

${issueRows(diff.addedIssues)}

## Resolved Issues

${issueRows(diff.resolvedIssues)}

## Severity Changes

${diff.changedSeverity.length ? ['| Fingerprint | Title | Before | After |', '| --- | --- | --- | --- |', ...diff.changedSeverity.map((item) => `| ${item.fingerprint} | ${item.title} | ${item.before} | ${item.after} |`)].join('\n') : 'None.'}
`
  );
  return { json, markdown };
}
