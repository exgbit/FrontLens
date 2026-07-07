import type { SourceHealthResult, SourceHealthScript, SourceScriptCheck } from '../types.js';

export interface SourceScriptPlanNeed {
  needed: boolean;
  priority: 'P1' | 'P2' | 'P3';
  scripts: SourceHealthScript[];
  commands: string[];
  signals: string[];
}

const PROFESSIONAL_SCRIPT_CATEGORIES = new Set<SourceHealthScript['category']>(['build', 'typecheck', 'test', 'e2e', 'lint']);

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function rankCategory(category: SourceHealthScript['category']): number {
  return {
    build: 0,
    typecheck: 1,
    test: 2,
    e2e: 3,
    lint: 4,
    coverage: 5,
    other: 6
  }[category];
}

function invocationFor(packageManager: SourceHealthResult['packageManager'], scriptName: string): string {
  const runner = packageManager && packageManager !== 'unknown' ? packageManager : 'npm';
  if (runner === 'yarn') return `yarn run ${scriptName}`;
  if (runner === 'bun') return `bun run ${scriptName}`;
  if (runner === 'pnpm') return `pnpm run ${scriptName}`;
  return `npm run ${scriptName}`;
}

function checkedNames(scriptChecks: SourceScriptCheck[]): Set<string> {
  return new Set(scriptChecks
    .filter((check) => check.status === 'passed' || check.status === 'failed' || check.status === 'timed-out')
    .map((check) => check.scriptName)
  );
}

function representativeScripts(scripts: SourceHealthScript[]): SourceHealthScript[] {
  const byCategory = new Map<SourceHealthScript['category'], SourceHealthScript[]>();
  for (const script of scripts) byCategory.set(script.category, [...(byCategory.get(script.category) ?? []), script]);
  const selected: SourceHealthScript[] = [];
  for (const category of ['build', 'typecheck', 'test', 'e2e', 'lint'] as const) {
    const entries = (byCategory.get(category) ?? []).sort((a, b) => a.name.localeCompare(b.name));
    if (entries.length > 0) selected.push(entries[0]);
  }
  return selected.sort((a, b) => rankCategory(a.category) - rankCategory(b.category) || a.name.localeCompare(b.name));
}

export function buildSourceScriptPlanNeed(sourceHealth: SourceHealthResult): SourceScriptPlanNeed {
  if (!sourceHealth.enabled || sourceHealth.status === 'skipped' || sourceHealth.packageScripts.length === 0) {
    return { needed: false, priority: 'P3', scripts: [], commands: [], signals: [] };
  }
  const checked = checkedNames(sourceHealth.scriptChecks);
  const missing = representativeScripts(sourceHealth.packageScripts
    .filter((script) => PROFESSIONAL_SCRIPT_CATEGORIES.has(script.category))
    .filter((script) => !checked.has(script.name))
  );
  if (missing.length === 0) return { needed: false, priority: 'P3', scripts: [], commands: [], signals: [] };

  const highValue = missing.some((script) => script.category === 'build' || script.category === 'typecheck' || script.category === 'test' || script.category === 'e2e');
  return {
    needed: true,
    priority: highValue ? 'P1' : 'P2',
    scripts: missing,
    commands: unique(missing.map((script) => invocationFor(sourceHealth.packageManager, script.name))),
    signals: [
      `sourceHealth detected package scripts not executed in this QA run: ${missing.map((script) => `${script.name}(${script.category})`).join(', ')}.`,
      'Professional sign-off should include project-owned build/type/test/lint checks or explicitly accept the gap.'
    ]
  };
}
