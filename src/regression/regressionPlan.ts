import type { ArtifactIntegrityResult, EnvironmentAssessment, FixTask, InteractionTestResult, JourneyTestResult, PageProfileAssessment, QaQualityGate, QaSignoffResult, RegressionPlanItem, RegressionPlanResult, RequirementCoverageResult, RootCauseGroup, SourceHealthResult, TestDataAssessmentResult } from '../types.js';

export interface RegressionPlanInput {
  targetUrl: string;
  sourceRoot?: string;
  rootCauseGroups: RootCauseGroup[];
  fixTasks: FixTask[];
  requirementCoverage: RequirementCoverageResult;
  journeyTests: JourneyTestResult[];
  interactionTests: InteractionTestResult[];
  sourceHealth: SourceHealthResult;
  artifactIntegrity: ArtifactIntegrityResult;
  environment: EnvironmentAssessment;
  pageProfile: PageProfileAssessment;
  testData: TestDataAssessmentResult;
  qualityGate: QaQualityGate;
  qaSignoff: QaSignoffResult;
}

function quote(value: string): string {
  return JSON.stringify(value);
}

function priorityRank(priority: RegressionPlanItem['priority']): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[priority];
}

function unique(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function baseQaCommand(input: RegressionPlanInput, output = 'reports/frontlens/regression'): string {
  return `node dist/cli.js qa --url ${quote(input.targetUrl)} --output ${quote(output)} --no-trace --json${input.sourceRoot ? ` --source-root ${quote(input.sourceRoot)}` : ''}`;
}

function addItem(items: RegressionPlanItem[], item: Omit<RegressionPlanItem, 'id'>): void {
  const id = `REG-${String(items.length + 1).padStart(3, '0')}`;
  items.push({ ...item, id, commands: unique(item.commands), evidenceRefs: unique(item.evidenceRefs) });
}

function itemStatusFromPriority(priority: RegressionPlanItem['priority'], blocked = false, needsInput = false): RegressionPlanItem['status'] {
  if (blocked) return 'blocked';
  if (needsInput) return 'needs-input';
  return priority === 'P0' ? 'blocked' : 'ready';
}

function requirementPriority(priority: string): RegressionPlanItem['priority'] {
  return priority === 'P0' || priority === 'P1' || priority === 'P2' || priority === 'P3' ? priority : 'P2';
}

function failedOrIncompleteDownloadTests(input: RegressionPlanInput): RegressionPlanItem[] {
  const rows: RegressionPlanItem[] = [];
  const badInteractions = input.interactionTests.filter((test) => test.kind === 'download' && (test.status !== 'passed' || !test.observations.downloadPath || test.observations.downloadContent?.parseStatus === 'failed' || test.observations.downloadSizeBytes === 0));
  for (const test of badInteractions) {
    addItem(rows, {
      type: 'download',
      priority: test.status === 'failed' ? 'P1' : 'P2',
      title: `复测下载/导出交互 ${test.id}: ${test.target}`,
      owner: 'test',
      status: test.status === 'skipped' ? 'needs-input' : 'ready',
      commands: [baseQaCommand(input)],
      steps: ['启用 safety.allowDownload=true 的授权测试配置。', `执行下载/导出交互 ${test.target}。`, '打开 result.json 中的 downloadPath 并核对 downloadContent。'],
      expected: ['downloadPath 指向存在的文件。', 'downloadSizeBytes > 0。', 'downloadSha256 存在。', '文本/CSV/JSON 导出 parseStatus 为 passed；二进制导出有 binary/skipped 内容摘要。'],
      evidenceRefs: [test.id, ...(test.observations.networkRequestIds ?? [])],
      notes: [test.issue ?? test.observations.downloadContent?.issue ?? '下载/导出需要复测。']
    });
  }
  for (const journey of input.journeyTests) {
    for (const step of journey.steps.filter((step) => step.downloadPath || /导出|下载|download|export/i.test(`${step.target ?? ''} ${step.value ?? ''} ${step.error ?? ''}`))) {
      const failed = step.status !== 'passed' || !step.downloadPath || step.downloadContent?.parseStatus === 'failed' || step.downloadSizeBytes === 0;
      if (!failed) continue;
      addItem(rows, {
        type: 'download',
        priority: step.status === 'failed' ? 'P1' : 'P2',
        title: `复测用户旅程下载步骤 ${journey.id}#${step.index}`,
        owner: 'test',
        status: step.status === 'skipped' ? 'needs-input' : 'ready',
        commands: [baseQaCommand(input)],
        steps: ['启用 safety.allowDownload=true 的授权测试配置。', `执行 journey ${journey.name} 的步骤 ${step.index}。`, '核对步骤级 downloadPath/downloadContent。'],
        expected: ['文件存在且非空。', '内容摘要可复核。', '相关需求覆盖状态为 passed。'],
        evidenceRefs: [journey.id, ...(step.networkRequestIds ?? [])],
        journeyIds: [journey.id],
        notes: [step.error ?? step.downloadContent?.issue ?? 'journey 下载步骤需要复测。']
      });
    }
  }
  return rows;
}

export function buildRegressionPlan(input: RegressionPlanInput): RegressionPlanResult {
  const items: RegressionPlanItem[] = [];
  const baseCommand = baseQaCommand(input);

  addItem(items, {
    type: 'full-rerun',
    priority: input.qaSignoff.status === 'fail' || input.qaSignoff.status === 'blocked' ? 'P0' : input.qualityGate.status === 'fail' || input.qualityGate.status === 'blocked' ? 'P1' : 'P2',
    title: '完整复测当前页面并刷新 qaSignoff / qualityGate',
    owner: 'test',
    status: 'ready',
    commands: [baseCommand],
    steps: ['在修复后运行完整 FrontLens QA。', '优先读取 qa-review.md，再读取 result.json。', '确认 qaSignoff、qualityGate、issueDisposition、rootCauseGroups 与 artifactIntegrity。'],
    expected: ['qaSignoff 不能比本轮更差。', '新增 critical/high actionable 问题为 0。', 'artifactIntegrity 通过或仅有明确非本地路径 skipped。'],
    evidenceRefs: ['qaSignoff', 'qualityGate', 'artifactIntegrity']
  });

  for (const group of input.rootCauseGroups.filter((item) => item.status === 'actionable').sort((a, b) => priorityRank(a.priority) - priorityRank(b.priority)).slice(0, 20)) {
    addItem(items, {
      type: 'root-cause',
      priority: group.priority,
      title: `复测根因：${group.title}`,
      owner: group.owner,
      status: itemStatusFromPriority(group.priority),
      commands: unique([group.verificationCommand, baseCommand]),
      steps: ['应用对应修复。', '执行根因自带 verificationCommand。', '重跑 FrontLens 并确认相关 raw issue 不再出现。'],
      expected: [`相关 raw issues resolved：${group.issueIds.join(', ')}`],
      evidenceRefs: [group.id, ...group.issueIds, ...group.networkRequestIds, ...group.consoleIds, ...group.pageErrorIds],
      issueIds: group.issueIds,
      notes: [group.summary]
    });
  }

  for (const requirement of input.requirementCoverage.items.filter((item) => item.status !== 'passed' && item.status !== 'not-applicable' && (item.priority === 'P0' || item.priority === 'P1' || item.status === 'failed')).slice(0, 20)) {
    const priority = requirementPriority(requirement.priority);
    addItem(items, {
      type: 'requirement',
      priority,
      title: `复测需求覆盖：${requirement.id} ${requirement.title}`,
      owner: 'test',
      status: requirement.gaps.length > 0 ? 'needs-input' : itemStatusFromPriority(priority),
      commands: [baseCommand],
      steps: ['补齐 selector / expectedTexts / apiPatterns / journeySteps / role/testData 后运行 QA。', '核对 requirementCoverage.items 中该需求状态。'],
      expected: ['status 为 passed 或明确 not-applicable。', 'confidence 至少为 medium；P0/P1 目标为 high。'],
      evidenceRefs: [requirement.id, ...requirement.evidence.journeyIds, ...requirement.evidence.interactionTestIds, ...requirement.evidence.networkRequestIds, ...requirement.evidence.issueIds],
      requirementIds: [requirement.id],
      journeyIds: requirement.evidence.journeyIds,
      notes: requirement.gaps
    });
  }

  for (const journey of input.journeyTests.filter((item) => item.status === 'failed' || item.status === 'warning' || item.status === 'skipped').slice(0, 12)) {
    addItem(items, {
      type: 'journey',
      priority: journey.status === 'failed' ? 'P1' : 'P2',
      title: `复测用户旅程：${journey.name}`,
      owner: 'test',
      status: journey.status === 'skipped' ? 'needs-input' : 'ready',
      commands: [baseCommand],
      steps: ['确认登录态、测试数据和非破坏/下载授权。', `执行 journey ${journey.id}。`, '检查每个 step 的 status、networkRequestIds、consoleIds、pageErrorIds。'],
      expected: ['journey status 为 passed。', '无新增 page error / actionable console error。'],
      evidenceRefs: [journey.id, ...journey.steps.flatMap((step) => [...(step.networkRequestIds ?? []), ...(step.consoleIds ?? []), ...(step.pageErrorIds ?? [])])],
      requirementIds: journey.requirementIds,
      journeyIds: [journey.id],
      notes: [journey.issue ?? '旅程未完全通过。']
    });
  }

  for (const check of input.sourceHealth.scriptChecks.filter((item) => item.status === 'failed' || item.status === 'timed-out')) {
    addItem(items, {
      type: 'source-health',
      priority: check.category === 'build' || check.category === 'typecheck' ? 'P0' : 'P1',
      title: `修复并复跑源码脚本：${check.scriptName}`,
      owner: 'frontend',
      status: 'blocked',
      commands: [check.command, baseCommand],
      steps: ['在 sourceRoot 下运行脚本。', '修复失败输出中的源码问题。', '重跑 FrontLens 并确认 sourceHealth.status。'],
      expected: [`${check.scriptName} status 为 passed。`, 'sourceHealth.status 不为 failed。'],
      evidenceRefs: [check.id],
      notes: [check.stderrPreview ?? check.stdoutPreview ?? check.error ?? 'source script failed']
    });
  }

  if (input.sourceHealth.syntaxErrorCount > 0) {
    addItem(items, {
      type: 'source-health',
      priority: 'P0',
      title: `修复 ${input.sourceHealth.syntaxErrorCount} 个源码语法错误`,
      owner: 'frontend',
      status: 'blocked',
      commands: [baseCommand],
      steps: ['查看 source-health.json 的 findings。', '修复语法错误后运行 typecheck/build。', '重跑 FrontLens。'],
      expected: ['sourceHealth.syntaxErrorCount 为 0。'],
      evidenceRefs: input.sourceHealth.findings.map((finding) => finding.id),
      notes: input.sourceHealth.findings.slice(0, 5).map((finding) => `${finding.file}:${finding.line ?? '?'} ${finding.message}`)
    });
  }

  for (const item of failedOrIncompleteDownloadTests(input)) addItem(items, item);

  if (input.artifactIntegrity.status === 'failed') {
    addItem(items, {
      type: 'artifact-integrity',
      priority: 'P1',
      title: `修复 ${input.artifactIntegrity.missingCount} 个缺失证据路径`,
      owner: 'test',
      status: 'needs-input',
      commands: [baseCommand],
      steps: ['打开 artifactIntegrity.missing。', '确认报告引用路径是否真实存在或应移除。', '重跑报告生成。'],
      expected: ['artifactIntegrity.status 为 passed 或 warning（仅非本地路径 skipped）。'],
      evidenceRefs: input.artifactIntegrity.missing.map((entry) => entry.source),
      notes: [input.artifactIntegrity.summary]
    });
  }

  if (input.environment.trust.performance !== 'high' || input.environment.trust.security !== 'high' || input.environment.trust.businessSignoff !== 'high') {
    addItem(items, {
      type: 'environment',
      priority: 'P2',
      title: '用 build/preview 或生产等价环境复测发布结论',
      owner: 'test',
      status: input.environment.kind === 'local-dev' ? 'needs-input' : 'ready',
      commands: [baseCommand],
      steps: ['准备生产等价 HTTPS 或本地 build preview URL。', '必要时运行 env-compare。', '仅用 preview/production-like 结果判断 bundle/security/headers。'],
      expected: ['environment.trust.performance/security 至少为 medium，发布签核目标为 high。', 'dev-only findings 不进入生产修复队列。'],
      evidenceRefs: ['environment'],
      notes: input.environment.recommendations
    });
  }

  if (input.pageProfile.status !== 'configured') {
    addItem(items, {
      type: 'requirement',
      priority: 'P3',
      title: '补充 productContext / PRD / ADR 以降低产品范围噪音',
      owner: 'product',
      status: 'needs-input',
      commands: [baseCommand],
      steps: ['回答 pageProfile.questions。', '把必选/可选/不在范围能力写入 productContext。', '重跑 QA 并复核 issueDisposition。'],
      expected: ['pageProfile.status 为 configured，产品取舍类 raw issue 不再进入核心缺陷。'],
      evidenceRefs: ['pageProfile'],
      notes: input.pageProfile.questions
    });
  }

  if (input.testData.status === 'failed' || input.testData.status === 'warning') {
    addItem(items, {
      type: 'requirement',
      priority: input.testData.status === 'failed' ? 'P0' : 'P1',
      title: '补齐测试数据生命周期后复测写操作需求',
      owner: 'test',
      status: input.testData.status === 'failed' ? 'blocked' : 'needs-input',
      commands: [baseCommand],
      steps: ['声明 testData.records/setupSteps/cleanupSteps。', '确认生产写入授权或改用 staging/local。', '重跑涉及 create/edit/delete/upload/import/submit 的 journey。'],
      expected: ['testData.status 为 passed。', '写操作需求不再因缺数据/清理策略降级。'],
      evidenceRefs: ['testData', ...input.testData.findings.map((finding) => finding.id)],
      notes: input.testData.recommendations
    });
  }

  const commands = unique(items.flatMap((item) => item.commands));
  const blockedCount = items.filter((item) => item.status === 'blocked').length;
  const needsInputCount = items.filter((item) => item.status === 'needs-input').length;
  const highPriorityCount = items.filter((item) => item.priority === 'P0' || item.priority === 'P1').length;
  const status: RegressionPlanResult['status'] = blockedCount > 0 || input.qaSignoff.status === 'fail' || input.qaSignoff.status === 'blocked' ? 'blocked' : needsInputCount > 0 || input.qaSignoff.status === 'pass-with-risks' || input.qualityGate.status === 'pass-with-risks' ? 'partial' : 'ready';
  const notes = unique([
    status === 'blocked' ? 'Regression is blocked until P0/source/test-data/artifact blockers are resolved.' : '',
    needsInputCount > 0 ? 'Some regression items require product/role/test-data/environment input before high-confidence sign-off.' : '',
    'Use root-cause items for implementation verification; do not schedule by raw issue count.'
  ]);

  return {
    status,
    generatedAt: new Date().toISOString(),
    summary: {
      itemCount: items.length,
      commandCount: commands.length,
      blockedCount,
      needsInputCount,
      highPriorityCount
    },
    commands,
    items,
    notes
  };
}
