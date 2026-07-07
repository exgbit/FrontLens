import path from 'node:path';
import { stat } from 'node:fs/promises';
import type { ArtifactIntegrityEntry, ArtifactIntegrityResult, QaResult } from '../types.js';

const FILE_ARTIFACT_KEYS = [
  'markdownReport',
  'evidenceReport',
  'professionalBrief',
  'qaReview',
  'jsonReport',
  'htmlReport',
  'screenshot',
  'trace',
  'domSnapshot',
  'htmlSnapshot',
  'networkLog',
  'consoleLog',
  'resourcesLog',
  'coverageLog',
  'realtimeLog',
  'apiContractLog',
  'p2Log',
  'testDataLog',
  'professionalSummaryLog',
  'regressionPlanLog',
  'scopeReview',
  'scopeReviewLog',
  'claimGuard',
  'claimGuardLog',
  'qaIntake',
  'qaIntakeLog',
  'defectProof',
  'defectProofLog',
  'sourceAnalysisLog',
  'sourceRuntimeLog',
  'sourceHealthLog',
  'pageModel'
] as const;

function isUrl(value: string): boolean {
  return /^(https?:|data:|blob:|about:)/i.test(value);
}

function isWindowsAbsolutePath(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^\\\\/.test(value);
}

function toAbsolutePath(outputDir: string, value: string): string | undefined {
  if (!value || isUrl(value)) return undefined;
  if (path.isAbsolute(value)) return value;
  if (isWindowsAbsolutePath(value)) return undefined;
  return path.resolve(outputDir, value);
}

function pushFile(entries: Array<Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>>, source: string, value: unknown, outputDir: string, options: { issueId?: string; expected?: boolean } = {}): void {
  if (typeof value !== 'string' || value.length === 0) return;
  const absolutePath = toAbsolutePath(outputDir, value);
  entries.push({
    source,
    path: value,
    absolutePath,
    kind: 'file',
    expected: options.expected ?? Boolean(absolutePath),
    issueId: options.issueId,
    message: absolutePath ? undefined : 'Non-local or unsupported path; existence check skipped.'
  });
}

function pushDirectory(entries: Array<Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>>, source: string, value: unknown, outputDir: string, expected: boolean): void {
  if (!expected || typeof value !== 'string' || value.length === 0) return;
  const absolutePath = toAbsolutePath(outputDir, value);
  entries.push({
    source,
    path: value,
    absolutePath,
    kind: 'directory',
    expected,
    message: absolutePath ? undefined : 'Non-local or unsupported path; existence check skipped.'
  });
}

async function resolveEntry(entry: Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>): Promise<ArtifactIntegrityEntry> {
  if (!entry.absolutePath || !entry.expected) {
    return { ...entry, exists: false };
  }
  try {
    const item = await stat(entry.absolutePath);
    const typeMatches = entry.kind === 'directory' ? item.isDirectory() : item.isFile();
    return {
      ...entry,
      exists: typeMatches,
      sizeBytes: item.isFile() ? item.size : undefined,
      message: typeMatches ? undefined : `Path exists but is not a ${entry.kind}.`
    };
  } catch {
    return { ...entry, exists: false, message: 'Referenced artifact path does not exist.' };
  }
}

function dedupeEntries(entries: Array<Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>>): Array<Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>> {
  const seen = new Set<string>();
  const unique: Array<Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>> = [];
  for (const entry of entries) {
    const key = `${entry.kind}:${entry.absolutePath ?? entry.path}:${entry.source}:${entry.issueId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(entry);
  }
  return unique;
}

export function createEmptyArtifactIntegrity(message = 'Artifact integrity was not checked yet.'): ArtifactIntegrityResult {
  return {
    status: 'skipped',
    checkedAt: new Date().toISOString(),
    presentCount: 0,
    missingCount: 0,
    skippedCount: 0,
    entries: [],
    missing: [],
    summary: message
  };
}

export async function buildArtifactIntegrity(result: QaResult): Promise<ArtifactIntegrityResult> {
  const outputDir = result.artifacts.outputDir;
  const candidates: Array<Omit<ArtifactIntegrityEntry, 'exists' | 'sizeBytes'>> = [];

  pushDirectory(candidates, 'artifacts.outputDir', outputDir, outputDir, true);
  pushDirectory(candidates, 'artifacts.videoDir', result.artifacts.videoDir, outputDir, Boolean(result.metadata.config.report.video || (result.artifacts.videoFiles?.length ?? 0) > 0));
  pushDirectory(candidates, 'artifacts.downloadDir', result.artifacts.downloadDir, outputDir, (result.artifacts.downloadedFiles?.length ?? 0) > 0);
  for (const key of FILE_ARTIFACT_KEYS) {
    pushFile(candidates, `artifacts.${key}`, result.artifacts[key], outputDir, { expected: true });
  }
  for (const [index, file] of (result.artifacts.videoFiles ?? []).entries()) {
    pushFile(candidates, `artifacts.videoFiles[${index}]`, file, outputDir, { expected: true });
  }
  for (const [index, file] of (result.artifacts.downloadedFiles ?? []).entries()) {
    pushFile(candidates, `artifacts.downloadedFiles[${index}]`, file, outputDir, { expected: true });
  }

  for (const issue of result.issues) {
    pushFile(candidates, `issues.${issue.id}.evidence.screenshot`, issue.evidence.screenshot, outputDir, { issueId: issue.id, expected: true });
    pushFile(candidates, `issues.${issue.id}.evidence.dom`, issue.evidence.dom, outputDir, { issueId: issue.id, expected: true });
  }
  for (const [index, check] of result.responsiveChecks.entries()) {
    pushFile(candidates, `responsiveChecks[${index}].screenshot`, check.screenshot, outputDir, { expected: true });
  }
  for (const [index, test] of result.interactionTests.entries()) {
    pushFile(candidates, `interactionTests[${index}].observations.downloadPath`, test.observations.downloadPath, outputDir, { expected: Boolean(test.observations.downloadPath) });
  }
  for (const [journeyIndex, journey] of result.journeyTests.entries()) {
    for (const [stepIndex, step] of journey.steps.entries()) {
      pushFile(candidates, `journeyTests[${journeyIndex}].steps[${stepIndex}].downloadPath`, step.downloadPath, outputDir, { expected: Boolean(step.downloadPath) });
    }
  }
  pushFile(candidates, 'p2.visual.currentScreenshot', result.p2.visual.currentScreenshot, outputDir, { expected: true });
  pushFile(candidates, 'p2.visual.baselinePath', result.p2.visual.baselinePath, outputDir, { expected: true });
  pushFile(candidates, 'p2.visual.diffScreenshot', result.p2.visual.diffScreenshot, outputDir, { expected: result.p2.visual.status === 'failed' || result.p2.visual.status === 'passed' });
  for (const [index, profile] of result.p2.networkProfiles.entries()) {
    pushFile(candidates, `p2.networkProfiles[${index}].screenshot`, profile.screenshot, outputDir, { expected: true });
  }
  pushFile(candidates, 'aiAnalysis.contextPath', result.aiAnalysis.contextPath, outputDir, { expected: true });
  pushFile(candidates, 'aiAnalysis.rawOutputPath', result.aiAnalysis.rawOutputPath, outputDir, { expected: true });

  const entries = await Promise.all(dedupeEntries(candidates).map(resolveEntry));
  const skipped = entries.filter((entry) => !entry.expected || !entry.absolutePath);
  const checked = entries.filter((entry) => entry.expected && entry.absolutePath);
  const missing = checked.filter((entry) => !entry.exists);
  const present = checked.filter((entry) => entry.exists);
  const status: ArtifactIntegrityResult['status'] = missing.length > 0 ? 'failed' : skipped.length > 0 ? 'warning' : checked.length > 0 ? 'passed' : 'skipped';
  return {
    status,
    checkedAt: new Date().toISOString(),
    presentCount: present.length,
    missingCount: missing.length,
    skippedCount: skipped.length,
    entries,
    missing,
    summary: status === 'passed'
      ? `All ${present.length} referenced local artifacts exist.`
      : status === 'failed'
        ? `${missing.length} referenced artifact path(s) are missing.`
        : status === 'warning'
          ? `${present.length} artifacts exist; ${skipped.length} path(s) were skipped because they are non-local or unsupported.`
          : 'No artifact paths were available to check.'
  };
}
