import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Download } from 'playwright';
import { ensureDir } from '../utils/fs.js';

export interface SavedDownloadArtifact {
  path: string;
  suggestedFilename?: string;
  sizeBytes: number;
  sha256: string;
}

type DownloadLike = Pick<Download, 'suggestedFilename' | 'saveAs'>;

export function sanitizeDownloadFilename(value: string | undefined, fallback = 'download.bin'): string {
  const base = path.basename(value || fallback).replace(/[\x00-\x1f\x7f/\\:?*"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  const cleaned = base.length > 0 ? base : fallback;
  return cleaned.slice(0, 180);
}

export async function saveDownloadArtifact(download: DownloadLike, outputDir: string, prefix: string): Promise<SavedDownloadArtifact> {
  const downloadDir = path.join(outputDir, 'downloads');
  await ensureDir(downloadDir);
  const suggestedFilename = sanitizeDownloadFilename(download.suggestedFilename(), 'download.bin');
  const filename = `${sanitizeDownloadFilename(prefix, 'download')}-${suggestedFilename}`;
  const filePath = path.join(downloadDir, filename);
  await download.saveAs(filePath);
  const bytes = await readFile(filePath);
  const info = await stat(filePath);
  return {
    path: filePath,
    suggestedFilename,
    sizeBytes: info.size,
    sha256: createHash('sha256').update(bytes).digest('hex')
  };
}
