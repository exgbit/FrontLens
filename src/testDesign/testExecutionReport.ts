import type { ApiEndpointContract, PlannedCaseExecution, PlannedTestCase, QaResult, RequirementWizardCandidate, TestCaseStatus, TestPlanExecutionReport, TestPlanResult } from '../types.js';
import { markdownEscape, truncateMiddle } from '../utils/text.js';
import { apiAcceptanceExpectations, apiPathMatches, parseApiPattern } from '../requirements/httpAcceptance.js';

function uniq(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

interface ExecutionEvidence {
  status: TestCaseStatus;
  actual: string;
  evidenceRefs: string[];
}

function statusFromRuntime(items: Array<{ id: string; status: 'passed' | 'warning' | 'failed' | 'skipped' }>, label: string): ExecutionEvidence | undefined {
  if (!items.length) return undefined;
  const evidenceRefs = items.map((item) => item.id);
  if (items.some((item) => item.status === 'failed')) return { status: 'failed', actual: `${label}存在失败证据。`, evidenceRefs };
  if (items.some((item) => item.status === 'warning')) return { status: 'partial', actual: `${label}存在告警，尚不能判定完全通过。`, evidenceRefs };
  if (items.every((item) => item.status === 'passed')) return { status: 'passed', actual: `${label}已通过。`, evidenceRefs };
  if (items.some((item) => item.status === 'passed')) return { status: 'partial', actual: `${label}仅部分通过，仍有证据被跳过。`, evidenceRefs };
  return { status: 'skipped', actual: `${label}被跳过，未形成通过证据。`, evidenceRefs };
}

function matchingEndpoints(planCase: PlannedTestCase, requirement: RequirementWizardCandidate | undefined, result: QaResult): ApiEndpointContract[] {
  const patterns = uniq([...(requirement?.apiPatterns ?? []), planCase.layer === 'api' || planCase.layer === 'backend' ? planCase.automationBinding ?? '' : ''])
    .map(parseApiPattern)
    .filter((item): item is { method?: string; path: string } => Boolean(item.path));
  return result.apiContract.endpoints.filter((endpoint) => patterns.some((pattern) =>
    (!pattern.method || pattern.method === endpoint.method.toUpperCase()) && apiPathMatches(pattern.path, endpoint.path)));
}

function evaluateApiExpectations(requirement: RequirementWizardCandidate | undefined, endpoints: ApiEndpointContract[]): { status: 'passed' | 'partial' | 'failed'; expected: string } {
  const expectations = requirement ? apiAcceptanceExpectations(requirement) : [];
  if (!expectations.length) {
    const failed = endpoints.some((item) => item.issues.length > 0 || !item.statusCodes.some((status) => status >= 200 && status < 300));
    return { status: failed ? 'failed' : 'passed', expected: '2xx' };
  }
  let missing = false;
  let failed = false;
  const labels: string[] = [];
  for (const expectation of expectations) {
    const matched = endpoints.filter((endpoint) =>
      (!expectation.method || expectation.method === endpoint.method.toUpperCase())
      && Boolean(expectation.path && apiPathMatches(expectation.path, endpoint.path)));
    const wanted = expectation.statuses.length ? expectation.statuses : [200];
    labels.push(`${expectation.pattern}=>${expectation.statuses.join(',') || '2xx'}`);
    if (!matched.length) {
      missing = true;
      continue;
    }
    if (matched.some((endpoint) => endpoint.issues.length > 0)) failed = true;
    const observed = new Set(matched.flatMap((endpoint) => endpoint.statusCodes));
    if (expectation.statuses.length) {
      if (wanted.some((status) => !observed.has(status))) failed = true;
    } else if (!matched.every((endpoint) => endpoint.statusCodes.some((status) => status >= 200 && status < 300))) {
      failed = true;
    }
  }
  return { status: failed ? 'failed' : missing ? 'partial' : 'passed', expected: labels.join('；') };
}

function endpointEvidenceRefs(endpoints: ApiEndpointContract[]): string[] {
  return uniq(endpoints.flatMap((endpoint) => [
    `${endpoint.method} ${endpoint.path}`,
    ...(endpoint.networkRequestIds ?? []),
    ...endpoint.issues.flatMap((issue) => issue.networkRequestIds)
  ]));
}

function scopedTestEvidence(planCase: PlannedTestCase, result: QaResult): ExecutionEvidence | undefined {
  const scopedIds = [...planCase.requirementIds, ...(planCase.changeImpactIds ?? [])];
  const bindings = (result.sourceHealth.testEvidence ?? []).filter((binding) =>
    binding.layer === planCase.layer
    && binding.scenarios.includes(planCase.scenario)
    && binding.requirementIds.some((id) => scopedIds.includes(id)));
  if (!bindings.length) return undefined;
  const evidenceRefs = uniq(bindings.flatMap((binding) => [binding.id, ...binding.evidenceRefs]));
  const summary = bindings.map((binding) => `${binding.id}:${binding.status}`).join(', ');
  if (bindings.some((binding) => binding.status === 'failed')) {
    return { status: 'failed', actual: `需求专属自动化证据失败；bindings=${summary}`, evidenceRefs };
  }
  if (bindings.some((binding) => binding.status === 'passed')) {
    return { status: 'passed', actual: `需求、层级与场景专属自动化证据已通过；bindings=${summary}`, evidenceRefs };
  }
  return { status: 'needs-input', actual: `已声明需求专属自动化绑定，但关联脚本未执行通过；bindings=${summary}`, evidenceRefs };
}

function sourceExecution(planCase: PlannedTestCase, requirement: RequirementWizardCandidate | undefined, result: QaResult): ExecutionEvidence {
  const scriptSummary = result.sourceHealth.scriptChecks.map((item) => `${item.scriptName}:${item.status}`).join(', ') || 'none';
  const boundEvidence = scopedTestEvidence(planCase, result);
  if (boundEvidence) return boundEvidence;
  const text = `${requirement?.title ?? ''} ${requirement?.description ?? ''}`;
  const explicitlyCodeOwned = /typecheck|lint|单元测试|集成测试|代码检查|构建必须|tests?\s+必须|source\s+check/i.test(text);
  if (explicitlyCodeOwned && (planCase.scenario === 'positive' || planCase.scenario === 'regression')) {
    if (result.sourceHealth.status === 'skipped') return { status: 'skipped', actual: '未提供 sourceRoot 或未执行需求指定的代码侧检查。', evidenceRefs: ['sourceHealth'] };
    const requiredCategories = [
      /typecheck|类型检查/i.test(text) ? 'typecheck' : undefined,
      /\blint\b|代码规范/i.test(text) ? 'lint' : undefined,
      /单元测试|\bunit(?:-test)?\b/i.test(text) ? 'test' : undefined,
      /集成测试|\bintegration(?:-test)?\b/i.test(text) ? 'test' : undefined,
      /(?:构建|\bbuild\b)[^，。,；;]{0,12}(?:必须|通过|成功)|(?:必须|通过)[^，。,；;]{0,12}(?:构建|\bbuild\b)/i.test(text) ? 'build' : undefined
    ].filter((item): item is string => Boolean(item));
    if (requiredCategories.length === 0 && result.sourceHealth.status === 'failed') {
      return { status: 'failed', actual: `需求明确指定的代码侧检查失败；scripts=${scriptSummary}`, evidenceRefs: ['sourceHealth'] };
    }
    const failed = uniq(requiredCategories).filter((category) => result.sourceHealth.scriptChecks.some((item) => item.category === category && (item.status === 'failed' || item.status === 'timed-out')));
    if (failed.length) {
      return { status: 'failed', actual: `需求指定的代码检查失败：${failed.join(', ')}；scripts=${scriptSummary}`, evidenceRefs: ['sourceHealth'] };
    }
    const missing = uniq(requiredCategories).filter((category) => !result.sourceHealth.scriptChecks.some((item) => item.category === category && item.status === 'passed'));
    if (missing.length) {
      return { status: 'needs-input', actual: `需求指定的代码检查未全部执行并通过；缺少：${missing.join(', ')}；scripts=${scriptSummary}`, evidenceRefs: ['sourceHealth'] };
    }
    return { status: 'passed', actual: `需求明确要求的代码检查已通过；scripts=${scriptSummary}`, evidenceRefs: ['sourceHealth'] };
  }
  if (result.sourceHealth.status === 'failed') {
    return {
      status: 'blocked',
      actual: `存在全局代码健康阻塞，但没有需求专属绑定，不能将失败归因于该需求；scripts=${scriptSummary}`,
      evidenceRefs: ['sourceHealth']
    };
  }
  if (result.sourceHealth.status === 'skipped') return { status: 'skipped', actual: '未提供 sourceRoot 或未执行代码侧检查。', evidenceRefs: ['sourceHealth'] };
  return {
    status: 'needs-input',
    actual: `全局 sourceHealth 通过，但没有需求专属文件、分支或自动化测试绑定，不能据此证明该需求的代码实现；scripts=${scriptSummary}`,
    evidenceRefs: ['sourceHealth']
  };
}

function executionByLayer(planCase: PlannedTestCase, requirement: RequirementWizardCandidate | undefined, result: QaResult): ExecutionEvidence | undefined {
  const scopedIds = [...planCase.requirementIds, ...(planCase.changeImpactIds ?? [])];
  const coverage = result.requirementCoverage.items.filter((item) => scopedIds.includes(item.id));
  const interactionIds = new Set(coverage.flatMap((item) => item.evidence.interactionTestIds));
  const journeyIds = new Set(coverage.flatMap((item) => item.evidence.journeyIds));
  const interactions = result.interactionTests.filter((item) => interactionIds.has(item.id));
  const journeys = result.journeyTests.filter((item) => journeyIds.has(item.id) || item.requirementIds?.some((id) => scopedIds.includes(id)));
  const endpoints = matchingEndpoints(planCase, requirement, result);
  const exceptionPatterns = uniq([...(requirement?.apiPatterns ?? []), planCase.automationBinding ?? ''])
    .map(parseApiPattern)
    .filter((item): item is { method?: string; path: string } => Boolean(item.path));
  const exceptions = result.exceptionSimulations.filter((item) => item.target && exceptionPatterns.some((pattern) => {
    const targetParts = parseApiPattern(item.target ?? '');
    const target = targetParts.path;
    const actualMethod = item.method?.toUpperCase() ?? targetParts.method;
    const methodMatches = !pattern.method || (Boolean(actualMethod) && pattern.method === actualMethod);
    return Boolean(methodMatches && target && apiPathMatches(pattern.path, target));
  }));

  if (planCase.layer === 'source') return sourceExecution(planCase, requirement, result);
  const boundTestEvidence = scopedTestEvidence(planCase, result);

  if (planCase.layer === 'frontend') {
    if (planCase.scenario === 'recovery') return statusFromRuntime(exceptions, '关联异常恢复测试') ?? boundTestEvidence;
    if (planCase.scenario === 'idempotency') return statusFromRuntime(interactions.filter((item) => item.kind === 'rapid-click'), '关联重复操作测试') ?? boundTestEvidence;
    if (planCase.scenario === 'negative' || planCase.scenario === 'boundary') {
      const validationEvidence = interactions.filter((item) => {
        if (item.kind === 'upload') return true;
        if (item.kind !== 'form-validation' || !item.observations.details || typeof item.observations.details !== 'object') return false;
        const details = item.observations.details as Record<string, unknown>;
        return Number(details.constrainedCount ?? 0) > 0 || Number(details.requiredCount ?? 0) > 0 || Number(details.invalidCount ?? 0) > 0;
      });
      return statusFromRuntime(validationEvidence, '关联输入校验测试') ?? boundTestEvidence;
    }
    if (planCase.scenario === 'positive' || planCase.scenario === 'smoke') {
      return statusFromRuntime([
        ...interactions.filter((item) => item.kind !== 'rapid-click'),
        ...journeys
      ], '关联前端主路径') ?? boundTestEvidence;
    }
    return boundTestEvidence;
  }

  if (planCase.layer === 'api') {
    if (planCase.scenario === 'recovery') return statusFromRuntime(exceptions, '关联 API 异常测试') ?? boundTestEvidence;
    if ((planCase.scenario === 'positive' || planCase.scenario === 'smoke') && endpoints.length) {
      // An endpoint aggregates traffic from multiple scenarios. A declared 4xx
      // permission/negative response must not invalidate an observed 2xx happy
      // path. Contract findings or the absence of any success response do fail it.
      const evaluation = evaluateApiExpectations(requirement, endpoints);
      return {
        status: evaluation.status,
        actual: evaluation.status === 'failed'
          ? `关联 API 未满足逐接口期望状态或存在契约问题；期望=${evaluation.expected}。`
          : evaluation.status === 'partial'
            ? `仅部分关联 API 形成运行时证据；期望=${evaluation.expected}。`
            : `关联 API 已实际请求，逐接口期望状态（${evaluation.expected}）和运行时契约通过。`,
        evidenceRefs: endpointEvidenceRefs(endpoints)
      };
    }
    return boundTestEvidence;
  }

  if (planCase.layer === 'backend' && boundTestEvidence) return boundTestEvidence;
  if (planCase.layer === 'backend' && (planCase.scenario === 'positive' || planCase.scenario === 'smoke') && endpoints.length) {
    const evaluation = evaluateApiExpectations(requirement, endpoints);
    return {
      status: evaluation.status === 'failed' ? 'failed' : 'partial',
      actual: evaluation.status === 'failed'
        ? `关联后端接口未满足逐接口状态或契约；期望=${evaluation.expected}。`
        : '仅验证到后端接口传输结果；缺少业务规则、持久化或后端专属自动化证据，不能判定完全通过。',
      evidenceRefs: endpointEvidenceRefs(endpoints)
    };
  }
  return boundTestEvidence;
}

function issueIdsForEvidence(result: QaResult, evidenceRefs: string[]): string[] {
  return result.issues.filter((issue) => evidenceRefs.some((ref) => JSON.stringify(issue.evidence).includes(ref))).map((issue) => issue.id);
}

function statusForRequirement(planCase: PlannedTestCase, requirement: RequirementWizardCandidate | undefined, result: QaResult): PlannedCaseExecution {
  const scopedIds = [...planCase.requirementIds, ...(planCase.changeImpactIds ?? [])];
  const requirements = result.requirementCoverage.items.filter((item) => scopedIds.includes(item.id));
  let evidence = executionByLayer(planCase, requirement, result);
  if (!evidence && requirements.some((item) => item.status === 'not-covered')) {
    evidence = { status: planCase.priority === 'P0' ? 'blocked' : 'needs-input', actual: '需求未覆盖，缺少可执行断言、角色态、测试数据或环境。', evidenceRefs: requirements.map((item) => item.id) };
  }
  evidence ??= { status: 'needs-input', actual: '该层和场景没有独立执行证据，不能由其他层或其他场景的结果代替。', evidenceRefs: requirements.map((item) => item.id) };
  const issueIds = evidence.status === 'failed' || evidence.status === 'partial' ? issueIdsForEvidence(result, evidence.evidenceRefs) : [];
  return { testCaseId: planCase.id, requirementIds: planCase.requirementIds, ...evidence, evidenceRefs: uniq(evidence.evidenceRefs), issueIds };
}

function systemCaseExecution(planCase: PlannedTestCase, result: QaResult): PlannedCaseExecution {
  let status: TestCaseStatus = 'needs-input';
  let actual = '系统级用例尚未绑定到独立执行证据。';
  if (planCase.tags.includes('availability')) {
    status = result.qaSignoff.scope.passedJourneyCount > 0 ? 'passed' : result.qaSignoff.status === 'blocked' ? 'blocked' : 'needs-input';
    actual = `passedJourneyCount=${result.qaSignoff.scope.passedJourneyCount}`;
  } else if (planCase.tags.includes('core-flow')) {
    status = result.qaSignoff.scope.requirementBoundRuntimeVerifiedJourneyCount > 0 ? 'passed' : 'blocked';
    actual = `requirementBoundRuntimeVerifiedJourneyCount=${result.qaSignoff.scope.requirementBoundRuntimeVerifiedJourneyCount}`;
  } else if (planCase.tags.includes('dependency')) {
    const dependencyChecks = result.exceptionSimulations.filter((item) => item.kind === 'api-500' || item.kind === 'api-timeout' || item.kind === 'offline');
    const requiredKinds = ['api-500', 'api-timeout'] as const;
    const requiredChecks = requiredKinds.map((kind) => dependencyChecks.filter((item) => item.kind === kind));
    status = dependencyChecks.some((item) => item.status === 'failed')
      ? 'failed'
      : requiredChecks.every((checks) => checks.some((item) => item.status === 'passed'))
        ? 'passed'
        : dependencyChecks.length > 0
          ? 'needs-input'
          : 'needs-input';
    actual = dependencyChecks.length > 0
      ? `关键依赖异常模拟：${dependencyChecks.map((item) => `${item.kind}:${item.status}`).join(', ')}；必需=${requiredKinds.join(', ')}`
      : '未执行关键依赖 5xx/timeout/offline 异常模拟。';
    return {
      testCaseId: planCase.id,
      requirementIds: [],
      status,
      actual,
      evidenceRefs: dependencyChecks.map((item) => item.id),
      issueIds: []
    };
  }
  return { testCaseId: planCase.id, requirementIds: [], status, actual, evidenceRefs: ['qaSignoff'], issueIds: [] };
}

export function buildTestPlanExecutionReport(plan: TestPlanResult, result: QaResult): TestPlanExecutionReport {
  const requirementById = new Map(plan.requirements.map((item, index) => [item.id ?? `REQ-${index + 1}`, item]));
  for (const target of plan.changeImpact?.regressionTargets ?? []) {
    requirementById.set(target.id, {
      id: target.id,
      title: target.title,
      description: target.reason,
      priority: target.priority,
      source: 'inferred',
      apiPatterns: target.apiPatterns,
      preconditions: ['基础分支、原有业务入口和测试数据已准备。'],
      businessRules: [target.reason],
      acceptanceCriteria: target.expected,
      sourceScope: [...target.changedFiles, ...target.dependentFiles],
      confidence: target.confidence,
      sourceText: target.reason,
      rationale: ['由 Git 变更和静态依赖传播生成。'],
      needsReview: false,
      reviewNotes: []
    });
  }
  const executions = plan.testCases.map((item) => item.requirementIds.length || item.changeImpactIds?.length
    ? statusForRequirement(item, requirementById.get(item.requirementIds[0] ?? item.changeImpactIds?.[0] ?? ''), result)
    : systemCaseExecution(item, result));
  const count = (status: TestCaseStatus) => executions.filter((item) => item.status === status).length;
  const p0Ids = new Set(plan.testCases.filter((item) => item.priority === 'P0').map((item) => item.id));
  const p0OpenCount = executions.filter((item) => p0Ids.has(item.testCaseId) && item.status !== 'passed').length;
  const requirementTraceability = plan.requirements.map((requirement, index) => {
    const id = requirement.id ?? `REQ-${index + 1}`;
    const linked = executions.filter((item) => item.requirementIds.includes(id));
    const statuses = linked.map((item) => item.status);
    const implementationVerdict: TestPlanExecutionReport['requirementTraceability'][number]['implementationVerdict'] = statuses.some((item) => item === 'failed')
        ? 'implementation-mismatch'
        : statuses.length > 0 && statuses.every((item) => item === 'passed')
          ? 'implemented'
          : plan.status !== 'ready' && requirement.needsReview
            ? 'requirement-needs-review'
            : 'unable-to-verify';
    const verificationVerdict: TestPlanExecutionReport['requirementTraceability'][number]['verificationVerdict'] = statuses.length > 0 && statuses.every((item) => item === 'passed')
      ? 'verified'
      : statuses.some((item) => item === 'failed' || item === 'blocked')
        ? 'blocked'
        : statuses.some((item) => item === 'passed' || item === 'partial')
          ? 'partially-verified'
          : plan.status !== 'ready' && requirement.needsReview
            ? 'requirement-needs-review'
            : 'not-verified';
    return {
      requirementId: id,
      title: requirement.title,
      testCaseIds: linked.map((item) => item.testCaseId),
      statuses,
      issueIds: uniq(linked.flatMap((item) => item.issueIds)),
      implementationVerdict,
      verificationVerdict
    };
  });
  const requirementCoveredCount = requirementTraceability.filter((item) => item.statuses.length > 0 && item.statuses.every((status) => status === 'passed')).length;
  const requirementGapCount = requirementTraceability.length - requirementCoveredCount;
  const failedCount = count('failed');
  const blockedCount = count('blocked');
  const partialCount = count('partial');
  const notExecutedCount = count('needs-input') + count('skipped');
  const globalSourceBlocked = result.sourceHealth.status === 'failed';
  const status: TestPlanExecutionReport['status'] = plan.status === 'blocked' || p0OpenCount || blockedCount || globalSourceBlocked ? 'blocked' : failedCount ? 'failed' : plan.status !== 'ready' || partialCount || notExecutedCount ? 'partial' : 'passed';
  const changeRegressionItems = plan.testCases.flatMap((testCase) => (testCase.changeImpactIds ?? []).map((targetId) => {
    const target = plan.changeImpact?.regressionTargets.find((item) => item.id === targetId);
    const execution = executions.find((item) => item.testCaseId === testCase.id)!;
    return {
      targetId,
      module: target?.module ?? testCase.tags.find((item) => item.startsWith('module:'))?.slice('module:'.length) ?? 'unknown',
      title: target?.title ?? testCase.title,
      priority: testCase.priority,
      testCaseId: testCase.id,
      status: execution.status,
      actual: execution.actual,
      evidenceRefs: execution.evidenceRefs
    };
  }));
  const changeCount = (value: TestCaseStatus) => changeRegressionItems.filter((item) => item.status === value).length;
  const changeNotExecutedCount = changeCount('needs-input') + changeCount('skipped');
  const changeRegressionStatus: TestPlanExecutionReport['changeRegression']['status'] = changeRegressionItems.length === 0
    ? 'not-applicable'
    : changeCount('failed') > 0
      ? 'failed'
      : changeCount('blocked') > 0
        ? 'blocked'
        : changeNotExecutedCount === changeRegressionItems.length
          ? 'not-run'
          : changeCount('partial') > 0 || changeNotExecutedCount > 0
            ? 'partial'
            : 'passed';
  return {
    generatedAt: new Date().toISOString(),
    status,
    planStatus: plan.status,
    summary: {
      totalCount: executions.length,
      passedCount: count('passed'),
      failedCount,
      blockedCount,
      partialCount,
      notExecutedCount,
      p0OpenCount,
      requirementCoveredCount,
      requirementGapCount,
      defectCount: result.defectTickets.items.length
    },
    executions,
    requirementTraceability,
    changeRegression: {
      status: changeRegressionStatus,
      totalCount: changeRegressionItems.length,
      passedCount: changeCount('passed'),
      failedCount: changeCount('failed'),
      blockedCount: changeCount('blocked'),
      partialCount: changeCount('partial'),
      notExecutedCount: changeNotExecutedCount,
      items: changeRegressionItems
    },
    defectIds: result.defectTickets.items.map((item) => item.id),
    releaseRecommendation: status === 'passed'
      ? '测试计划范围内用例已通过，可以进入发布流程。'
      : p0OpenCount > 0
        ? `不建议提测或发布：仍有 ${p0OpenCount} 条 P0 用例未通过。`
        : changeRegressionStatus !== 'passed' && changeRegressionStatus !== 'not-applicable'
          ? `受影响原业务回归状态为 ${changeRegressionStatus}；完成定向回归并保留独立证据后再发布。`
        : globalSourceBlocked
          ? '不建议提测或发布：存在未归因到单条需求的全局代码健康阻塞。'
          : failedCount > 0
            ? `修复 ${failedCount} 条失败用例并完成回归后再发布。`
            : plan.status === 'blocked'
              ? '不建议提测或发布：测试计划本身被阻断，需先补齐可验收需求输入。'
            : plan.status !== 'ready'
              ? `测试计划状态为 ${plan.status}，需确认需求与验收输入；该评审状态本身不等同于执行阻塞。`
              : '存在未执行或证据不足的用例，补齐测试后再做发布判断。'
  };
}

export function formatTestPlanExecutionReport(report: TestPlanExecutionReport, plan: TestPlanResult, result: QaResult): string {
  const priorityById = new Map(plan.testCases.map((item) => [item.id, item.priority]));
  const titleById = new Map(plan.testCases.map((item) => [item.id, item.title]));
  const issueCell = (values: string[]): string => markdownEscape(truncateMiddle(values.join(', ').replace(/\s+/g, ' ') || '-', 180));
  const executionRows = report.executions.map((item) => `| ${item.testCaseId} | ${priorityById.get(item.testCaseId) ?? '-'} | ${item.status} | ${markdownEscape(titleById.get(item.testCaseId) ?? '-')} | ${markdownEscape(item.actual)} | ${issueCell(item.issueIds)} |`);
  const traceRows = report.requirementTraceability.map((item) => `| ${item.requirementId} | ${markdownEscape(item.title)} | ${item.implementationVerdict} | ${item.verificationVerdict} | ${item.testCaseIds.join(', ')} | ${[...new Set(item.statuses)].join(', ')} | ${issueCell(item.issueIds)} |`);
  const changeRows = report.changeRegression.items.map((item) => {
    const target = plan.changeImpact?.regressionTargets.find((entry) => entry.id === item.targetId);
    return `| ${item.targetId} | ${markdownEscape(item.module)} | ${item.priority} | ${item.status} | ${markdownEscape(item.title)} | ${markdownEscape(target?.businessFlows.join('；') ?? '-')} | ${markdownEscape(item.actual)} |`;
  });
  const defects = result.defectTickets.items.map((item) => `### ${item.id} ${markdownEscape(item.title)}

- 严重程度/优先级：${item.severity}/${item.priority}
- 影响：${markdownEscape(item.impact)}
- 实际结果：${markdownEscape(item.actualBehavior)}
- 预期结果：${markdownEscape(item.expectedBehavior)}
- 关联需求：${item.requirements.map((req) => req.id).join(', ') || '-'}
- 代码位置：${item.sourceLocations.map((source) => `${source.file}${source.line ? `:${source.line}` : ''}`).join(', ') || '未定位'}

**复现步骤**

${item.reproduceSteps.map((step, index) => `${index + 1}. ${markdownEscape(step)}`).join('\n') || '1. 参考关联运行证据复核。'}
`).join('\n');
  const executedIssueIds = new Set(report.executions.flatMap((item) => item.issueIds));
  const proofIssueIds = new Set(result.defectTickets.items.flatMap((item) => item.issueIds));
  const pendingIssues = result.issues.filter((item) => executedIssueIds.has(item.id) && !proofIssueIds.has(item.id)).map((item) => {
    const rootCause = result.rootCauseGroups.find((group) => group.issueIds.includes(item.id));
    const linkedCases = report.executions.filter((execution) => execution.issueIds.includes(item.id)).map((execution) => execution.testCaseId);
    const expected = uniq(linkedCases.flatMap((id) => plan.testCases.find((testCase) => testCase.id === id)?.expected ?? []));
    return `### ${item.id} [待确认] ${markdownEscape(item.title)}

- 严重程度：${item.severity}
- 关联用例：${linkedCases.join(', ') || '-'}
- 实际观察：${markdownEscape(item.description || item.reason)}
- 预期结果：${markdownEscape(expected.join('；') || '按关联需求和用例预期执行。')}
- 疑似位置：${rootCause?.sourceLocations.map((source) => `${source.file}:${source.line}`).join(', ') || '尚未建立可靠 source/runtime 绑定'}
- 定位状态：尚未达到 proof-ready，需按下列步骤复核后确认或关闭。

**复现步骤**

${item.reproduceSteps.map((step, index) => `${index + 1}. ${markdownEscape(step)}`).join('\n') || '1. 按关联用例重跑并保留运行证据。'}
`;
  }).join('\n');
  return `# FrontLens 需求驱动测试报告

## 1. 测试结论

- 状态：**${report.status}**
- 测试计划状态：${report.planStatus}
- 发布建议：**${markdownEscape(report.releaseRecommendation)}**
- 用例总数：${report.summary.totalCount}
- 通过/失败/阻塞/部分/未执行：${report.summary.passedCount}/${report.summary.failedCount}/${report.summary.blockedCount}/${report.summary.partialCount}/${report.summary.notExecutedCount}
- P0 未关闭：${report.summary.p0OpenCount}
- 需求完整覆盖/存在缺口：${report.summary.requirementCoveredCount}/${report.summary.requirementGapCount}
- 受影响原业务回归：**${report.changeRegression.status}**（通过 ${report.changeRegression.passedCount}/${report.changeRegression.totalCount}，未执行 ${report.changeRegression.notExecutedCount}）
- 缺陷：${report.summary.defectCount}

## 2. 用例执行结果

| 用例 | 优先级 | 状态 | 标题 | 实际结果 | 缺陷/问题 |
| --- | --- | --- | --- | --- | --- |
${executionRows.join('\n')}

## 3. 需求追踪

| 需求 | 标题 | 实现结论 | 验证结论 | 用例 | 状态 | 问题 |
| --- | --- | --- | --- | --- | --- | --- |
${traceRows.join('\n')}

## 4. Git 变更影响与原业务回归

- 基础分支/目标：${markdownEscape(plan.changeImpact?.baseRef ?? '-')} → ${markdownEscape(plan.changeImpact?.headRef ?? 'HEAD')}
- 变更文件/影响模块：${plan.changeImpact?.changedFileCount ?? 0}/${plan.changeImpact?.modules.length ?? 0}
- 回归状态：**${report.changeRegression.status}**
- 直接/传播文件明细：${markdownEscape(plan.artifacts?.changeImpact ?? '见测试计划中的 changeImpact')}

| 影响目标 | 模块 | 优先级 | 状态 | 回归项 | 原有业务 | 实际结果 |
| --- | --- | --- | --- | --- | --- | --- |
${changeRows.join('\n') || '| - | - | - | not-applicable | 没有识别到代码变更回归目标 | - | - |'}

> 静态影响分析不是通过证据。只有状态为 passed 且存在独立运行证据的目标，才能声明对应原业务正常。

## 5. 缺陷与复现步骤

${defects || '没有生成 proof-ready 缺陷工单。'}

## 6. 失败与待确认问题

${pendingIssues || '没有与失败/部分用例直接绑定的待确认 raw issue。'}

## 7. 风险和未覆盖项

${report.executions.filter((item) => item.status !== 'passed').map((item) => `- ${item.testCaseId} [${item.status}] ${markdownEscape(item.actual)}`).join('\n') || '- 无'}
`;
}

/** Decision-first report for humans/LLMs. Full case rows remain in the detail artifact. */
export function formatCompactTestPlanExecutionReport(report: TestPlanExecutionReport, plan: TestPlanResult, result: QaResult): string {
  const caseById = new Map(plan.testCases.map((item) => [item.id, item]));
  const requirementLimit = 30;
  const openP0 = report.executions
    .filter((item) => caseById.get(item.testCaseId)?.priority === 'P0' && item.status !== 'passed')
    .slice(0, 20);
  const requirementRows = report.requirementTraceability.slice(0, requirementLimit).map((item) =>
    `| ${item.requirementId} | ${markdownEscape(item.title)} | ${item.implementationVerdict} | ${item.verificationVerdict} | ${[...new Set(item.statuses)].join(', ')} | ${item.issueIds.join(', ') || '-'} |`);
  const p0Rows = openP0.map((item) => {
    const planned = caseById.get(item.testCaseId);
    return `| ${item.testCaseId} | ${planned?.layer ?? '-'} | ${planned?.scenario ?? '-'} | ${item.status} | ${markdownEscape(truncateMiddle(item.actual, 180))} |`;
  });
  const changeRows = report.changeRegression.items.slice(0, 20).map((item) => {
    const target = plan.changeImpact?.regressionTargets.find((entry) => entry.id === item.targetId);
    return `| ${item.targetId} | ${markdownEscape(item.module)} | ${item.priority} | ${item.status} | ${target?.changedFiles.length ?? 0}/${target?.dependentFiles.length ?? 0} | ${markdownEscape(truncateMiddle(target?.businessFlows.slice(0, 3).join('；') ?? '-', 180))} | ${markdownEscape(truncateMiddle(item.actual, 160))} |`;
  });
  const defects = result.defectTickets.items.slice(0, 10).map((item) => `### ${item.id} ${markdownEscape(item.title)}

- 优先级：${item.priority}；严重程度：${item.severity}
- 代码位置：${item.sourceLocations.map((source) => `${source.file}:${source.line ?? '-'}`).join(', ') || '未定位'}
- 复现：${item.reproduceSteps.map((step, index) => `${index + 1}. ${markdownEscape(step)}`).join(' ') || '参考完整证据。'}
`).join('\n');
  const issueIds = new Set(report.executions.flatMap((item) => item.issueIds));
  const pending = result.issues.filter((item) => issueIds.has(item.id)).slice(0, 10)
    .map((item) => `- ${item.id} [待确认/${item.severity}] ${markdownEscape(item.title)}：${markdownEscape(truncateMiddle(item.description || item.reason, 180))}`);
  return `# FrontLens 需求驱动测试报告（决策摘要）

> 默认低 Token 报告。逐条用例、完整实际结果和证据引用位于 \`test-execution-details.md\`。

## 1. 结论

- 状态：**${report.status}**
- 计划状态：${report.planStatus}
- 发布建议：**${markdownEscape(report.releaseRecommendation)}**
- 用例：${report.summary.totalCount}；通过 ${report.summary.passedCount}；失败 ${report.summary.failedCount}；阻塞 ${report.summary.blockedCount}；部分 ${report.summary.partialCount}；未执行 ${report.summary.notExecutedCount}
- P0 未关闭：${report.summary.p0OpenCount}
- 需求完整覆盖/缺口：${report.summary.requirementCoveredCount}/${report.summary.requirementGapCount}
- 受影响原业务回归：**${report.changeRegression.status}**（${report.changeRegression.passedCount}/${report.changeRegression.totalCount} 通过）
- 已确认缺陷：${report.summary.defectCount}

## 2. 需求实现结论

| 需求 | 标题 | 实现结论 | 验证结论 | 用例状态 | 问题 |
| --- | --- | --- | --- | --- | --- |
${requirementRows.join('\n')}

${report.requirementTraceability.length > requirementLimit ? `其余 ${report.requirementTraceability.length - requirementLimit} 条需求请按需查看完整明细。` : ''}

## 3. P0 未关闭（最多展示 20 条）

| 用例 | 层级 | 场景 | 状态 | 原因 |
| --- | --- | --- | --- | --- |
${p0Rows.join('\n') || '| - | - | - | - | 无 |'}

${report.summary.p0OpenCount > openP0.length ? `其余 ${report.summary.p0OpenCount - openP0.length} 条请查看完整明细。` : ''}

## 4. 受影响原业务回归

- 基础分支/目标：${markdownEscape(plan.changeImpact?.baseRef ?? '-')} → ${markdownEscape(plan.changeImpact?.headRef ?? 'HEAD')}
- 变更文件/影响模块：${plan.changeImpact?.changedFileCount ?? 0}/${plan.changeImpact?.modules.length ?? 0}
- 直接/传播文件明细：${markdownEscape(plan.artifacts?.changeImpact ?? '见测试计划中的 changeImpact')}

| 影响目标 | 模块 | 优先级 | 状态 | 直接/传播文件 | 需要回归的原有业务 | 实际结果 |
| --- | --- | --- | --- | ---: | --- | --- |
${changeRows.join('\n') || '| - | - | - | not-applicable | 0/0 | 没有识别到代码变更回归目标 | - |'}

${report.changeRegression.items.length > changeRows.length ? `其余 ${report.changeRegression.items.length - changeRows.length} 条请查看完整明细。` : ''}

## 5. 已确认缺陷

${defects || '无 proof-ready 缺陷。'}

## 6. 待确认问题

${pending.join('\n') || '- 无与失败/部分用例直接绑定的待确认问题。'}
`;
}
