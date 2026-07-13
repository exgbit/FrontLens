# FrontLens 需求驱动测试操作指南

本指南覆盖完整流程：需求文档 → 前端/后端/API/代码测点 → 分级测试用例 → 开发阻塞自测 → FrontLens 执行 → 缺陷复现 → Markdown 报告。

## 1. 安装与构建

环境要求：Node.js 20 或更高版本。

```bash
npm install
npm run build
```

查看命令：

```bash
node dist/cli.js --help
```

CLI/MCP 默认返回有界低 Token 摘要；只有需要逐条结构化明细时才使用 CLI `--json` 或 MCP `detail=true`。生成到目录后优先读取 `*-summary.json` 和精简 Markdown。

## 2. 准备需求文档

输入使用 UTF-8 Markdown 或文本。每条可验收行为单独一行，建议显式写出：

- P0～P3 优先级；
- 使用角色；
- 前置条件；
- 操作和可观察结果；
- API 路径、错误码或状态变化；
- 边界、权限和数据一致性规则。

示例：

```markdown
- P0 管理员必须可以搜索用户，页面显示“搜索结果”，并调用 GET /api/users。
- P1 普通用户不能删除用户，直接调用删除接口时返回 403。
- P1 删除成功后状态从存在 -> 已删除，重复请求不得产生脏数据。
```

完整示例位于 `examples/demo-prd.md`。

## 3. 生成结构化需求、测点和完整用例

```bash
node dist/cli.js test-plan \
  --input examples/demo-prd.md \
  --source-root examples/demo-app \
  --output reports/demo-plan
```

输出：

| 文件 | 用途 |
| --- | --- |
| `test-plan.json` | 后续执行和报告使用的唯一机器可读测试计划 |
| `requirements.md` | 结构化需求及前端、后端、API、代码测点 |
| `developer-test-cases.md` | 仅 P0，开发提测前必须执行 |
| `qa-full-test-cases.md` | P0～P3 全部适用测试用例 |
| `test-design-traceability.md` | 需求 → 测点 → 用例及场景缺口 |

规则：

- 开发版只包含最高优先级 P0；
- QA 版包含全部优先级；
- 每条业务需求至少生成可观察层和代码层测点；
- 根据需求信号生成正常、异常、边界、权限、状态、数据一致性、幂等、恢复和回归场景；
- 系统启动、核心页面、核心流程、鉴权、数据完整性、依赖失败和兼容性通过阻塞覆盖矩阵检查；
- 不适用项明确标记 `not-applicable`，不会假装已覆盖。

计划为 `needs-review` 时，先处理 `requirements.md` 中的待确认项。待确认不影响生成草案，但不能直接作为最终发布依据。

## 4. 开发提测前检查

开发打开：

```text
reports/demo-plan/developer-test-cases.md
```

逐条执行 P0。任一 P0 失败时停止提测。代码侧至少运行：

```bash
npm run check
npm test
npm run build
```

目标项目脚本名不同，可以在正式 QA 时用 `--source-scripts` 指定：

```bash
--source-run-scripts --source-scripts "typecheck,lint,test"
```

## 5. 执行前端、API 和代码测试

先启动被测项目。FrontLens 自带示例：

```bash
node examples/server.mjs
```

另一个终端运行：

```bash
node dist/cli.js qa \
  --url http://127.0.0.1:4173 \
  --config examples/demo-app/frontlens.config.json \
  --requirements reports/demo-plan/test-plan.json \
  --source-root examples/demo-app \
  --source-run-scripts \
  --source-scripts "typecheck,lint,test" \
  --output reports/demo-qa \
  --sme
```

说明：

- `--requirements test-plan.json` 会读取结构化需求，并在 QA 结束后自动消费完整计划，生成 `planned-test-execution.json` 和 `planned-test-report.md`；
- 浏览器采集页面、交互、请求、控制台和运行证据；
- API contract 检查请求状态和响应结构；
- source analyzer 将运行问题和源码位置关联；
- `--source-run-scripts` 执行目标项目明确指定的静态检查与测试脚本；
- 全局 `typecheck/lint/test` 通过只证明仓库健康，不会自动证明每条需求已实现；要关闭后端/API/source 的具体场景，需在目标项目提供 `.frontlens/test-evidence.json`；
- 写操作默认不会自动执行。需要真实创建、编辑、删除、上传时，在测试环境配置对应 journey 和允许项，然后重跑；
- 未独立执行的场景保持 `needs-input`，不会因为正常路径通过而被批量判定为通过。
- `automated` 只用于已有 journey/interaction/API/source binding 的用例；后端持久化、角色态等没有专属证据时保持 `hybrid/needs-input`。
- API 与异常模拟证据严格按 HTTP method、模板路径和 PRD 明确状态码匹配；预期的 401/403/404 等非 2xx 是验收结果，不会被当成正常路径失败，其他 method 的同路径流量也不能关闭该用例。

### 5.1 将后端测试绑定到需求

在目标项目创建 `.frontlens/test-evidence.json`。只有清单中的 `requirementIds + layer + scenarios` 与计划用例完全匹配，且 `scriptNames` 本轮实际执行通过，该用例才会记为 `passed`：

```json
{
  "bindings": [
    {
      "id": "USER-DELETE-AUTH",
      "requirementIds": ["REQ-008"],
      "layer": "backend",
      "scenarios": ["permission", "negative"],
      "scriptNames": ["test"],
      "evidenceRefs": ["test/users.delete.test.ts"]
    }
  ]
}
```

规则：关联脚本失败则仅失败对应需求/层级/场景；无需求专属绑定的全局代码检查失败记为系统级阻塞，不会把所有业务需求误判为 `implementation-mismatch`。

## 6. 生成最终 Markdown 报告

```bash
node dist/cli.js test-report \
  --plan reports/demo-plan/test-plan.json \
  --report reports/demo-qa/result.json \
  --output reports/demo-final
```

输出：

```text
reports/demo-final/test-execution-report.json
reports/demo-final/test-execution-summary.json
reports/demo-final/test-report.md
reports/demo-final/test-execution-details.md
reports/demo-final/artifact-manifest.json
```

最终报告包含：

- 测试结论和发布建议；
- 用例通过、失败、阻塞、部分、未执行统计；
- P0 未关闭数量；
- 需求 → 用例 → 状态 → 问题追踪；
- proof-ready 缺陷；
- 复现步骤；
- 初步代码位置；
- 风险和未覆盖项。

## 7. 缺陷处理

正式缺陷列表还可以单独导出：

```bash
node dist/cli.js defect-tickets --report reports/demo-qa/result.json
```

需求追踪：

```bash
node dist/cli.js traceability --report reports/demo-qa/result.json
```

只查看开发可修复且证据充分的问题：

```bash
node dist/cli.js suggestions --report reports/demo-qa/result.json
```

## 8. 登录、角色和权限测试

以下命令用于**具备真实登录页和多角色账号的被测项目**；示例应用没有登录会话，不应把不存在的 `/login`、`/users` 当成可运行示例。保存登录状态：

```bash
node dist/cli.js auth save \
  --url https://test.example.com/login \
  --output .frontlens/auth/admin.json
```

执行角色矩阵：

```bash
node dist/cli.js role-matrix \
  --url https://test.example.com/users \
  --role admin=.frontlens/auth/admin.json \
  --role viewer=.frontlens/auth/viewer.json \
  --requirements reports/demo-plan/test-plan.json \
  --output reports/demo-roles
```

权限测试必须同时验证页面入口和直接 API 调用，按钮隐藏不能代替后端鉴权。

## 9. CI 推荐命令

```bash
npm run check
npm test
npm run build

node dist/cli.js qa \
  --url "$TEST_URL" \
  --requirements reports/test-plan/test-plan.json \
  --source-root "/path/to/target-app" \
  --source-run-scripts \
  --source-scripts "typecheck,lint,test" \
  --output reports/qa \
  --sme \
  --fail-on high

node dist/cli.js test-report \
  --plan reports/test-plan/test-plan.json \
  --report reports/qa/result.json \
  --output reports/final \
  --fail-on-blocked
```

CI 应以以下任一条件失败：

- P0 用例未关闭；
- QA quality gate 为 `fail` 或 `blocked`；
- source health 脚本失败；
- 存在达到 `--fail-on` 阈值且证据充分的缺陷。

## 10. 常见问题

### 为什么计划状态是 `needs-review`？

需求存在歧义，或缺少 selector、期望文案、API、角色、测试数据等可执行信息。测试用例已经生成，但需要产品、开发或测试确认预期。

### 为什么需求正常流程通过，最终报告仍不是 passed？

正常路径不能替代异常、边界、权限、幂等和恢复场景。没有独立证据的用例保持未执行，这是为了防止测试覆盖率被虚高。

### 为什么测试用例很多？

`developer-test-cases.md` 已收敛为 P0；测试工程师使用全量文件。低风险场景不会塞给开发。

### 如何加入真实业务操作？

使用 `journey record` 录制后审查，或在配置中编写带明确断言的 journey；同时为写操作配置测试数据、清理步骤和允许项。

## 11. Agent/MCP 低 Token 使用方式

默认先读取摘要，不要把完整机器归档直接放入模型上下文：

```text
测试计划：test-plan-summary.json -> requirements.md -> developer-test-cases.md
QA：brief.md -> qa-review.md -> 按需查询单个问题
最终报告：test-execution-summary.json -> test-report.md
```

仅在定位具体用例时读取：

```text
qa-full-test-cases.md
test-execution-details.md
```

默认不要整体读取：

```text
test-plan.json
result.json
network.json
ai-context.json
evidence-report.md
test-execution-report.json
```

推荐命令：

```bash
node dist/cli.js qa ... --sme --json-summary
node dist/cli.js test-plan --input prd.md --output reports/plan
node dist/cli.js test-report --plan reports/plan/test-plan.json --report reports/qa/result.json --output reports/final
```

`test-plan` 和 `test-report` 不带 `--json` 时输出低 Token 摘要；只有明确需要所有用例字段时才使用 `--json`。MCP 同理默认返回 compact response，`detail=true` 和 `includeMarkdown=true` 需要显式开启。

## 12. Library API

```ts
import {
  buildTestPlan,
  buildTestPlanExecutionReport,
  compactTestPlan,
  compactTestPlanExecution,
  runQa
} from 'frontlens';

const plan = await buildTestPlan({ inputPath: 'prd.md', outputDir: 'reports/plan' });
console.log(compactTestPlan(plan));

const qa = await runQa({
  url: 'http://127.0.0.1:4173',
  requirementsPath: 'reports/plan/test-plan.json',
  outputDir: 'reports/qa'
});
const execution = buildTestPlanExecutionReport(plan, qa);
console.log(compactTestPlanExecution(execution, plan));
```

Library API 与 CLI/MCP 使用相同的证据归因规则。`compact*` 仅用于默认展示；完整对象仍应写入文件或只在定位具体需求、用例时读取。
