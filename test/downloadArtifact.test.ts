import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { analyzeDownloadContent, sanitizeDownloadFilename, saveDownloadArtifact } from '../src/downloads/downloadArtifact.ts';

test('download artifacts are saved with sanitized name, size, and sha256', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-download-'));
  const source = path.join(dir, 'source.csv');
  await writeFile(source, 'id,name\n1,Alice\n', 'utf8');
  const artifact = await saveDownloadArtifact(
    {
      suggestedFilename: () => '../users?.csv',
      saveAs: async (target: string) => {
        await writeFile(target, await readFile(source));
      }
    },
    dir,
    'IT-001'
  );

  assert.equal(path.basename(artifact.path).includes('..'), false);
  assert.equal(artifact.suggestedFilename, 'users_.csv');
  assert.equal(artifact.sizeBytes, 16);
  assert.equal(artifact.sha256.length, 64);
  assert.equal(artifact.content.kind, 'csv');
  assert.equal(artifact.content.parseStatus, 'passed');
  assert.deepEqual(artifact.content.headers, ['id', 'name']);
  assert.equal(artifact.content.rowCount, 1);
  assert.match(artifact.content.textPreview ?? '', /Alice/);
  assert.equal((await stat(artifact.path)).isFile(), true);
});

test('sanitizeDownloadFilename removes path separators and unsupported characters', () => {
  assert.equal(sanitizeDownloadFilename('../../secret:report?.xlsx'), 'secret_report_.xlsx');
});

test('download content analysis validates json and flags invalid json', () => {
  const valid = analyzeDownloadContent(Buffer.from('[{\"id\":1}]'), 'users.json');
  assert.equal(valid.kind, 'json');
  assert.equal(valid.parseStatus, 'passed');
  assert.equal(valid.jsonTopLevelType, 'array');
  assert.equal(valid.rowCount, 1);

  const invalid = analyzeDownloadContent(Buffer.from('{bad json'), 'users.json');
  assert.equal(invalid.kind, 'json');
  assert.equal(invalid.parseStatus, 'failed');
  assert.match(invalid.issue ?? '', /JSON parse failed/);
});

test('download content analysis skips binary formats while preserving mime guess', () => {
  const binary = analyzeDownloadContent(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x01]), 'report.xlsx');
  assert.equal(binary.kind, 'binary');
  assert.equal(binary.parseStatus, 'skipped');
  assert.match(binary.mimeGuess ?? '', /spreadsheet/);
});
