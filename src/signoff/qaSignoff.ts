import type { ArtifactIntegrityResult, EnvironmentAssessment, FrontLensConfig, InteractionTestResult, JourneyTestResult, QaQualityGate, QaSignoffResult, RequirementCoverageResult, SourceHealthResult } from '../types.js';

function passedCount(items: Array<{ status: string }>): number {
  return items.filter((item) => item.status === 'passed').length;
}

function failedCount(items: Array<{ status: string }>): number {
  return items.filter((item) => item.status === 'failed').length;
}

function allSkipped(items: Array<{ status: string }>): boolean {
  return items.length > 0 && items.every((item) => item.status === 'skipped');
}

function hasAnyRuntimeEvidence(input: {
  pageDomNodes: number;
  journeyTests: JourneyTestResult[];
  interactionTests: InteractionTestResult[];
}): boolean {
  return input.pageDomNodes > 0 || input.journeyTests.length > 0 || input.interactionTests.length > 0;
}

function businessValidationConfidence(input: {
  qualityGate: QaQualityGate;
  requirementCoverage: RequirementCoverageResult;
  journeyTests: JourneyTestResult[];
  interactionTests: InteractionTestResult[];
  pageDomNodes: number;
}): QaSignoffResult['businessValidationConfidence'] {
  if (input.qualityGate.status === 'blocked' || input.pageDomNodes === 0) return 'not-verified';
  const providedRequirements = input.requirementCoverage.summary.providedCount;
  const providedAllPassed = providedRequirements > 0 && input.requirementCoverage.items
    .filter((item) => item.source === 'provided')
    .every((item) => item.status === 'passed' || item.status === 'not-applicable');
  if (providedAllPassed && passedCount(input.journeyTests) > 0) return 'runtime-verified';
  if (hasAnyRuntimeEvidence(input)) return 'runtime-partial';
  return 'static-source-only';
}

function confidenceFor(input: {
  status: QaSignoffResult['status'];
  qualityGate: QaQualityGate;
  businessValidationConfidence: QaSignoffResult['businessValidationConfidence'];
  gaps: string[];
  blockers: string[];
  risks: string[];
}): QaSignoffResult['confidence'] {
  if (input.status === 'blocked' || input.businessValidationConfidence === 'not-verified') return 'low';
  if (input.businessValidationConfidence === 'static-source-only') return 'low';
  if (input.businessValidationConfidence === 'runtime-verified' && input.qualityGate.confidence === 'high' && input.gaps.length === 0 && input.risks.length === 0 && input.blockers.length === 0) return 'high';
  return 'medium';
}

export function buildQaSignoff(input: {
  config: FrontLensConfig;
  qualityGate: QaQualityGate;
  requirementCoverage: RequirementCoverageResult;
  sourceHealth: SourceHealthResult;
  artifactIntegrity: ArtifactIntegrityResult;
  environment?: EnvironmentAssessment;
  journeyTests: JourneyTestResult[];
  interactionTests: InteractionTestResult[];
  exceptionSimulations: Array<{ status: string }>;
  pageDomNodes: number;
}): QaSignoffResult {
  const providedRequirementCount = input.requirementCoverage.summary.providedCount;
  const inferredRequirementCount = input.requirementCoverage.summary.inferredCount;
  const passedJourneyCount = passedCount(input.journeyTests);
  const failedJourneyCount = failedCount(input.journeyTests);
  const passedInteractionCount = passedCount(input.interactionTests);
  const failedInteractionCount = failedCount(input.interactionTests);
  const failedExceptionCount = failedCount(input.exceptionSimulations);
  const passedSourceScriptChecks = input.sourceHealth.scriptChecks.filter((check) => check.status === 'passed').length;
  const failedSourceScriptChecks = input.sourceHealth.scriptChecks.filter((check) => check.status === 'failed' || check.status === 'timed-out');
  const skippedSourceScriptChecks = input.sourceHealth.scriptChecks.filter((check) => check.status === 'skipped');
  const destructiveActionsAllowed = Boolean(
    input.config.safety.allowCreate ||
    input.config.safety.allowEdit ||
    input.config.safety.allowDelete ||
    input.config.safety.allowUpload ||
    input.config.safety.allowDownload ||
    input.config.safety.allowSubmit
  );

  const blockers: string[] = [...input.qualityGate.reasons.filter((reason) => input.qualityGate.status === 'blocked' || input.qualityGate.status === 'fail')];
  const risks: string[] = [];
  const gaps: string[] = [...input.qualityGate.coverageGaps];
  const followups: string[] = [];
  const evidence: string[] = [];

  if (input.pageDomNodes > 0) evidence.push(`runtime DOM captured (${input.pageDomNodes} nodes)`);
  if (passedJourneyCount > 0) evidence.push(`${passedJourneyCount} journey(s) passed`);
  if (passedInteractionCount > 0) evidence.push(`${passedInteractionCount} interaction check(s) passed`);
  if (input.sourceHealth.status === 'passed') evidence.push(`sourceHealth passed (${input.sourceHealth.parsedFiles} parsed files)`);
  if (passedSourceScriptChecks > 0) evidence.push(`${passedSourceScriptChecks} source script check(s) passed`);
  if (input.artifactIntegrity.status === 'passed' || input.artifactIntegrity.status === 'warning') evidence.push(`artifactIntegrity ${input.artifactIntegrity.status}`);

  if (input.sourceHealth.status === 'failed') {
    if (input.sourceHealth.syntaxErrorCount > 0) blockers.push(`sourceHealth failed: ${input.sourceHealth.syntaxErrorCount} syntax error(s).`);
    if (failedSourceScriptChecks.length > 0) blockers.push(`sourceHealth script checks failed: ${failedSourceScriptChecks.map((check) => `${check.scriptName}(${check.status})`).join(', ')}.`);
  }
  if (input.artifactIntegrity.status === 'failed') risks.push(`artifactIntegrity failed: ${input.artifactIntegrity.missingCount} missing artifact reference(s).`);
  if (input.environment) {
    evidence.push(`environment ${input.environment.kind} (performance trust ${input.environment.trust.performance}, security trust ${input.environment.trust.security})`);
    if (input.environment.isViteDevServer) {
      risks.push('当前目标为 dev server/source-module 模式；生产性能、安全泄漏、HMR/WebSocket 和资源请求数结论需要 build+preview 复核。');
      followups.push('运行 build + preview 后复测性能、安全头、资源体积和覆盖率模块。');
    } else if (input.environment.trust.performance !== 'high' || input.environment.trust.security !== 'high') {
      risks.push(`当前环境为 ${input.environment.kind}；性能/安全发布结论置信度 ${input.environment.trust.performance}/${input.environment.trust.security}。`);
      followups.push('在生产等价 HTTPS 域名或正式 staging 上复测部署安全、TLS、CDN、Cookie 和性能预算。');
    }
  }
  if (providedRequirementCount === 0) {
    gaps.push('未提供 PRD/验收标准；只能进行页面能力推断，不能给出完整业务通过结论。');
    followups.push('提供 PRD/验收标准，并用 selectors/expectedTexts/journeySteps 编码为 requirements。');
  }
  if (input.journeyTests.length === 0 || passedJourneyCount === 0 || allSkipped(input.journeyTests)) {
    gaps.push('核心用户旅程没有形成 passed 的运行时证据。');
    followups.push('补充覆盖核心业务流的非破坏 journey；涉及写操作时明确授权测试环境。');
  }
  if (input.interactionTests.length === 0 || allSkipped(input.interactionTests)) {
    gaps.push('安全交互探索未覆盖或全部 skipped，搜索/表单/弹窗/表格等交互结论低置信。');
  }
  if (!input.config.auth.storageState && !input.config.auth.sessionStorageState) {
    gaps.push('未提供登录态/角色态；需要鉴权或角色差异的页面无法完成高置信业务验收。');
    followups.push('提供 storageState/sessionStorageState，并按角色矩阵分别运行。');
  }
  if (!destructiveActionsAllowed && input.requirementCoverage.items.some((item) => /创建|新增|编辑|删除|上传|提交|下载|导出|create|edit|delete|upload|submit|download|export/i.test(`${item.title} ${item.description ?? ''}`))) {
    gaps.push('默认非破坏策略阻止创建/编辑/删除/上传/提交/下载类验证，相关业务流只能部分验证。');
  }
  if (input.sourceHealth.scriptChecks.length === 0 && input.sourceHealth.packageScripts.some((script) => script.category === 'build' || script.category === 'typecheck' || script.category === 'lint')) {
    followups.push('运行 package.json 中的 build/typecheck/lint 脚本，确认源码健康不只停留在语法解析层。');
  }
  if (skippedSourceScriptChecks.length > 0) {
    followups.push(`补跑 skipped 的源码脚本检查：${skippedSourceScriptChecks.map((check) => check.scriptName).join(', ')}。`);
  }

  const businessConfidence = businessValidationConfidence({
    qualityGate: input.qualityGate,
    requirementCoverage: input.requirementCoverage,
    journeyTests: input.journeyTests,
    interactionTests: input.interactionTests,
    pageDomNodes: input.pageDomNodes
  });

  let status: QaSignoffResult['status'] = input.qualityGate.status;
  if (input.qualityGate.status === 'pass' && (businessConfidence !== 'runtime-verified' || gaps.length > 0 || risks.length > 0)) {
    status = 'pass-with-risks';
  }
  if (input.sourceHealth.status === 'failed') status = 'fail';
  if (input.qualityGate.status === 'blocked') status = 'blocked';

  const uniqueGaps = [...new Set(gaps)];
  const uniqueRisks = [...new Set(risks)];
  const uniqueBlockers = [...new Set(blockers)];
  const confidence = confidenceFor({
    status,
    qualityGate: input.qualityGate,
    businessValidationConfidence: businessConfidence,
    gaps: uniqueGaps,
    risks: uniqueRisks,
    blockers: uniqueBlockers
  });

  return {
    status,
    confidence,
    businessValidationConfidence: businessConfidence,
    checkedAt: new Date().toISOString(),
    summary: `${status} / ${confidence} / ${businessConfidence}: ${[...uniqueBlockers, ...uniqueRisks, ...uniqueGaps].slice(0, 3).join(' ') || '已收集到足够证据，未发现额外验收阻断。'}`,
    scope: {
      targetUrl: input.config.target.url,
      sourceRoot: input.config.source.root,
      requirementSource: input.requirementCoverage.source,
      providedRequirementCount,
      inferredRequirementCount,
      journeyCount: input.journeyTests.length,
      passedJourneyCount,
      failedJourneyCount,
      interactionCount: input.interactionTests.length,
      passedInteractionCount,
      failedInteractionCount,
      exceptionCount: input.exceptionSimulations.length,
      failedExceptionCount,
      authStateProvided: Boolean(input.config.auth.storageState || input.config.auth.sessionStorageState),
      destructiveActionsAllowed,
      environmentKind: input.environment?.kind ?? 'unknown',
      environmentConfidence: input.environment?.confidence ?? 'low',
      sourceHealthStatus: input.sourceHealth.status,
      artifactIntegrityStatus: input.artifactIntegrity.status
    },
    blockers: uniqueBlockers,
    risks: uniqueRisks,
    coverageGaps: uniqueGaps,
    requiredFollowups: [...new Set(followups)],
    evidence: [...new Set(evidence)]
  };
}
