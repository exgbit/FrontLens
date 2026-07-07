import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { Download } from 'playwright';
import type { DownloadContentSummary } from '../types.js';
import { ensureDir } from '../utils/fs.js';

export interface SavedDownloadArtifact {
  path: string;
  suggestedFilename?: string;
  sizeBytes: number;
  sha256: string;
  content: DownloadContentSummary;
}

type DownloadLike = Pick<Download, 'suggestedFilename' | 'saveAs'>;

export function sanitizeDownloadFilename(value: string | undefined, fallback = 'download.bin'): string {
  const base = path.basename(value || fallback).replace(/[\x00-\x1f\x7f/\\:?*"<>|]+/g, '_').replace(/\s+/g, ' ').trim();
  const cleaned = base.length > 0 ? base : fallback;
  return cleaned.slice(0, 180);
}

const textualExtensions = new Set(['.csv', '.tsv', '.txt', '.json', '.ndjson', '.xml', '.html', '.htm', '.md', '.log']);
const csvExtensions = new Set(['.csv', '.tsv']);
const jsonExtensions = new Set(['.json', '.ndjson']);
const mimeByExtension: Record<string, string> = {
  '.csv': 'text/csv',
  '.tsv': 'text/tab-separated-values',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.ndjson': 'application/x-ndjson',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.htm': 'text/html',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.zip': 'application/zip'
};

function previewText(value: string, max = 1200): string {
  return value.replace(/\uFEFF/g, '').replace(/\r\n/g, '\n').replace(/[\t ]+/g, ' ').trim().slice(0, max);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function isProbablyText(bytes: Buffer, extension: string): boolean {
  if (textualExtensions.has(extension)) return true;
  if (bytes.includes(0)) return false;
  const sample = bytes.subarray(0, Math.min(bytes.length, 4096));
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious += 1;
  }
  return sample.length === 0 || suspicious / sample.length < 0.05;
}

function topLevelType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

export function analyzeDownloadContent(bytes: Buffer, filename: string): DownloadContentSummary {
  const extension = path.extname(filename).toLowerCase();
  const base = {
    extension: extension || undefined,
    mimeGuess: mimeByExtension[extension]
  };
  if (bytes.length === 0) {
    return { ...base, kind: 'empty', parseStatus: 'failed', issue: 'Downloaded file is empty.' };
  }

  const probablyText = isProbablyText(bytes, extension);
  if (!probablyText) {
    return { ...base, kind: 'binary', parseStatus: 'skipped', issue: 'Binary download saved; format-specific content parsing was not attempted.' };
  }

  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const preview = previewText(text);
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim().length > 0);
  if (preview.length === 0) {
    return { ...base, kind: 'empty', parseStatus: 'failed', textPreview: '', lineCount: 0, issue: 'Downloaded text file has no non-whitespace content.' };
  }

  if (jsonExtensions.has(extension)) {
    if (extension === '.ndjson') {
      try {
        const parsed = lines.map((line) => JSON.parse(line) as unknown);
        return { ...base, kind: 'json', parseStatus: 'passed', textPreview: preview, lineCount: lines.length, rowCount: parsed.length, jsonTopLevelType: 'ndjson' };
      } catch (error) {
        return { ...base, kind: 'json', parseStatus: 'failed', textPreview: preview, lineCount: lines.length, issue: `NDJSON parse failed: ${error instanceof Error ? error.message : String(error)}` };
      }
    }
    try {
      const parsed = JSON.parse(text) as unknown;
      return { ...base, kind: 'json', parseStatus: 'passed', textPreview: preview, lineCount: lines.length, jsonTopLevelType: topLevelType(parsed), rowCount: Array.isArray(parsed) ? parsed.length : undefined };
    } catch (error) {
      return { ...base, kind: 'json', parseStatus: 'failed', textPreview: preview, lineCount: lines.length, issue: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}` };
    }
  }

  const delimiter = extension === '.tsv' ? '\t' : ',';
  const looksCsv = csvExtensions.has(extension) || (lines.length > 0 && splitCsvLine(lines[0], delimiter).length > 1);
  if (looksCsv) {
    const header = splitCsvLine(lines[0], delimiter);
    const rows = lines.slice(1).map((line) => splitCsvLine(line, delimiter));
    const inconsistent = rows.some((row) => row.length !== header.length);
    return {
      ...base,
      kind: 'csv',
      parseStatus: inconsistent ? 'warning' : 'passed',
      textPreview: preview,
      lineCount: lines.length,
      rowCount: Math.max(0, lines.length - 1),
      columnCount: header.length,
      headers: header.slice(0, 20),
      issue: inconsistent ? 'CSV rows have inconsistent column counts.' : undefined
    };
  }

  return { ...base, kind: 'text', parseStatus: 'passed', textPreview: preview, lineCount: lines.length };
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
    sha256: createHash('sha256').update(bytes).digest('hex'),
    content: analyzeDownloadContent(bytes, suggestedFilename)
  };
}
