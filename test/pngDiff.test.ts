import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { decodePng, diffPngFiles, encodePng } from '../src/p2/pngDiff.ts';

test('PNG visual diff reports changed pixels and writes diff artifact', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'frontlens-png-diff-'));
  const baselinePath = path.join(dir, 'baseline.png');
  const currentPath = path.join(dir, 'current.png');
  const diffPath = path.join(dir, 'diff.png');
  const baseline = new Uint8Array([
    255, 255, 255, 255, 255, 255, 255, 255,
    255, 255, 255, 255, 255, 255, 255, 255
  ]);
  const current = new Uint8Array(baseline);
  current[4] = 0;
  current[5] = 0;
  current[6] = 0;
  await writeFile(baselinePath, encodePng({ width: 2, height: 2, rgba: baseline }));
  await writeFile(currentPath, encodePng({ width: 2, height: 2, rgba: current }));

  const result = await diffPngFiles(currentPath, baselinePath, diffPath, 16);
  assert.equal(result.totalPixels, 4);
  assert.equal(result.changedPixels, 1);
  assert.equal(result.ratio, 0.25);
  assert.deepEqual(result.boundingBox, { x: 1, y: 0, width: 1, height: 1 });

  const diff = decodePng(await readFile(diffPath));
  assert.equal(diff.width, 2);
  assert.equal(diff.height, 2);
  assert.equal(diff.rgba[4], 230);
});
