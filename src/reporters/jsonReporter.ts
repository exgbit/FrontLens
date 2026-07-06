import path from 'node:path';
import type { QaResult } from '../types.js';
import { writeJson } from '../utils/fs.js';

export async function writeJsonReports(result: QaResult): Promise<void> {
  const outputDir = result.artifacts.outputDir;
  result.artifacts.jsonReport = path.join(outputDir, 'result.json');
  result.artifacts.pageModel = path.join(outputDir, 'page-model.json');
  result.artifacts.networkLog = path.join(outputDir, 'network.json');
  result.artifacts.consoleLog = path.join(outputDir, 'console.json');
  result.artifacts.resourcesLog = path.join(outputDir, 'resources.json');
  result.artifacts.coverageLog = path.join(outputDir, 'coverage.json');
  result.artifacts.realtimeLog = path.join(outputDir, 'realtime.json');
  result.artifacts.apiContractLog = path.join(outputDir, 'api-contract.json');
  result.artifacts.p2Log = path.join(outputDir, 'p2.json');

  await writeJson(result.artifacts.pageModel, result.pageModel);
  await writeJson(result.artifacts.networkLog, result.network.requests);
  await writeJson(result.artifacts.consoleLog, result.console);
  await writeJson(result.artifacts.resourcesLog, result.resources);
  await writeJson(result.artifacts.coverageLog, result.coverage);
  await writeJson(result.artifacts.realtimeLog, result.realtime);
  await writeJson(result.artifacts.apiContractLog, result.apiContract);
  await writeJson(result.artifacts.p2Log, result.p2);
  await writeJson(result.artifacts.jsonReport, result);
}
