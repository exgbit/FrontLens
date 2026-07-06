import path from 'node:path';
import type { Page } from 'playwright';
import type { ArtifactIndex, FrontLensConfig, ResourceRecord } from '../types.js';
import { ensureDir, writeText } from '../utils/fs.js';
import { redactText, redactUrl } from '../utils/redact.js';

export class EvidenceCollector {
  constructor(private readonly config: FrontLensConfig, private readonly artifacts: ArtifactIndex) {}

  async prepare(): Promise<void> {
    await ensureDir(this.artifacts.outputDir);
    await ensureDir(path.join(this.artifacts.outputDir, 'screenshots'));
    await ensureDir(path.join(this.artifacts.outputDir, 'artifacts'));
    if (this.config.report.video) {
      await ensureDir(path.join(this.artifacts.outputDir, 'videos'));
    }
  }

  async capturePageArtifacts(page: Page): Promise<void> {
    if (this.config.report.screenshot) {
      const screenshotPath = path.join(this.artifacts.outputDir, 'screenshots', 'page-full.png');
      const buffer = await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => null);
      if (buffer) {
        this.artifacts.screenshot = screenshotPath;
      }
    }

    if (this.config.report.domSnapshot) {
      const htmlPath = path.join(this.artifacts.outputDir, 'artifacts', 'dom-snapshot.html');
      const html = await page.content().catch(() => undefined);
      if (html !== undefined) {
        await writeText(htmlPath, redactText(html));
        this.artifacts.domSnapshot = htmlPath;
        this.artifacts.htmlSnapshot = htmlPath;
      }
    }
  }

  async collectResources(page: Page): Promise<ResourceRecord[]> {
    const resources = await page.evaluate<ResourceRecord[]>(() => {
      return performance
        .getEntriesByType('resource')
        .map((entry) => {
          const resource = entry as PerformanceResourceTiming;
          return {
            name: resource.name,
            initiatorType: resource.initiatorType,
            durationMs: Math.round(resource.duration),
            transferSize: resource.transferSize,
            encodedBodySize: resource.encodedBodySize,
            decodedBodySize: resource.decodedBodySize,
            startTime: Math.round(resource.startTime)
          };
        })
        .sort((a, b) => b.durationMs - a.durationMs);
    });
    return resources.map((resource) => ({ ...resource, name: redactUrl(resource.name) }));
  }
}
