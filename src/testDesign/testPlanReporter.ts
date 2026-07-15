import type { PlannedTestCase, TestPlanResult } from '../types.js';
import { markdownEscape } from '../utils/text.js';

function textList(values: string[] | undefined): string {
  return values?.length ? values.map(markdownEscape).join('；') : '-';
}

function summary(result: TestPlanResult, audience: 'developer' | 'qa'): string {
  const cases = result.testCases.filter((item) => item.audiences.includes(audience));
  return `- 计划状态：**${result.status}**
- 需求：${result.summary.requirementCount}
- 测点：${result.summary.testPointCount}
- 本文用例：${cases.length}
- P0/P1/P2/P3：${cases.filter((item) => item.priority === 'P0').length}/${cases.filter((item) => item.priority === 'P1').length}/${cases.filter((item) => item.priority === 'P2').length}/${cases.filter((item) => item.priority === 'P3').length}
- Git 变更文件/影响模块/原业务回归用例：${result.summary.changeFileCount}/${result.summary.impactedModuleCount}/${result.summary.changeRegressionCaseCount}
- 阻塞用例准备度：**${result.blockerCoverage.status}**（已生成/就绪 ${result.blockerCoverage.coveredCount}，不适用 ${result.blockerCoverage.notApplicableCount}，缺失 ${result.blockerCoverage.missingCount}）`;
}

function caseDetails(item: PlannedTestCase): string {
  const preconditions = item.preconditions.map((value) => `- ${markdownEscape(value)}`).join('\n');
  const data = item.testData.map((value) => `- ${markdownEscape(value)}`).join('\n');
  const steps = item.steps.map((value, index) => `${index + 1}. ${markdownEscape(value)}`).join('\n');
  const expected = item.expected.map((value) => `- ${markdownEscape(value)}`).join('\n');
  return `### ${item.id} ${markdownEscape(item.title)}

| 优先级 | 阻塞 | 层级 | 场景 | 执行方式 | 关联需求 | 自动化绑定 |
| --- | --- | --- | --- | --- | --- | --- |
| ${item.priority} | ${item.blocker ? '是' : '否'} | ${item.layer} | ${item.scenario} | ${item.executionMode} | ${item.requirementIds.join(', ') || 'SYSTEM'} | ${markdownEscape(item.automationBinding ?? '-')} |

**前置条件**

${preconditions || '- 无'}

**测试数据**

${data || '- 无'}

**操作步骤**

${steps}

**预期结果**

${expected}
`;
}

function casesDocument(result: TestPlanResult, audience: 'developer' | 'qa'): string {
  const cases = result.testCases
    .filter((item) => item.audiences.includes(audience))
    .sort((a, b) => ({ P0: 0, P1: 1, P2: 2, P3: 3 }[a.priority] - ({ P0: 0, P1: 1, P2: 2, P3: 3 }[b.priority])) || a.id.localeCompare(b.id));
  const title = audience === 'developer' ? '开发提测前阻塞用例' : '测试工程师完整测试用例';
  const purpose = audience === 'developer'
    ? '只包含最高优先级 P0。任一用例失败即停止提测并修复。'
    : '包含全部优先级、全部适用层级和完整场景，用于正式测试执行。';
  return `# ${title}

${purpose}

## 概览

${summary(result, audience)}

## 阻塞用例准备度（不代表已执行）

| ID | 类别 | 状态 | 检查项 | 用例 |
| --- | --- | --- | --- | --- |
${result.blockerCoverage.items.map((item) => `| ${item.id} | ${item.category} | ${item.status} | ${markdownEscape(item.title)} | ${item.testCaseIds.join(', ') || '-'} |`).join('\n')}

## Git 变更影响与原业务回归

- 分析状态：**${result.changeImpact?.status ?? 'unavailable'}**
- 基础分支/目标：${markdownEscape(result.changeImpact?.baseRef ?? '-')} → ${markdownEscape(result.changeImpact?.headRef ?? 'HEAD')}
- 变更文件/影响模块/回归目标：${result.changeImpact?.changedFileCount ?? 0}/${result.changeImpact?.modules.length ?? 0}/${result.changeImpact?.regressionTargets.length ?? 0}
- 静态影响范围只用于选择用例；是否正常必须以本文件中 change-impact 用例的实际执行证据为准。

## 测试用例

${cases.map(caseDetails).join('\n---\n\n') || '没有适用用例。'}
`;
}

export function formatDeveloperTestCases(result: TestPlanResult): string {
  return casesDocument(result, 'developer');
}

export function formatQaTestCases(result: TestPlanResult): string {
  return casesDocument(result, 'qa');
}

export function formatRequirementDesign(result: TestPlanResult): string {
  const details = result.requirements.map((item, index) => `### ${item.id ?? `REQ-${index + 1}`} ${markdownEscape(item.title)}

- 优先级：${item.priority ?? 'P2'}
- 角色：${textList(item.roles)}
- 前置条件：${textList(item.preconditions)}
- 业务规则：${textList(item.businessRules)}
- 验收标准：${textList(item.acceptanceCriteria)}
- 状态流转：${textList(item.stateTransitions)}
- 前端范围：${textList(item.frontendScope)}
- 后端范围：${textList(item.backendScope)}
- API 范围：${textList(item.apiScope)}
- 代码范围：${textList(item.sourceScope)}
- 歧义：${textList(item.ambiguities)}
- 原文：${markdownEscape(item.sourceText)}
`).join('\n');
  return `# 结构化需求与测试点

## 概览

${summary(result, 'qa')}

## 结构化需求

${details || '未解析到需求。'}

## 前端、后端、API 和代码测点

| 测点 | 需求 | 层级 | 优先级 | 阻塞 | 场景 | 描述 |
| --- | --- | --- | --- | --- | --- | --- |
${result.testPoints.map((item) => `| ${item.id} | ${item.requirementId} | ${item.layer} | ${item.priority} | ${item.blocker ? '是' : '否'} | ${item.scenarios.join(', ')} | ${markdownEscape(item.description)} |`).join('\n') || '| - | - | - | - | - | - | 未生成测点 |'}

## 待确认项

${result.reviewQuestions.map((item) => `- ${markdownEscape(item)}`).join('\n') || '- 无'}

## Git 变更影响摘要

| 模块 | 类型 | 直接文件 | 传播文件 | 原有业务回归目标 | 置信度 |
| --- | --- | ---: | ---: | --- | --- |
${result.changeImpact?.modules.map((item) => `| ${markdownEscape(item.name)} | ${item.kinds.join(', ')} | ${item.directFiles.length} | ${item.dependentFiles.length} | ${markdownEscape(item.businessFlows.join('；'))} | ${item.confidence} |`).join('\n') || '| - | - | 0 | 0 | 未生成 | - |'}
`;
}

export function formatTestPlanTraceability(result: TestPlanResult): string {
  const rows = result.requirements.map((requirement, index) => {
    const id = requirement.id ?? `REQ-${index + 1}`;
    const points = result.testPoints.filter((item) => item.requirementId === id);
    const cases = result.testCases.filter((item) => item.requirementIds.includes(id));
    const layers = [...new Set(points.map((item) => item.layer))];
    const scenarioSet = new Set(cases.map((item) => item.scenario));
    const requiredScenarios = new Set(points.flatMap((item) => item.scenarios));
    const gaps = [...requiredScenarios].filter((item) => !scenarioSet.has(item));
    return `| ${id} | ${requirement.priority ?? 'P2'} | ${markdownEscape(requirement.title)} | ${layers.join(', ')} | ${points.map((item) => item.id).join(', ')} | ${cases.map((item) => item.id).join(', ')} | ${gaps.join(', ') || '无'} |`;
  });
  return `# 测试设计追踪矩阵

该矩阵证明每条需求已连接到前端、后端、API 或代码测点及具体测试用例。

| 需求 | 优先级 | 标题 | 覆盖层级 | 测点 | 测试用例 | 场景缺口 |
| --- | --- | --- | --- | --- | --- | --- |
${rows.join('\n') || '| - | - | 未解析到需求 | - | - | - | 阻塞 |'}

## Git 变更 → 影响模块 → 原业务回归用例

| 影响目标 | 模块 | 优先级 | 直接变更 | 传播文件 | 业务流程 | 测试用例 |
| --- | --- | --- | --- | --- | --- | --- |
${result.changeImpact?.regressionTargets.map((target) => {
    const cases = result.testCases.filter((item) => item.changeImpactIds?.includes(target.id));
    return `| ${target.id} | ${markdownEscape(target.module)} | ${target.priority} | ${target.changedFiles.map(markdownEscape).join(', ')} | ${target.dependentFiles.map(markdownEscape).join(', ') || '-'} | ${markdownEscape(target.businessFlows.join('；'))} | ${cases.map((item) => item.id).join(', ') || '-'} |`;
  }).join('\n') || '| - | - | - | - | - | 未生成 | - |'}
`;
}
