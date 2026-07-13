import path from 'node:path';
import type {
  BlockerCoverageItem,
  PlannedTestCase,
  RequirementPriority,
  RequirementWizardCandidate,
  TestLayer,
  TestPlanResult,
  TestPointItem,
  TestScenario
} from '../types.js';
import { synthesizeRequirements } from '../requirements/requirementWizard.js';
import { ensureDir, writeJson, writeText } from '../utils/fs.js';
import {
  formatDeveloperTestCases,
  formatQaTestCases,
  formatRequirementDesign,
  formatTestPlanTraceability
} from './testPlanReporter.js';
import { compactTestPlan } from './testPlanCompact.js';

export interface BuildTestPlanInput {
  text?: string;
  inputPath?: string;
  outputDir?: string;
  sourceRoot?: string;
  prefix?: string;
}

function uniq(items: Array<string | undefined>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item?.trim())).map((item) => item.trim()))];
}

function priorityRank(value: RequirementPriority): number {
  return { P0: 0, P1: 1, P2: 2, P3: 3 }[value];
}

function requirementId(requirement: RequirementWizardCandidate, index: number): string {
  return requirement.id ?? `REQ-${String(index + 1).padStart(3, '0')}`;
}

function isMutation(text: string): boolean {
  return /新增|创建|编辑|修改|删除|提交|保存|上传|导入|审批|审核|发布|create|update|edit|delete|submit|save|upload|import/i.test(text);
}

function isCore(requirement: RequirementWizardCandidate): boolean {
  // priorityOf() has already applied explicit P0-P3 and keyword fallback. Do not
  // silently promote an explicitly declared P1/P2 requirement merely because
  // its sentence contains words such as “必须”.
  return requirement.priority === 'P0';
}

function isPermissionSensitive(requirement: RequirementWizardCandidate, text = `${requirement.title} ${requirement.description ?? ''}`): boolean {
  const specificRoles = (requirement.roles ?? []).filter((role) => !/^(用户|user)$/i.test(role.trim()));
  return specificRoles.length > 0 || /权限|越权|鉴权|未授权|无权限|不能看到|不能执行|仅[^，。,；;]{0,20}(?:可以|可|允许)|只有[^，。,；;]{0,20}(?:可以|可|允许)|permission|authoriz|forbidden/i.test(text);
}

function scenariosFor(requirement: RequirementWizardCandidate, layer: TestLayer): TestScenario[] {
  const text = `${requirement.title} ${requirement.description ?? ''}`;
  const scenarios = new Set<TestScenario>(['positive', 'regression']);
  if (isCore(requirement)) scenarios.add('smoke');
  if (/输入|表单|参数|字段|搜索|筛选|上传|导入|校验|格式|必填|form|input|parameter|validation/i.test(text) || layer === 'api' || layer === 'backend') scenarios.add('negative');
  if (/输入|参数|数量|金额|长度|分页|上限|下限|至少|最多|边界|列表|批量|时间|日期|file|size/i.test(text) || layer === 'api' || layer === 'backend') scenarios.add('boundary');
  if (isPermissionSensitive(requirement, text)) scenarios.add('permission');
  if ((requirement.stateTransitions?.length ?? 0) > 0 || /状态|提交|审批|审核|发布|撤回|启用|禁用|删除/i.test(text)) scenarios.add('state-transition');
  if (/数据|金额|数量|统计|列表|保存|创建|更新|删除|一致|数据库/i.test(text) || layer === 'backend') scenarios.add('consistency');
  if (isMutation(text) && (layer === 'backend' || layer === 'api' || layer === 'frontend')) scenarios.add('idempotency');
  if (/接口|网络|请求|超时|重试|加载|上传|下载|API/i.test(text) || layer === 'api') scenarios.add('recovery');
  if (layer === 'source') return ['positive', 'negative', 'regression'];
  return [...scenarios];
}

function layersFor(requirement: RequirementWizardCandidate): TestLayer[] {
  const text = `${requirement.title} ${requirement.description ?? ''}`;
  const layers = new Set<TestLayer>();
  const explicitCodeOnly = /typecheck|lint|单元测试|集成测试|代码检查|构建必须|tests?\s+必须|source\s+check/i.test(text)
    && !/页面|按钮|输入|表单|弹窗|显示|隐藏|跳转|列表|搜索|接口|请求|响应|保存|创建|更新|删除|上传|导出|下载|API/i.test(text);
  if (explicitCodeOnly) return ['source'];
  if ((requirement.frontendScope?.length ?? 0) > 0 || /页面|按钮|点击|输入|表单|弹窗|显示|隐藏|跳转|列表|搜索|筛选|重置|分页|上一页|下一页|排序|详情|上传|导入|导出|下载|前端|UI/i.test(text)) layers.add('frontend');
  if ((requirement.backendScope?.length ?? 0) > 0 || /数据|保存|创建|更新|删除|权限|事务|并发|后端|服务/i.test(text)) layers.add('backend');
  if ((requirement.apiScope?.length ?? 0) > 0 || (requirement.apiPatterns?.length ?? 0) > 0 || /接口|请求|响应|状态码|错误码|API/i.test(text)) layers.add('api');
  if (isPermissionSensitive(requirement, text)) {
    layers.add('frontend');
    layers.add('backend');
    layers.add('api');
  }
  // FrontLens is a frontend-led QA tool: a requirement without an explicit layer still needs observable UI verification.
  if (layers.size === 0) layers.add('frontend');
  layers.add('source');
  return [...layers];
}

function pointDescription(requirement: RequirementWizardCandidate, layer: TestLayer): string {
  const explicit = {
    frontend: requirement.frontendScope,
    backend: requirement.backendScope,
    api: requirement.apiScope,
    source: requirement.sourceScope
  }[layer];
  if (explicit?.length) return explicit.join('；');
  if (layer === 'frontend') return `验证「${requirement.title}」的页面展示、交互、反馈和前后端绑定。`;
  if (layer === 'backend') return `验证「${requirement.title}」的业务规则、数据持久化、权限和异常处理。`;
  if (layer === 'api') return `验证「${requirement.title}」相关接口的参数、响应、错误码和契约。`;
  return `检查「${requirement.title}」对应实现分支、错误处理、静态检查和自动化测试。`;
}

export function generateTestPoints(requirements: RequirementWizardCandidate[]): TestPointItem[] {
  const points: TestPointItem[] = [];
  requirements.forEach((requirement, reqIndex) => {
    const reqId = requirementId(requirement, reqIndex);
    for (const layer of layersFor(requirement)) {
      points.push({
        id: `TP-${String(points.length + 1).padStart(4, '0')}`,
        requirementId: reqId,
        layer,
        title: `${requirement.title}（${layer}）`,
        description: pointDescription(requirement, layer),
        priority: requirement.priority ?? 'P2',
        blocker: isCore(requirement),
        scenarios: scenariosFor(requirement, layer),
        rationale: `来自 ${reqId}；${layer} 层需要独立证据，不能由其他层的通过结果替代。`
      });
    }
  });
  return points;
}

function casePriority(point: TestPointItem, scenario: TestScenario, requirement: RequirementWizardCandidate): RequirementPriority {
  const text = `${requirement.title} ${requirement.description ?? ''}`;
  if (scenario === 'smoke' && point.blocker) return 'P0';
  if (point.priority === 'P0') {
    if (scenario === 'positive') return point.layer === 'source' && !/代码|typecheck|lint|test|构建|单元测试|集成测试/i.test(text) ? 'P1' : 'P0';
    if (scenario === 'permission' && /权限|角色|管理员|普通用户|越权|鉴权|auth|permission/i.test(text)) return 'P0';
    if ((scenario === 'consistency' || scenario === 'idempotency') && /数据|金额|数量|保存|创建|更新|删除|提交|上传|导入/i.test(text)) return 'P0';
    return 'P1';
  }
  if (scenario === 'positive' && point.priority === 'P1') return 'P1';
  if (scenario === 'permission' || scenario === 'state-transition' || scenario === 'consistency') return priorityRank(point.priority) <= 1 ? point.priority : 'P2';
  if (scenario === 'regression') return priorityRank(point.priority) <= 1 ? 'P1' : 'P3';
  return point.priority;
}

function scenarioTitle(value: TestScenario): string {
  return {
    smoke: '阻塞冒烟', positive: '正常流程', negative: '异常输入', boundary: '边界条件', permission: '角色权限',
    'state-transition': '状态流转', consistency: '数据一致性', idempotency: '重复提交与幂等', recovery: '失败恢复', regression: '代码回归'
  }[value];
}

function testDataFor(requirement: RequirementWizardCandidate, scenario: TestScenario): string[] {
  const values: string[] = [];
  if (requirement.roles?.length) values.push(`角色账号：${requirement.roles.join('、')}`);
  if (scenario === 'positive' || scenario === 'smoke') values.push('一组满足业务规则的有效数据');
  if (scenario === 'negative') values.push('空值、非法格式、无效枚举或不存在的关联数据');
  if (scenario === 'boundary') {
    values.push('最小值、最大值、临界值及临界值两侧数据');
    const text = `${requirement.title} ${requirement.description ?? ''}`;
    for (const match of text.matchAll(/(\d+(?:\.\d+)?)\s*(KB|MB|GB|B|个|条|次|字符)/gi)) {
      const limit = `${match[1]}${match[2].toUpperCase()}`;
      values.push(`显式边界：${limit} 以下 1 单位、等于 ${limit}、超过 ${limit} 1 单位`);
    }
    const extensions = [...text.matchAll(/\b([a-z0-9]+(?:\/[a-z0-9.+-]+)?)(?=\s*[\/、,，]|\s*(?:文件|格式|类型))/gi)].map((match) => match[1]);
    if (/上传|文件|格式|扩展名|MIME/i.test(text) && extensions.length) values.push(`文件类型：${uniq(extensions).join('、')}、未允许扩展名、扩展名与 MIME 不一致`);
  }
  if (scenario === 'idempotency') values.push('可重复使用且可清理的唯一测试数据');
  if (scenario === 'consistency') values.push('可在 UI、API 和持久化层交叉核对的数据');
  return uniq(values.length ? values : ['不需要专用测试数据']);
}

function stepsFor(requirement: RequirementWizardCandidate, point: TestPointItem, scenario: TestScenario): string[] {
  const req = requirement.title;
  const layer = point.layer;
  const base: Record<TestScenario, string[]> = {
    smoke: [`准备 ${req} 的最小可用前置条件。`, `执行一次 ${req} 核心路径。`, '检查流程能继续且关键结果可观察。'],
    positive: [`准备满足规则的有效数据。`, `在 ${layer} 层执行 ${req}。`, '读取并核对操作结果。'],
    negative: ['依次使用空值、非法格式和无效关联数据。', `执行 ${req}。`, '检查拒绝行为、错误码/错误提示和数据副作用。'],
    boundary: ['准备最小值、最大值、临界值及超界值。', `逐组执行 ${req}。`, '核对每个边界的接受或拒绝结果。'],
    permission: [`使用需求涉及的每个角色分别执行 ${req}。`, '直接访问页面入口和 API，不能只检查按钮隐藏。', '核对授权结果及审计/错误反馈。'],
    'state-transition': ['准备每个允许的起始状态。', `执行触发 ${req} 的状态操作。`, '再次读取实体状态，并尝试非法状态跳转。'],
    consistency: [`通过 ${layer} 层执行 ${req}。`, '重新加载页面并重新请求查询接口。', '交叉核对 UI、API 返回和持久化结果。'],
    idempotency: [`对同一业务数据连续或并发执行两次 ${req}。`, '等待所有响应完成。', '查询最终数据及重复记录。'],
    recovery: ['模拟请求超时、断网、4xx 和 5xx。', `执行 ${req} 并观察失败反馈。`, '恢复依赖后重试，检查页面和数据能否恢复。'],
    regression: [`定位 ${req} 对应源码和 Git 变更。`, '运行 typecheck、lint、单元测试和相关集成测试。', '检查相邻分支、错误处理及旧功能是否受影响。']
  };
  return uniq([...(requirement.preconditions?.map((item) => `确认前置条件：${item}`) ?? []), ...base[scenario]]);
}

function expectedFor(requirement: RequirementWizardCandidate, point: TestPointItem, scenario: TestScenario): string[] {
  const explicit = requirement.acceptanceCriteria?.length ? requirement.acceptanceCriteria : [requirement.description ?? requirement.title];
  const common = scenario === 'negative' || scenario === 'boundary'
    ? ['系统对无效数据给出明确反馈；不得产生未预期的数据变更。']
    : scenario === 'permission'
      ? ['仅授权角色可以执行；隐藏入口不能代替后端鉴权。']
      : scenario === 'idempotency'
        ? ['重复请求不会生成重复业务数据，最终状态确定且一致。']
        : scenario === 'recovery'
          ? ['失败可见、可恢复，不把错误伪装为空数据或成功。']
          : scenario === 'regression'
            ? ['相关静态检查和自动化测试通过；关键错误分支有代码或测试证据。']
            : [`${point.layer} 层行为满足需求验收结果。`];
  return uniq([...explicit.map((item) => `满足：${item}`), ...common]);
}

function executionMode(requirement: RequirementWizardCandidate, layer: TestLayer, scenario: TestScenario): PlannedTestCase['executionMode'] {
  if (layer === 'source') return 'automated';
  if (layer === 'backend') return 'hybrid';
  if (scenario === 'permission' || scenario === 'consistency' || scenario === 'state-transition') return 'hybrid';
  if (layer === 'api') return (requirement.apiPatterns?.length ?? 0) > 0 && (scenario === 'positive' || scenario === 'smoke' || scenario === 'recovery') ? 'automated' : 'hybrid';
  if (layer === 'frontend') return (requirement.journeyNames?.length ?? 0) > 0 || (requirement.interactionKinds?.length ?? 0) > 0 ? 'automated' : 'hybrid';
  return 'hybrid';
}

export function generatePlannedTestCases(requirements: RequirementWizardCandidate[], points: TestPointItem[]): PlannedTestCase[] {
  const byId = new Map(requirements.map((item, index) => [requirementId(item, index), item]));
  const cases: PlannedTestCase[] = [];
  for (const point of points) {
    const requirement = byId.get(point.requirementId);
    if (!requirement) continue;
    for (const scenario of point.scenarios) {
      const priority = casePriority(point, scenario, requirement);
      cases.push({
        id: `TC-PLAN-${String(cases.length + 1).padStart(4, '0')}`,
        requirementIds: [point.requirementId],
        testPointIds: [point.id],
        layer: point.layer,
        scenario,
        title: `${requirement.title}：${scenarioTitle(scenario)}（${point.layer}）`,
        priority,
        blocker: priority === 'P0',
        audiences: priority === 'P0' ? ['developer', 'qa'] : ['qa'],
        preconditions: uniq(requirement.preconditions?.length ? requirement.preconditions : ['目标环境可访问，测试账号和基础数据已准备。']),
        testData: testDataFor(requirement, scenario),
        steps: stepsFor(requirement, point, scenario),
        expected: expectedFor(requirement, point, scenario),
        executionMode: executionMode(requirement, point.layer, scenario),
        automationBinding: point.layer === 'source'
          ? 'source-health/typecheck/lint/unit-test'
          : requirement.journeyNames?.[0] ?? requirement.apiPatterns?.[0] ?? requirement.interactionKinds?.join(','),
        sourceRefs: requirement.sourceRefs ?? [],
        tags: uniq([point.layer, scenario, requirement.priority, priority === 'P0' ? 'blocker' : undefined])
      });
    }
  }
  return cases;
}

interface BlockerRule {
  category: BlockerCoverageItem['category'];
  title: string;
  applicable: (requirements: RequirementWizardCandidate[]) => boolean;
  matches: (testCase: PlannedTestCase) => boolean;
  layer: TestLayer;
  steps: string[];
  expected: string[];
}

const blockerRules: BlockerRule[] = [
  { category: 'availability', title: '应用和核心页面可访问', applicable: () => true, matches: (item) => item.scenario === 'smoke' && item.layer === 'frontend', layer: 'frontend', steps: ['启动或访问目标应用。', '打开核心页面入口。', '检查页面主体和必要静态资源。'], expected: ['应用可访问，核心页面可渲染，无阻断性脚本错误。'] },
  { category: 'authentication', title: '核心用户可以完成登录或会话恢复', applicable: (reqs) => reqs.some((item) => /登录|会话|鉴权|账号|auth|login|session/i.test(`${item.title} ${item.description ?? ''}`)), matches: (item) => item.scenario === 'permission' && item.priority === 'P0', layer: 'frontend', steps: ['使用有效账号登录。', '刷新并重新进入核心页面。', '验证失效会话被正确处理。'], expected: ['有效用户可登录；会话有效；失效会话不会进入错误业务状态。'] },
  { category: 'core-flow', title: '核心业务主流程闭环', applicable: () => true, matches: (item) => item.scenario === 'smoke' && item.priority === 'P0', layer: 'frontend', steps: ['准备核心流程最小数据。', '从入口执行至最终成功状态。', '重新查询最终结果。'], expected: ['核心流程可以闭环，最终结果持久化且可查询。'] },
  { category: 'data-integrity', title: '关键写操作不丢失、不重复、不污染数据', applicable: (reqs) => reqs.some((item) => isMutation(`${item.title} ${item.description ?? ''}`) || /金额|余额|库存|支付|订单|账务/.test(`${item.title} ${item.description ?? ''}`)), matches: (item) => item.priority === 'P0' && (item.scenario === 'consistency' || item.scenario === 'idempotency'), layer: 'backend', steps: ['执行一次关键写操作。', '重复提交并重新读取数据。', '检查失败回滚和关联数据。'], expected: ['数据完整、一致、无重复；失败时不保留半成品数据。'] },
  { category: 'authorization', title: '关键操作具备前后端权限控制', applicable: (reqs) => reqs.some((item) => isPermissionSensitive(item)), matches: (item) => item.scenario === 'permission' && item.priority === 'P0', layer: 'api', steps: ['分别使用授权和未授权角色访问入口。', '直接调用关键 API。', '检查响应、数据和审计记录。'], expected: ['授权角色可用；未授权角色在前端和后端都被拒绝。'] },
  { category: 'dependency', title: '关键 API/依赖失败不会伪装成功', applicable: (reqs) => reqs.some((item) => (item.apiPatterns?.length ?? 0) > 0 || /接口|请求|API|服务/.test(`${item.title} ${item.description ?? ''}`)), matches: (item) => item.scenario === 'recovery' && item.priority === 'P0', layer: 'api', steps: ['模拟关键依赖超时和 5xx。', '执行核心操作。', '恢复依赖并重试。'], expected: ['失败明确可见且不写入错误数据；依赖恢复后可重试。'] },
  { category: 'compatibility', title: '代码和数据结构变更不阻断旧功能', applicable: (reqs) => reqs.some((item) => /升级|迁移|兼容|旧数据|版本|字段|schema|migration/i.test(`${item.title} ${item.description ?? ''}`)), matches: (item) => item.scenario === 'regression' && item.priority === 'P0', layer: 'source', steps: ['准备旧版本数据或旧调用方式。', '运行迁移和相关回归测试。', '检查新旧路径读取结果。'], expected: ['升级后旧数据和既有关键调用仍可用，迁移可重复执行。'] }
];

function ensureBlockerCoverage(requirements: RequirementWizardCandidate[], cases: PlannedTestCase[]): { cases: PlannedTestCase[]; items: BlockerCoverageItem[] } {
  const result = [...cases];
  const items: BlockerCoverageItem[] = [];
  for (const [index, rule] of blockerRules.entries()) {
    const applicableRequirementIds = new Set(requirements
      .map((requirement, requirementIndex) => ({ requirement, id: requirementId(requirement, requirementIndex) }))
      .filter(({ requirement }) => rule.applicable([requirement]))
      .map(({ id }) => id));
    if (applicableRequirementIds.size === 0) {
      items.push({ id: `BLOCK-${String(index + 1).padStart(2, '0')}`, category: rule.category, title: rule.title, status: 'not-applicable', testCaseIds: [], reason: '需求中未识别到该阻塞类别的适用信号。' });
      continue;
    }
    let matched = result.filter((item) => rule.matches(item) && (
      item.tags.includes(rule.category)
      || item.requirementIds.some((id) => applicableRequirementIds.has(id))
    ));
    if (matched.length === 0) {
      const synthetic: PlannedTestCase = {
        id: `TC-PLAN-${String(result.length + 1).padStart(4, '0')}`,
        requirementIds: [],
        testPointIds: [],
        layer: rule.layer,
        scenario: rule.category === 'dependency' ? 'recovery' : rule.category === 'authorization' ? 'permission' : rule.category === 'compatibility' ? 'regression' : rule.category === 'data-integrity' ? 'consistency' : 'smoke',
        title: `系统级阻塞检查：${rule.title}`,
        priority: 'P0',
        blocker: true,
        audiences: ['developer', 'qa'],
        preconditions: ['目标环境、核心账号和最小测试数据已准备。'],
        testData: ['核心流程最小有效数据'],
        steps: rule.steps,
        expected: rule.expected,
        executionMode: 'hybrid',
        sourceRefs: [],
        tags: ['system', 'blocker', rule.category]
      };
      result.push(synthetic);
      matched = [synthetic];
    }
      items.push({ id: `BLOCK-${String(index + 1).padStart(2, '0')}`, category: rule.category, title: rule.title, status: 'drafted', testCaseIds: matched.map((item) => item.id), reason: '已生成至少一条 P0 草案；只有执行报告中的独立证据才能证明通过。' });
  }
  return { cases: result, items };
}

function buildSummary(requirements: RequirementWizardCandidate[], points: TestPointItem[], cases: PlannedTestCase[]): TestPlanResult['summary'] {
  const countPriority = (priority: RequirementPriority) => cases.filter((item) => item.priority === priority).length;
  const countLayer = (layer: TestLayer) => cases.filter((item) => item.layer === layer).length;
  return {
    requirementCount: requirements.length,
    testPointCount: points.length,
    testCaseCount: cases.length,
    developerCaseCount: cases.filter((item) => item.audiences.includes('developer')).length,
    qaCaseCount: cases.filter((item) => item.audiences.includes('qa')).length,
    p0Count: countPriority('P0'), p1Count: countPriority('P1'), p2Count: countPriority('P2'), p3Count: countPriority('P3'),
    frontendCount: countLayer('frontend'), backendCount: countLayer('backend'), apiCount: countLayer('api'), sourceCount: countLayer('source'),
    needsReviewRequirementCount: requirements.filter((item) => item.needsReview).length
  };
}

export async function buildTestPlan(input: BuildTestPlanInput): Promise<TestPlanResult> {
  const wizard = await synthesizeRequirements({ text: input.text, inputPath: input.inputPath, prefix: input.prefix, inferFromPage: false });
  const requirements = wizard.candidates;
  const points = generateTestPoints(requirements);
  const generatedCases = generatePlannedTestCases(requirements, points);
  const blocker = ensureBlockerCoverage(requirements, generatedCases);
  const coveredCount = blocker.items.filter((item) => item.status === 'drafted' || item.status === 'ready').length;
  const missingCount = blocker.items.filter((item) => item.status === 'missing').length;
  const notApplicableCount = blocker.items.filter((item) => item.status === 'not-applicable').length;
  const status: TestPlanResult['status'] = requirements.length === 0 || missingCount > 0
    ? 'blocked'
    : requirements.some((item) => item.needsReview)
      ? 'needs-review'
      : 'ready';
  const result: TestPlanResult = {
    schemaVersion: '1.0',
    generatedAt: new Date().toISOString(),
    source: { inputPath: input.inputPath, sourceRoot: input.sourceRoot, requirementCount: requirements.length },
    status,
    requirements,
    testPoints: points,
    testCases: blocker.cases,
    blockerCoverage: { status: missingCount ? 'incomplete' : blocker.items.some((item) => item.status === 'drafted') ? 'drafted' : 'ready', coveredCount, missingCount, notApplicableCount, items: blocker.items },
    summary: buildSummary(requirements, points, blocker.cases),
    reviewQuestions: uniq([...wizard.questions, ...requirements.flatMap((item) => item.reviewNotes)])
  };
  if (input.outputDir) {
    const outputDir = path.resolve(input.outputDir);
    await ensureDir(outputDir);
    const artifacts = {
      json: path.join(outputDir, 'test-plan.json'),
      summary: path.join(outputDir, 'test-plan-summary.json'),
      manifest: path.join(outputDir, 'artifact-manifest.json'),
      requirements: path.join(outputDir, 'requirements.md'),
      developerCases: path.join(outputDir, 'developer-test-cases.md'),
      qaCases: path.join(outputDir, 'qa-full-test-cases.md'),
      traceability: path.join(outputDir, 'test-design-traceability.md')
    };
    result.artifacts = artifacts;
    await writeJson(artifacts.json, result);
    await Promise.all([
      writeJson(artifacts.summary, compactTestPlan(result)),
      writeJson(artifacts.manifest, {
        generatedAt: result.generatedAt,
        recommendedReadOrder: [artifacts.summary, artifacts.requirements, artifacts.developerCases],
        readOnDemand: [artifacts.traceability, artifacts.qaCases],
        avoidLoadingIntoLlmByDefault: [artifacts.json],
        note: 'The full JSON and QA case document are machine/full-detail artifacts. Start with test-plan-summary.json.'
      }),
      writeText(artifacts.requirements, formatRequirementDesign(result)),
      writeText(artifacts.developerCases, formatDeveloperTestCases(result)),
      writeText(artifacts.qaCases, formatQaTestCases(result)),
      writeText(artifacts.traceability, formatTestPlanTraceability(result))
    ]);
  }
  return result;
}
