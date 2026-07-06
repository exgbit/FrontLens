import { writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function report(result) {
  const summaryPath = path.join(result.artifacts.outputDir, 'custom-summary.txt');
  await writeFile(summaryPath, `score=${result.summary.score}\nissues=${result.summary.issueCount}\n`, 'utf8');
  result.artifacts.customSummary = summaryPath;
}
