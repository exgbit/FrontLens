import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { sanitizeDownloadFilename, saveDownloadArtifact } from '../src/downloads/downloadArtifact.ts';

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
  assert.equal((await stat(artifact.path)).isFile(), true);
});

test('sanitizeDownloadFilename removes path separators and unsupported characters', () => {
  assert.equal(sanitizeDownloadFilename('../../secret:report?.xlsx'), 'secret_report_.xlsx');
});
