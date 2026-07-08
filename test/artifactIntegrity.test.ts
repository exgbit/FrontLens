import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { normalizeResult } from '../src/resultNormalizer.ts';
import { buildArtifactIntegrity } from '../src/artifacts/artifactIntegrity.ts';
import { buildQualityGate } from '../src/qualityGate.ts';
import { assignJsonArtifactPaths } from '../src/reporters/jsonReporter.ts';

test('artifact integrity detects missing issue evidence paths', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-artifacts-'));
  const screenshot = path.join(dir, 'page.png');
  await writeFile(screenshot, 'png', 'utf8');
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Example' },
    artifacts: { outputDir: dir, screenshot },
    pageModel: { url: 'https://example.com', title: 'Example', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'ok' } },
    issues: [
      {
        id: 'ISSUE-001',
        title: 'Evidence missing',
        category: 'frontend-ui',
        severity: 'low',
        confidence: 0.9,
        description: 'missing dom evidence',
        evidence: { screenshot, dom: path.join(dir, 'missing-dom.html') },
        reproduceSteps: [],
        reason: 'test',
        suggestion: { test: 'fix artifact', priority: 'P3' }
      }
    ]
  });

  const integrity = await buildArtifactIntegrity(result);
  assert.equal(integrity.status, 'failed');
  assert.equal(integrity.missingCount, 1);
  assert.equal(integrity.missing[0].source, 'issues.ISSUE-001.evidence.dom');
  assert.equal(integrity.presentCount >= 2, true);
});

test('artifact integrity failures become QA gate coverage gaps', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-artifacts-gate-'));
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Example' },
    artifacts: { outputDir: dir },
    pageModel: { url: 'https://example.com', title: 'Example', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'ok' } },
    journeyTests: [{ id: 'JOURNEY-001', name: 'smoke', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, startUrl: 'https://example.com', steps: [] }],
    interactionTests: [{ id: 'IT-001', kind: 'search', target: 'search', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, actions: [], observations: {} }],
    exceptionSimulations: [{ id: 'EX-001', kind: 'page-refresh', status: 'passed', startedAt: '', endedAt: '', durationMs: 0, observations: {} }],
    issues: [
      {
        id: 'ISSUE-001',
        title: 'Missing screenshot reference',
        category: 'frontend-ui',
        severity: 'info',
        confidence: 0.5,
        description: 'reference-only',
        evidence: { screenshot: path.join(dir, 'missing.png') },
        reproduceSteps: [],
        reason: 'test',
        suggestion: { test: 'fix artifact', priority: 'P3' }
      }
    ]
  });
  const artifactIntegrity = await buildArtifactIntegrity(result);
  const gate = buildQualityGate({
    issues: result.issues,
    pageModel: result.pageModel,
    phaseErrors: [],
    interactionTests: result.interactionTests,
    journeyTests: result.journeyTests,
    exceptionSimulations: result.exceptionSimulations,
    coverage: result.coverage,
    security: result.security,
    requirementCoverage: result.requirementCoverage,
    artifactIntegrity
  });
  assert.equal(gate.status, 'pass-with-risks');
  assert.equal(gate.coverageGaps.some((gap) => gap.includes('证据产物')), true);
});

test('artifact integrity tracks generated JSON sidecars before report writing', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-artifacts-sidecars-'));
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Example' },
    artifacts: { outputDir: dir },
    pageModel: { url: 'https://example.com', title: 'Example', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'ok' } }
  });
  assignJsonArtifactPaths(result);
  const integrity = await buildArtifactIntegrity(result);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.sourceAnalysisLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.sourceRuntimeLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.sourceHealthLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.professionalSummaryLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.regressionPlanLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.claimGuardLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.qaIntakeLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.defectProofLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.journeyAssertionAuditLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.assertionSuggestionsLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.businessJourneysLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.reviewCalibrationLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.reviewCalibrationConfig'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.testCasesLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.riskRegisterLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.riskAcceptanceLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.automationSpecsLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.evidenceBundleLog'), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.testStrategyLog'), true);
});

test('artifact integrity verifies downloaded files referenced by interaction observations', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-artifacts-downloads-'));
  const downloadPath = path.join(dir, 'downloads', 'export.csv');
  await mkdir(path.dirname(downloadPath), { recursive: true });
  await writeFile(downloadPath, 'id,name\n1,Alice\n', 'utf8');
  const result = normalizeResult({
    summary: { url: 'https://example.com', title: 'Example' },
    artifacts: { outputDir: dir, downloadDir: path.dirname(downloadPath), downloadedFiles: [downloadPath] },
    pageModel: { url: 'https://example.com', title: 'Example', stats: { domNodes: 10, visibleTextLength: 20, bodyTextSample: 'ok' } },
    interactionTests: [
      {
        id: 'IT-001',
        kind: 'download',
        target: 'Export',
        status: 'passed',
        startedAt: '',
        endedAt: '',
        durationMs: 0,
        actions: [],
        observations: { downloadPath, downloadSizeBytes: 16 }
      }
    ]
  });
  const integrity = await buildArtifactIntegrity(result);
  assert.equal(integrity.entries.some((entry) => entry.source === 'interactionTests[0].observations.downloadPath' && entry.exists), true);
  assert.equal(integrity.entries.some((entry) => entry.source === 'artifacts.downloadedFiles[0]' && entry.exists), true);
});
