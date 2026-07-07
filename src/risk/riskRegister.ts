import type { ArtifactIntegrityResult, QaCoverageMatrixItem, QaExecutionPlanItem, QaResult, QaSignoffResult, RiskRegisterItem, RiskRegisterResult, RiskRegisterCategory, RiskRegisterImpact, RiskRegisterLikelihood, SourceHealthResult, TestDataAssessmentResult } from '../types.js';
import { markdownEscape } from '../utils/text.js';

export type RiskRegisterInput = Pick<
  QaResult,
  | 'professionalSummary'
  | 'qaSignoff'
  | 'qaCoverage'
  | 'qaPlan'
  | 'regressionPlan'
  | 'environment'
  | 'sourceHealth'
  | 'testData'
  | 'artifactIntegrity'
>;

const IMPACT_SCORE: Record<RiskRegisterImpact, number> = { critical: 4, high: 3, medium: 2, low: 1 };
const LIKELIHOOD_SCORE: Record<RiskRegisterLikelihood, number> = { high: 3, medium: 2, low: 1 };

function impactFromPriority(priority: 'P0' | 'P1' | 'P2' | 'P3'): RiskRegisterImpact {
  return priority === 'P0' ? 'critical' : priority === 'P1' ? 'high' : priority === 'P2' ? 'medium' : 'low';
}

function riskLevel(exposure: number): RiskRegisterItem['level'] {
  if (exposure >= 10) return 'critical';
  if (exposure >= 7) return 'high';
  if (exposure >= 4) return 'medium';
  return 'low';
}

function categoryFromQaPlan(item: QaExecutionPlanItem): RiskRegisterCategory {
  if (item.type === 'environment') return 'environment';
  if (item.type === 'test-data') return 'test-data';
  if (item.type === 'source-health') return 'source-health';
  if (item.type === 'artifact-integrity' || item.type === 'download') return 'artifact';
  if (item.type === 'product-context') return 'product-scope';
  if (item.type === 'role-matrix') return 'permission';
  if (item.type === 'requirement' || item.type === 'journey') return 'coverage';
  if (item.type === 'root-cause' || item.type === 'defect-proof') return 'defect';
  return 'release';
}

function categoryFromCoverage(item: QaCoverageMatrixItem): RiskRegisterCategory {
  if (item.area === 'environment' || item.area === 'performance' || item.area === 'security') return 'environment';
  if (item.area === 'source') return 'source-health';
  if (item.area === 'test-data') return 'test-data';
  if (item.area === 'artifact') return 'artifact';
  if (item.area === 'product-scope') return 'product-scope';
  if (item.area === 'requirements' || item.area === 'journey' || item.area === 'interaction' || item.area === 'exception') return 'coverage';
  return 'release';
}

function normalizeKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function addRisk(items: RiskRegisterItem[], input: Omit<RiskRegisterItem, 'id' | 'exposure' | 'level'>): void {
  const exposure = IMPACT_SCORE[input.impact] * LIKELIHOOD_SCORE[input.likelihood];
  const key = `${input.category}:${normalizeKey(input.title)}`;
  const existing = items.findIndex((item) => `${item.category}:${normalizeKey(item.title)}` === key);
  const next: RiskRegisterItem = {
    ...input,
    id: `RISK-${String(items.length + 1).padStart(3, '0')}`,
    exposure,
    level: input.blocksRelease ? (exposure >= 7 ? riskLevel(exposure) : 'high') : riskLevel(exposure),
    evidenceRefs: [...new Set(input.evidenceRefs.filter(Boolean))]
  };
  if (existing === -1) {
    items.push(next);
    return;
  }
  const current = items[existing];
  const strongerExposure = next.exposure > current.exposure ? next : current;
  items[existing] = {
    ...strongerExposure,
    id: current.id,
    blocksRelease: current.blocksRelease || next.blocksRelease,
    evidenceRefs: [...new Set([...current.evidenceRefs, ...next.evidenceRefs])],
    mitigation: [...new Set([current.mitigation, next.mitigation])].join('；'),
    verification: [...new Set([current.verification, next.verification])].join('；')
  };
}

function sourceHealthRisk(sourceHealth: SourceHealthResult): Omit<RiskRegisterItem, 'id' | 'exposure' | 'level'> | undefined {
  if (sourceHealth.status !== 'failed') return undefined;
  return {
    category: 'source-health',
    title: '源码健康检查失败',
    impact: sourceHealth.syntaxErrorCount > 0 ? 'critical' : 'high',
    likelihood: 'high',
    status: 'blocked',
    owner: 'frontend',
    blocksRelease: true,
    evidenceRefs: ['sourceHealth', ...sourceHealth.findings.slice(0, 5).map((finding) => finding.id), ...sourceHealth.scriptChecks.filter((check) => check.status === 'failed' || check.status === 'timed-out').map((check) => check.id)],
    trigger: 'sourceHealth.status=failed',
    mitigation: '修复语法错误或失败的源码脚本，必要时补 CI/本地脚本证据。',
    verification: '重跑 FrontLens 并确认 sourceHealth.status 不再 failed，相关 scriptChecks passed。'
  };
}

function artifactRisk(artifactIntegrity: ArtifactIntegrityResult): Omit<RiskRegisterItem, 'id' | 'exposure' | 'level'> | undefined {
  if (artifactIntegrity.status !== 'failed') return undefined;
  return {
    category: 'artifact',
    title: '报告证据路径缺失，影响缺陷复核',
    impact: 'high',
    likelihood: 'high',
    status: 'blocked',
    owner: 'test',
    blocksRelease: true,
    evidenceRefs: ['artifactIntegrity'],
    trigger: artifactIntegrity.summary,
    mitigation: '修复缺失截图/DOM/下载/JSON sidecar 引用或重新生成报告。',
    verification: 'artifactIntegrity.status 为 passed 或仅有可接受 warning。'
  };
}

function testDataRisk(testData: TestDataAssessmentResult): Omit<RiskRegisterItem, 'id' | 'exposure' | 'level'> | undefined {
  if (testData.status !== 'failed' && testData.status !== 'warning') return undefined;
  const failed = testData.status === 'failed';
  return {
    category: 'test-data',
    title: failed ? '测试数据生命周期阻断发布验收' : '测试数据生命周期存在风险',
    impact: failed ? 'critical' : 'high',
    likelihood: 'high',
    status: failed ? 'blocked' : 'open',
    owner: 'test',
    blocksRelease: failed,
    evidenceRefs: ['testData', ...testData.findings.slice(0, 5).map((finding) => finding.id)],
    trigger: testData.findings.slice(0, 2).map((finding) => finding.message).join('；') || testData.status,
    mitigation: '补充隔离记录、setup/cleanup/rollback、敏感数据处理和生产写入授权。',
    verification: 'testData.status 为 passed，或风险被产品/QA 明确接受。'
  };
}

function signoffStatusRank(status: QaSignoffResult['status']): number {
  return { pass: 0, 'pass-with-risks': 1, fail: 2, blocked: 3 }[status];
}

export function buildRiskRegister(result: RiskRegisterInput): RiskRegisterResult {
  const items: RiskRegisterItem[] = [];

  for (const blocker of result.qaSignoff.blockers.slice(0, 10)) {
    addRisk(items, {
      category: 'release',
      title: blocker,
      impact: 'critical',
      likelihood: 'high',
      status: 'blocked',
      owner: 'test',
      blocksRelease: true,
      evidenceRefs: ['qaSignoff.blockers', 'qualityGate'],
      trigger: blocker,
      mitigation: '先修复阻断或补齐证据，再进入发布/业务验收签核。',
      verification: 'qaSignoff.status 不为 blocked/fail，且 blocker 从 qaSignoff.blockers 中消失。'
    });
  }

  for (const risk of result.qaSignoff.risks.slice(0, 8)) {
    addRisk(items, {
      category: 'release',
      title: risk,
      impact: 'high',
      likelihood: 'medium',
      status: 'open',
      owner: 'test',
      blocksRelease: result.qaSignoff.status === 'fail' || result.qaSignoff.status === 'blocked',
      evidenceRefs: ['qaSignoff.risks'],
      trigger: risk,
      mitigation: '补充对应环境、需求、角色、测试数据或证据后复测。',
      verification: 'qaSignoff.risks 不再包含该项，或风险被显式接受。'
    });
  }

  for (const item of result.professionalSummary.mustFix) {
    addRisk(items, {
      category: 'defect',
      title: item.title,
      impact: impactFromPriority(item.priority),
      likelihood: 'high',
      status: item.priority === 'P0' ? 'blocked' : 'open',
      owner: item.owner,
      blocksRelease: item.priority === 'P0' || item.priority === 'P1',
      evidenceRefs: item.evidenceRefs,
      trigger: item.rationale,
      mitigation: item.action,
      verification: '修复后重跑 FrontLens，确认该 must-fix 不再出现在 professionalSummary.mustFix。'
    });
  }

  for (const item of result.professionalSummary.shouldFix) {
    addRisk(items, {
      category: 'defect',
      title: item.title,
      impact: impactFromPriority(item.priority),
      likelihood: 'medium',
      status: 'open',
      owner: item.owner,
      blocksRelease: false,
      evidenceRefs: item.evidenceRefs,
      trigger: item.rationale,
      mitigation: item.action,
      verification: '修复后重跑 FrontLens，确认该 should-fix 不再出现或被产品/QA 接受。'
    });
  }

  for (const coverage of result.qaCoverage.items.filter((item) => item.status === 'failed' || item.status === 'needs-input' || item.status === 'skipped').slice(0, 12)) {
    addRisk(items, {
      category: categoryFromCoverage(coverage),
      title: coverage.title,
      impact: coverage.status === 'failed' ? 'high' : coverage.area === 'requirements' || coverage.area === 'journey' ? 'high' : 'medium',
      likelihood: coverage.status === 'failed' ? 'high' : 'medium',
      status: coverage.status === 'failed' ? 'blocked' : 'open',
      owner: coverage.area === 'product-scope' ? 'product' : 'test',
      blocksRelease: coverage.status === 'failed' || (coverage.status === 'needs-input' && (coverage.area === 'requirements' || coverage.area === 'journey' || coverage.area === 'test-data')),
      evidenceRefs: coverage.evidenceRefs,
      trigger: coverage.gaps.slice(0, 2).join('；') || coverage.status,
      mitigation: coverage.nextSteps.slice(0, 3).join('；') || '补齐覆盖或明确接受缺口。',
      verification: `qaCoverage item ${coverage.id} 不再为 failed/needs-input/skipped。`
    });
  }

  for (const plan of result.qaPlan.items.filter((item) => item.status !== 'ready' && (item.priority === 'P0' || item.priority === 'P1')).slice(0, 10)) {
    addRisk(items, {
      category: categoryFromQaPlan(plan),
      title: plan.title,
      impact: impactFromPriority(plan.priority),
      likelihood: plan.status === 'blocked' ? 'high' : 'medium',
      status: plan.status === 'blocked' ? 'blocked' : 'open',
      owner: plan.owner,
      blocksRelease: plan.priority === 'P0' || (plan.priority === 'P1' && (plan.type === 'requirement' || plan.type === 'journey' || plan.type === 'test-data' || plan.type === 'source-health')),
      evidenceRefs: plan.evidenceRefs,
      trigger: plan.why,
      mitigation: plan.steps.join('；'),
      verification: plan.expected.join('；') || 'qaPlan 项完成或被明确接受为范围外。'
    });
  }

  const sourceRisk = sourceHealthRisk(result.sourceHealth);
  if (sourceRisk) addRisk(items, sourceRisk);
  const artifact = artifactRisk(result.artifactIntegrity);
  if (artifact) addRisk(items, artifact);
  const dataRisk = testDataRisk(result.testData);
  if (dataRisk) addRisk(items, dataRisk);

  if (result.environment.trust.businessSignoff === 'low' || result.environment.trust.performance === 'low' || result.environment.trust.security === 'low') {
    addRisk(items, {
      category: 'environment',
      title: '当前环境不足以支撑完整发布签核',
      impact: result.environment.trust.businessSignoff === 'low' ? 'high' : 'medium',
      likelihood: 'high',
      status: 'open',
      owner: 'test',
      blocksRelease: result.environment.trust.businessSignoff === 'low',
      evidenceRefs: ['environment'],
      trigger: `environment=${result.environment.kind}; trust=${result.environment.trust.performance}/${result.environment.trust.security}/${result.environment.trust.businessSignoff}`,
      mitigation: '使用 build+preview、staging 或生产等价 HTTPS 环境复测性能、安全和发布签核。',
      verification: 'environment.trust.performance/security/businessSignoff 满足发布范围，或风险被明确接受。'
    });
  }

  const sorted = items.sort((a, b) => b.exposure - a.exposure || Number(b.blocksRelease) - Number(a.blocksRelease) || a.id.localeCompare(b.id));
  const criticalCount = sorted.filter((item) => item.level === 'critical').length;
  const highCount = sorted.filter((item) => item.level === 'high').length;
  const blockedCount = sorted.filter((item) => item.status === 'blocked').length;
  const releaseBlockingCount = sorted.filter((item) => item.blocksRelease).length;
  const acceptedCount = sorted.filter((item) => item.status === 'accepted').length;
  const mitigatedCount = sorted.filter((item) => item.status === 'mitigated').length;
  const openCount = sorted.filter((item) => item.status === 'open').length;
  const status: RiskRegisterResult['status'] = blockedCount > 0 || signoffStatusRank(result.qaSignoff.status) >= signoffStatusRank('fail')
    ? 'blocked'
    : releaseBlockingCount > 0 || criticalCount > 0 || highCount > 0
      ? 'at-risk'
      : sorted.length > 0
        ? 'monitor'
        : 'clear';

  return {
    generatedAt: new Date().toISOString(),
    status,
    summary: {
      totalCount: sorted.length,
      criticalCount,
      highCount,
      mediumCount: sorted.filter((item) => item.level === 'medium').length,
      lowCount: sorted.filter((item) => item.level === 'low').length,
      openCount,
      blockedCount,
      acceptedCount,
      mitigatedCount,
      releaseBlockingCount
    },
    items: sorted.map((item, index) => ({ ...item, id: `RISK-${String(index + 1).padStart(3, '0')}` })),
    notes: [
      'Risk register is derived from professionalSummary, qaSignoff, qaCoverage, qaPlan, sourceHealth, testData, artifactIntegrity, and environment evidence.',
      'It is a release-risk worklist, not a replacement for PRD/product owner risk acceptance.'
    ]
  };
}

export function formatRiskRegister(result: RiskRegisterResult): string {
  const rows = result.items.slice(0, 30).map((item) => `| ${item.id} | ${item.level} | ${item.category} | ${item.impact}/${item.likelihood} | ${item.status} | ${item.blocksRelease ? 'yes' : 'no'} | ${item.owner} | ${markdownEscape(item.title)} | ${markdownEscape(item.mitigation)} |`);
  return `# FrontLens Risk Register

- Status: **${result.status}**
- Total risks: ${result.summary.totalCount}
- Critical / High / Medium / Low: ${result.summary.criticalCount} / ${result.summary.highCount} / ${result.summary.mediumCount} / ${result.summary.lowCount}
- Open / Blocked / Accepted / Mitigated: ${result.summary.openCount} / ${result.summary.blockedCount} / ${result.summary.acceptedCount} / ${result.summary.mitigatedCount}
- Release-blocking: ${result.summary.releaseBlockingCount}

## Risk Matrix

${rows.length ? ['| ID | Level | Category | Impact/Likelihood | Status | Blocks release | Owner | Risk | Mitigation |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |', ...rows].join('\n') : 'No active release risks derived from the collected evidence.'}

## Notes

${result.notes.map((note) => `- ${markdownEscape(note)}`).join('\n')}
`;
}
