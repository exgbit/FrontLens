# FrontLens

FrontLens 是一套 **LLM 驱动的前端 QA Skill 方案**。

它的核心目标不是提供一个传统意义上的前端测试 CLI 产品，而是让 Codex / LLM Agent 通过 `frontend-qa` skill 自动完成页面分析、源码复核、误报过滤、根因合并和修复建议输出。

仓库中的 TypeScript / Playwright 代码是 skill 背后的 **确定性证据采集引擎**：用于打开页面、采集 Network/Console/DOM/截图/Coverage/安全扫描等原始证据。最终判断、问题归因、误报降噪、源码关联和修复建议由 LLM 按 skill 规则完成。

## 定位

FrontLens 的推荐使用方式是：

```text
用户 → Codex/LLM → frontend-qa skill → FrontLens 证据采集引擎 → LLM 复盘与结论
```

也就是说：

- **主入口是 Skill**：用户通过自然语言调用 `frontend-qa`。
- **LLM 负责决策**：模块选择、是否部署、是否运行 preview、如何判断误报、如何结合源码分析。
- **代码负责取证与收敛**：浏览器自动化、截图、网络记录、异常模拟、Coverage、安全扫描、JSON/Markdown 报告生成，以及 `report.md` / `qa-review.md` 专业复盘摘要，并生成 `scope-review.md` 把产品/PRD 缺口转成可回答的问题，生成 `claim-guard.md` 防止业务通过/生产就绪等过度承诺。
- **最终报告不是 raw 扫描结果**：LLM 会结合源码、运行阶段、部署环境、产品 ADR 和异常模拟上下文做二次校准。

## 适用场景

- 前端页面 QA / 冒烟 / 复盘
- 录制真实人工业务路径并转换为可回放的 FrontLens journey 配置
- UI、交互、响应式、可访问性检查
- Network、API、Console、异常场景分析
- 前后端联动问题排查
- Vite dev server 与生产 preview 结果区分
- 安全响应头 / 敏感信息 / Cookie 等被动安全检查
- 性能、资源体积、Coverage、P2 预算检查
- 结合前端源码进行 file:line 级别的问题定位
- 基于 PRD/验收标准 JSON 生成需求覆盖矩阵和 QA Gate
- 将 Markdown/自然语言 PRD 草案转换为可复核的 `requirements.json` 初稿
- 按 admin / 普通用户 / 只读 / 匿名等登录态运行角色矩阵，比较权限、按钮、问题差异
- 评估测试数据生命周期：前置数据、setup、cleanup、敏感数据与生产写入风险
- 在授权下载/导出测试时保存文件产物，记录文件名、大小、SHA-256，并校验证据路径
- 自动校验证据截图、DOM、trace、视频和报告路径是否真实存在
- 生成可交给后续修复 Agent 使用的 fix tasks 与修复后回归复测计划
- 生成 `scope-review.md`，把“样式是否要改 / 产品是否设计如此 / 页面是否该有分页导出”等不确定点变成产品范围问题和 `productContext` 草案
- 生成 `claim-guard.md`，明确哪些结论可以说、哪些结论禁止说，例如不能在无 PRD/无断言 journey 时写“业务功能 100% 通过”

## 为什么还需要代码

“纯 skills / LLM 驱动”并不等于完全没有代码。

LLM 擅长判断、归因、解释和修复建议，但浏览器证据采集需要稳定、可复现、可机器读取的执行层。例如：

- 截图与 DOM 快照
- Network 请求与响应状态
- Console / Page Error
- JS/CSS Coverage
- 多视口响应式截图
- API 500/404/401/403/timeout 异常模拟
- 下载/导出文件保存与哈希校验
- 安全响应头和敏感信息扫描
- Markdown / JSON 报告产物（决策型 `report.md` + 原始证据 `evidence-report.md`）
- 面向修复排期的 `report.md` / `qa-review.md` 精简专业复盘、`evidence-report.md` 原始证据附录与 `regression-plan.json` 回归复测清单
- 人工业务流录制生成 `journeys` 配置，再由自动化回放验证核心路径

这些由仓库内的 Playwright/TypeScript 引擎完成。Skill 再读取这些产物，并结合源码进行 LLM 级复盘。

因此 FrontLens 的正确理解是：

> **Skill-first，LLM-driven，code-assisted evidence collection.**

## 目录结构

```text
FrontLens/
├── skills/frontend-qa/              # 推荐用户入口：Codex skill
│   ├── SKILL.md                     # skill 主流程
│   ├── agents/openai.yaml           # skill UI 元数据
│   └── references/                  # 模块选择、源码关联、triage 规则等
├── src/                             # 证据采集引擎，不是用户主入口
├── test/                            # 引擎回归测试
├── examples/                        # 示例页面和插件
├── frontlens.config.example.json    # 引擎配置示例
└── package.json
```

## 安装 Skill

克隆仓库后，将 `frontend-qa` skill 安装到 Codex skills 目录：

```bash
git clone git@github.com:exgbit/FrontLens.git
cd FrontLens
mkdir -p ~/.codex/skills
rsync -a skills/frontend-qa/ ~/.codex/skills/frontend-qa/
```

安装后，在新的 Codex 会话里即可使用：

```text
用 frontend-qa 全选分析 http://127.0.0.1:5173/rules，前端代码 /path/to/frontend
```

或：

```text
用 frontend-qa 分析 https://example.com/admin/users，前端代码 /path/to/repo
```

## 推荐使用方式

### 1. 全选分析页面

```text
用 frontend-qa 全选分析 http://127.0.0.1:5173/credentials，前端代码 /Users/justin/work/sunrise-web
```

Skill 会自动执行：

1. 选择默认全量安全非破坏模块。
2. 新开独立 subagent，避免上下文污染。
3. 检查目标页面是否可达。
4. 必要时启动本地 dev / preview 服务。
5. 构建并调用 FrontLens 证据采集引擎。
6. 读取 `qa-review.md` / `report.md` / `result.json`，仅在需要钻取证据时读取 `evidence-report.md`。
7. 结合源码做 file:line 级复核。
8. 对 raw issue 进行误报过滤和根因合并。
9. 同步读取 `scope-review.md`，把 PRD/产品范围未确认项作为条件项，而不是缺陷。
10. 同步读取 `claim-guard.md`，按允许措辞输出结论，避免“100% 通过”“无条件发布”等过度承诺。
11. 输出最终 Markdown 摘要。

### 2. 分析指定模块

```text
用 frontend-qa 分析 http://127.0.0.1:5173/rules，只看 API、异常模拟、可访问性和源码关联
```

如果用户没有明确选择模块，skill 会先询问；如果用户说“全选”，则直接启用默认完整扫描。

### 3. 带验收标准分析

如果只有 Markdown/自然语言 PRD，先让引擎生成一个**待人工确认**的验收标准初稿：

```bash
node dist/cli.js requirements synthesize \
  --input docs/prd.md \
  --output requirements.json \
  --prefix REQ-USERS
```

它会输出：

- `requirements.json`：可直接传给 `--requirements` 的需求覆盖配置。
- `requirements.md`：逐条列出提取依据、置信度、需要补充的问题。

注意：该命令只做确定性提取，不把自由文本自动当作“业务已通过”。低置信需求、角色权限、数据准确性和新增/编辑/删除/上传/下载等有副作用流程都会标记为 `needsReview`，需要补 selector、期望文案、接口模式、角色状态或授权测试数据后再作为发布阻断项。

如果你已经有结构化验收标准，可直接编写 JSON：

```json
[
  {
    "id": "REQ-SEARCH",
    "title": "搜索可以筛选列表",
    "priority": "P1",
    "interactionKinds": ["search"],
    "selectors": ["css=[data-testid='search-input']"],
    "expectedTexts": ["搜索"],
    "apiPatterns": ["/api/users"],
    "journeySteps": [
      { "action": "fill", "target": "css=[data-testid='search-input']", "value": "test" },
      { "action": "press", "target": "css=[data-testid='search-input']", "value": "Enter" }
    ]
  }
]
```

保存为 `requirements.json` 后，可在手动 CLI 中追加 `--requirements requirements.json`；通过 skill 使用时，把该文件路径告诉 Codex。报告会生成 `requirementCoverage`，并让未覆盖/失败的 P0/P1 验收标准影响 `qualityGate`。
其中 `selectors` / `expectedTexts` / `apiPatterns` / `journeySteps` 会自动生成安全的验收用户旅程并回链到需求；`apiPatterns` 会生成 `expectRequest` API 断言；只有自由文本、没有明确断言的需求不会被误判为“业务已通过”。

### 3.1 录制业务流程 / 用户旅程

专业测试工程师不会只做静态扫描，还会把核心业务路径沉淀成可回放用例。FrontLens 提供 `journey record`：打开一个带录制脚本的 headed 浏览器，人工操作页面后自动生成可传给 `--config` 的 `journeys` 配置。

```bash
node dist/cli.js journey record \
  --url "https://example.com/admin/users" \
  --output "journeys/users-smoke.json" \
  --name "用户列表搜索与详情"
```

录制完成会输出：

- `journeys/users-smoke.json`：可直接传给 `node dist/cli.js qa --config ... --journeys` 的配置片段；
- `journeys/users-smoke.md`：人工复核用的步骤表、危险步骤、脱敏值和回放命令。

回放示例：

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --config "journeys/users-smoke.json" \
  --journeys \
  --output "reports/frontlens/users-journey" \
  --no-trace \
  --json
```

注意：录制出的点击/填写步骤只能证明路径可执行。要达到业务验收级别，需要在 JSON 中补 `expectVisible`、`expectText`、`expectUrl`、`expectRequest`，并为新增/编辑/删除/上传/提交等写操作配置 `testData`、setup/cleanup 和授权环境。FrontLens `1.24.0+` 会在 `qaSignoff.scope` 统计 assertion 步骤，并把没有成功断言的录制旅程自动降级为 `runtime-partial`，避免误写“业务 100% 通过”。密码、token、secret、凭证等敏感输入会自动写成 `<REDACTED>`，回放前必须替换为隔离测试数据。危险按钮默认不会标记 `allowMutating=true`，除非录制时显式加 `--allow-mutating-steps`。

### 3.2 带产品/ADR 上下文分析

如果某些能力是产品设计取舍，例如“PC 为主、移动端降级”“凭证页不允许导出”“当前页面不做分页”，把它们写入配置的 `productContext`：

```json
{
  "productContext": {
    "enabled": true,
    "pageType": "credential",
    "deviceScope": "desktop-first",
    "accessibilityTarget": "basic",
    "requiredFeatures": ["error-state"],
    "optionalFeatures": ["mobile-touch-target"],
    "outOfScopeFeatures": ["export"],
    "decisions": [
      {
        "id": "ADR-0001",
        "title": "PC 为主，移动端自适应降级；凭证页不提供导出",
        "appliesTo": ["mobile-touch-target", "export"]
      }
    ],
    "adrRefs": ["docs/adr/0001-pc-first.md"]
  }
}
```

这样 `issueDisposition` 会把匹配 `optionalFeatures` / `outOfScopeFeatures` 的 raw issue 降级为产品决策或非缺陷观察；匹配 `requiredFeatures` 的问题则不会被当成“样式取舍”误降级。

### 4. 要求先部署再分析

```text
用 frontend-qa 全选分析 http://127.0.0.1:5173/rules，前端代码 /Users/justin/work/sunrise-web，如果需要部署则自动部署
```

Skill 会按规则：

- 检查页面可达性。
- 检查 `package.json`。
- 优先使用已有 `dev` / `build` / `preview` 脚本。
- 启动本地服务后再运行 QA。
- 不修改业务代码。

### 5. 多角色 / 权限矩阵

专业 QA 不应只用一个登录态判断业务是否通过。准备多个角色的 storageState 后，可以运行：

```bash
node dist/cli.js role-matrix \
  --url "https://example.com/admin/users" \
  --role admin=.frontlens/auth/admin.json \
  --role viewer=.frontlens/auth/viewer.json \
  --role guest= \
  --output reports/roles-users
```

也可以用 JSON 文件：

```json
[
  {
    "name": "admin",
    "storageState": ".frontlens/auth/admin.json",
    "expectedAllowedTexts": ["删除用户"]
  },
  {
    "name": "viewer",
    "storageState": ".frontlens/auth/viewer.json",
    "expectedForbiddenTexts": ["删除用户"]
  }
]
```

产物：

- `role-matrix.json`
- `role-matrix.md`
- 每个角色独立的 `result.json` / `qa-review.md` / `report.md`

角色矩阵会比较各角色的可见操作、危险动作、权限/API 问题和 role-specific issue。差异默认是“权限复核证据”，只有匹配明确权限需求或 `expectedForbiddenTexts` / `expectedAllowedTexts` 时才升级为缺陷，避免把合理的角色差异误报为 bug。

### 6. 测试数据生命周期

涉及新增、编辑、删除、上传、导入、提交等业务流时，专业 QA 需要声明测试数据如何准备、如何清理、是否允许写入当前环境。可以在 FrontLens config 中加入：

```json
{
  "testData": {
    "enabled": true,
    "environment": "staging",
    "allowProductionWrites": false,
    "records": [
      {
        "id": "user-seed-001",
        "title": "可删除的测试用户",
        "state": "seeded",
        "requiredFor": ["REQ-DELETE-USER"],
        "expectedTexts": ["测试用户"],
        "cleanupOperationId": "cleanup-user"
      }
    ],
    "setupSteps": [
      {
        "id": "seed-user",
        "title": "创建测试用户",
        "type": "api",
        "method": "POST",
        "endpoint": "/api/users",
        "destructive": true,
        "rollbackOperationId": "cleanup-user"
      }
    ],
    "cleanupSteps": [
      {
        "id": "cleanup-user",
        "title": "删除测试用户",
        "type": "api",
        "method": "DELETE",
        "endpoint": "/api/users/{id}"
      }
    ],
    "notes": ["仅在 staging 运行写操作"]
  }
}
```

报告会生成 `testData` 与 `test-data.json`，并把以下情况纳入 `qaSignoff` 风险/阻断：

- 有写操作需求但没有隔离测试数据；
- generated/seeded 数据缺少 cleanup；
- 生产环境存在写入风险但没有显式授权；
- 测试数据标记为 sensitive。

### 7. 下载 / 导出文件验证

默认不会点击下载或导出按钮。只有用户显式授权，或配置：

```json
{
  "safety": {
    "allowDownload": true
  }
}
```

FrontLens 才会执行下载/导出交互，并把文件保存到报告目录下的 `downloads/`：

- `interactionTests[].observations.downloadPath`
- `downloadSuggestedFilename`
- `downloadSizeBytes`
- `downloadSha256`
- `downloadContent`：文本/CSV/JSON 的解析状态、行列数、表头、文本预览；二进制文件会标记为 `binary/skipped`
- `artifacts.downloadDir`
- `artifacts.downloadedFiles[]`

专业 QA 结论里，导出/下载只有在文件真实存在、大小非 0、哈希已记录、内容摘要可复核、且 `artifactIntegrity` 通过时才算 `runtime-verified`。只有网络请求、没有文件产物时，只能算 `runtime-partial`。

## Skill 输出关注点

最终输出不会简单照搬扫描器 raw issue，而是按以下结构复盘：

- 页面信息
- 部署 / 服务动作
- 原始分数与 raw issue count
- 调整后风险判断
- raw issue count 与真实根因 count 分离
- triage 分桶：
  - 真实前端修复
  - 后端/API 修复
  - 部署/安全配置
  - 产品决策
  - 误报/工具局限
- 源码关联复核表
- 根因合并表
- P1 / P2 / P3 修复建议
- 后端/API 结论
- 安全/部署结论
- 性能/P2 结论
- 用户旅程 / 录制业务流 / 异常模拟 / AI 结论
- skipped 覆盖缺口
- 证据路径
- 专业摘要：proof-ready must-fix、should-fix、非缺陷观察、覆盖缺口、发布风险、下一步动作
- 产品范围确认：`scope-review.md`、待回答问题、`productContext` 草案
- 结论护栏：`claim-guard.md`、允许措辞、禁止措辞、待补输入
- 专业待补输入：`qa-intake.md`、P0-P3 追问、配置提示、哪些结论仍需保持条件化
- 缺陷证明强度：`defect-proof.md`、proven/probable/needs-evidence、缺失证据与下一步补证
- 回归复测计划：完整 rerun 命令、根因/需求/旅程/下载/环境复测项、阻断项与待补输入

从 `result.json` 的 `metadata.schemaVersion >= 1.3.0` 开始，报告会额外包含 `qualityGate`；从 `1.4.0` 开始包含 `requirementCoverage`；从 `1.5.0` 开始包含 `artifactIntegrity`；从 `1.6.0` 开始包含 `rootCauseGroups`；从 `1.7.0` 开始包含 `issueDisposition`；从 `1.8.0` 开始包含验收标准生成旅程的来源/需求回链；从 `1.9.0` 开始支持 `productContext` 驱动产品/ADR 降噪；从 `1.10.0` 开始包含 `sourceAnalysis` 源码索引；从 `1.11.0` 开始包含 `sourceRuntimeCorrelation` 源码×运行时绑定；从 `1.12.0` 开始包含 `sourceHealth` 源码健康/语法解析；从 `1.13.0` 开始包含 `qaSignoff` 专业测试签核；从 `1.14.0` 开始 `sourceHealth` 可显式运行受控的 `typecheck/lint` 等源码脚本；从 `1.15.0` 开始包含 `environment` 测试环境可信度评估；从 `1.16.0` 开始包含 `pageProfile` 页面画像/产品范围建议；从 `1.17.0` 开始包含 `testData` 测试数据生命周期评估；从 `1.18.0` 开始包含下载/导出文件产物路径、大小和哈希；从 `1.19.0` 开始包含 `downloadContent` 内容解析摘要；从 `1.20.0` 开始包含 `regressionPlan` 与 `regression-plan.json` 回归复测计划；从 `1.21.0` 开始包含 `professionalSummary` 与 `professional-summary.json` 专业摘要/缺陷分流层；从 `1.22.0` 开始 P2 visual 使用 PNG 像素级 diff，并输出 `visual/diff.png`、changed/total pixels、尺寸差异和 diff bounding box；从 `1.23.0` 开始 `qaSignoff.scope` 记录 journey assertion 计数，并把只有 click/fill/press、没有 expect 成功断言的录制旅程自动降级为 `runtime-partial`；从 `1.24.0` 开始支持 `expectRequest` journey API 断言；从 `1.25.0` 开始 `rootCauseGroups` / `fixTasks` 只由 `issueDisposition.actionability=actionable` 的 raw findings 生成，产品取舍、部署项、工具局限和证据不足项不再进入修复任务；从 `1.26.0` 开始 `summary.adjustedScore` 提供 actionability-aware 评分，避免 raw score 被非缺陷项拉低；从 `1.27.0` 开始 `report.md` 默认改为决策型专业报告，并新增 `evidence-report.md` 保存完整原始证据附录；从 `1.28.0` 开始包含 `scopeReview` / `scope-review.md` / `scope-review.json`，把 pageProfile、PRD、ADR 和 productContext 缺口转成可回答问题与配置草案；从 `1.29.0` 开始包含 `claimGuard` / `claim-guard.md` / `claim-guard.json`，把业务验收、发布签核、生产性能/安全、API/UI 绑定、下载导出、源码健康等常见结论转成允许/禁止措辞；从 `1.30.0` 开始包含 `qaIntake` / `qa-intake.md` / `qa-intake.json`，把 PRD、产品范围、角色、测试数据、环境、源码健康、证据完整性和回归阻断收敛成专业测试工程师式待补输入清单；从 `1.31.0` 开始包含 `defectProof` / `defect-proof.md` / `defect-proof.json`，按用户影响、运行时证据、源码/owner 修复面、需求/产品范围、复现步骤等维度标记 root cause 是 proven、probable 还是 needs-evidence；从 `1.32.0` 开始 `fixTasks`、`professionalSummary.mustFix/shouldFix`、`qualityGate`、`summary.adjustedScore` 和 CI professional gate 只把 `defectProof=proven|probable` 的 root cause 作为 proof-ready 实现工作，`needs-evidence` 自动转为证据补充/覆盖缺口；从 `1.33.0` 开始，可复现的异常模拟无反馈（500/401/403/404/timeout 后没有错误态/重试）会保留 EX/network/console/page-error 证据并进入前端错误态根因候选，但合成状态码仍不会被当成后端契约缺陷；从 `1.34.0` 开始 `rootCauseGroups[].sourceLocations` 会把源码 file:line 定位带入根因、defectProof、professionalSummary 和 fixTasks，减少“定位不准确”的人工复核成本；从 `1.35.0` 开始 human reports 会在 markdown/html 产物路径确定并完成 artifactIntegrity 复算后重写一次，确保 `report.md` / `report.html` 与最终 `result.json.artifactIntegrity` 一致；从 `1.36.0` 开始 `rootCauseGroups[].sourceLocations` 会吸收 `sourceRuntimeCorrelation.links[]` 中 medium/high 的源码 API/state 绑定，并且已提供 sourceRoot 但仍无法源码绑定的前端根因会保持 `defectProof=needs-evidence`，避免把纯运行时猜测排进 must-fix；从 `1.37.0` 开始 `sourceAnalysis.findings` 会识别源码模板中疑似无可访问名称的图标按钮，并把这些 file:line 汇入对应运行时 a11y 根因，减少“按钮无名称但定位不到组件”的漏判；从 `1.38.0` 开始 `sourceAnalysis.findings[kind=error-state-gap]` 会识别“源码捕获/暴露 error，但模板只显示空态、没有错误/重试态”的视图，并把异常模拟无反馈根因绑定到具体 file:line；从 `1.39.0` 开始该识别从 Vue 扩展到 Svelte 和 JSX/TSX 页面组件；从 `1.40.0` 开始源码模板中的无可访问名称图标按钮识别支持多行 Vue/Svelte/JSX 标签，减少真实组件写法下的 a11y 漏判；从 `1.41.0` 开始启发式 AI 只写入 `aiAnalysis.summary/suggestions` 与 `ai-context.json`，不再生成 `AI-001` raw issue，避免把综合摘要混入缺陷计数和修复队列；从 `1.42.0` 开始在启用 sourceRoot/sourceAnalysis 时，“接口有列表数据但页面表格为空”必须有通过的 sourceRuntimeCorrelation 且达到 medium/high 绑定才生成 raw finding，源码绑定缺失/不可用时直接抑制，避免把未绑定接口猜测成页面缺陷；从 `1.43.0` 开始 refresh/download/pagination 这类产品范围相关的交互 warning 默认只保留在 `interactionTests[]` 覆盖证据中，不再生成 raw issue，只有配置了显式 requirement 或 `productContext.requiredFeatures` 时才升级为 raw finding；从 `1.44.0` 开始移动/平板小触控目标默认也只保留在 `responsiveChecks[]` 覆盖证据中，只有显式移动端/触控/WCAG 需求或 `productContext` 将移动触控纳入范围时才生成 raw issue；从 `1.45.0` 开始人类报告结论区默认先展示 Professional summary、QA sign-off、Adjusted score 和 proof-ready root causes，再展示 raw score，避免把扫描器原始分误当修复排期；从 `1.46.0` 开始可选 SEO 缺失与颜色对比度这类产品/设计范围敏感项需要公开内容/SEO/WCAG/严格 a11y 范围证据才进入修复口径；从 `1.47.0` 开始修复建议会清理与问题类别不匹配的 API/表格/分页模板噪声，避免触控/a11y/SEO/视觉问题出现后端分页等串味建议：

- `status`: `pass` / `pass-with-risks` / `fail` / `blocked`
- `confidence`: `high` / `medium` / `low`
- `reasons` / `coverageGaps`: 为什么可以验收、为什么有风险、或为什么阻断

`requirementCoverage` 会区分用户提供的验收标准和从页面推断的能力覆盖；推断项只能说明覆盖缺口，不能代表 100% 业务通过。带 `selectors` / `expectedTexts` / `apiPatterns` / `journeySteps` 的显式需求会生成 `journeyTests[].source = requirement-generated` 和 `requirementIds[]`，用于把运行时证据绑定到 PRD。`productContext` 会让产品/ADR 明确的必选、可选、不在范围内能力参与 raw issue 处置，减少把样式风格、导出、分页、刷新、移动触控等需求取舍误报为代码缺陷。`testData` 会评估测试数据准备、setup、cleanup、敏感数据和生产写入风险；写操作需求没有隔离数据或清理策略时，`qaSignoff` 会降级或失败。`pageProfile` 会在缺少显式产品上下文时基于页面结构给出 credential/security、admin-list、dashboard、form、detail-master、login、public-content 等画像、建议问题和 productContext 草案；它只是提问与范围校准依据，不会替代 PRD/ADR 自动确认产品决策。`scopeReview` 会进一步把这些画像问题、缺失 PRD、目标设备、无障碍等级、角色态和可选/不在范围能力整理成 `scope-review.md`，并给出可复制到配置里的 `productContext` 草案；未回答前，样式/产品/交互偏好类发现默认保持 conditional 或 non-actionable。`claimGuard` 会把分散在 qaSignoff、environment、scopeReview、sourceRuntimeCorrelation、artifactIntegrity、sourceHealth 中的证据收敛成“允许说/禁止说”的结论护栏；例如无 PRD、无 runtime assertion 或 scope 未配置时，会禁止“业务功能验证通过可信度 100%”这类过度承诺。`environment` 会识别 Vite dev server、本地 preview、内网/staging、file 和生产等价 HTTPS 环境，并给出 functional/performance/security/businessSignoff 可信度；dev server 下的请求数、源码路径泄露、HMR WebSocket 和传输体积不会当成生产结论。`sourceAnalysis` 会在提供 `--source-root` 或 `source.root` 时扫描路由、静态/动态 import、API 调用、loading/error/empty/retry 线索、单行/多行模板中的图标按钮可访问名称风险，以及 Vue/Svelte/JSX 页面里“错误态被空态吞掉”的 error-state-gap 风险，并把静态路由导入等源码级问题变成可复核证据。`sourceRuntimeCorrelation` 会把运行时 XHR/Fetch 与源码 API 调用、状态信号、页面组件、列表响应路径建立绑定，未绑定的全局 Network 数据不会直接触发“接口有数据但页面空”缺陷；1.42+ 在 sourceRoot/sourceAnalysis 已启用时，如果 sourceRuntimeCorrelation 未通过或绑定为 none/low，会直接抑制该类 raw finding；当绑定置信度为 medium/high 时，相关源码位置会汇总进 `rootCauseGroups[].sourceLocations`，作为专业报告的首选 file:line 修复面。`sourceHealth` 会识别 package scripts、对 TS/JS/Vue script 做非破坏性语法解析，并在显式启用 `--source-run-scripts` / `source.runScripts=true` 时运行受控脚本（默认 `typecheck,lint`），把脚本失败纳入源码确认问题；语法错误和失败的 typecheck/build/test 会成为发布阻断。`qaSignoff` 会把质量门禁、需求覆盖、登录/角色态、测试数据生命周期、运行时旅程、journey 成功断言、下载/导出文件产物与内容摘要、非破坏授权、测试环境可信度、页面画像/产品范围确认度、证据完整性和 source script checks 汇总成 pass / pass-with-risks / fail / blocked 以及 runtime-verified / runtime-partial / static-source-only / not-verified，避免把 raw score 当成业务验收结论。`artifactIntegrity` 会检查报告引用的本地证据路径是否存在，包括截图、DOM、视频、trace、JSON sidecar 和下载文件；缺失路径不能作为证据。`aiAnalysis` 是建议/摘要层；1.41+ 的 heuristic provider 不再产生 raw issue，command provider 返回的 issues 也必须经过 claimGuard、defectProof、source/runtime 证据门后才能当缺陷。`rootCauseGroups` 只从可执行 raw finding 生成，并会把多个 raw issue 合并成实现层根因，避免把同一 bug 的 500/404/timeout/a11y 多条证据当作多份工作量。`interactionTests[]` 是覆盖/证据层；1.43+ 中刷新、导出/下载、分页等产品可选能力的 warning 不再自动进入 raw issue，除非 PRD/productContext 明确要求该交互。`responsiveChecks[]` 同样是覆盖/证据层；1.44+ 中小触控目标默认不进入 raw issue，除非移动端/触控/WCAG 范围已明确。`issueDisposition` 会给每条 raw issue 标注 confirmed、needs-source-confirmation、deployment-only、product-decision、tool-limitation、insufficient-evidence 或 reference，并区分 actionable / conditional / non-actionable。`regressionPlan` 会把完整 rerun、proof-ready 根因验证、defect-proof 证据补充、需求缺口、失败 journey、下载/导出、sourceHealth、artifactIntegrity、环境复测和 testData 输入汇成可执行清单，修复后优先按 `regressionPlan.items[]` 而不是 raw issue 数量安排复测。`professionalSummary` 会进一步把 must-fix、should-fix、non-defect observations、coverage gaps、release risks 和 next actions 收敛成默认人类可读结论；`claimGuard` 是撰写这些结论前的安全阀，要求 Agent 使用 allowedWording、避免 forbiddenWording；`qaIntake` 是“不要猜、先问什么”的统一清单，会把 scopeReview、claimGuard、qaSignoff、regressionPlan、environment、sourceHealth、testData 和 artifactIntegrity 缺口合并成 P0-P3 问题，防止把样式/产品取舍或 API/UI 未绑定观察误写成必须修复缺陷；`defectProof` 是“能不能登记为专业缺陷”的证据强度表，needs-evidence 的 root cause 会被排除在 `fixTasks`、must-fix/should-fix、adjustedScore 和 professional CI 阻断之外，必须补 runtime/source/requirement/product/repro/owner 证据或降级为观察项后再排期；当前端 sourceRoot 已启用但根因没有 file:line 或 medium/high runtime-source 绑定时，默认不进入 proof-ready；异常模拟中的无反馈问题会按“用户能否看到失败原因/恢复入口”评估为前端错误态候选；在 1.38+ 中如果源码存在 `error-state-gap` 绑定，会进入 proof-ready 修复面，否则保持 needs-evidence，不会倒推成真实后端 5xx/4xx 契约问题；`report.md` 默认承载这个决策型视图，完整 raw 细节移到 `evidence-report.md`，避免用户把 raw evidence 当作待办列表。1.45+ 的人类报告结论区以 Professional summary、QA sign-off、Adjusted score 和 proof-ready root causes 为先，raw score 只作为扫描趋势参考。1.46+ 中后台/管理页的可选 SEO 缺失默认不生成 raw issue，颜色对比度在未声明 WCAG AA/AAA 或严格 a11y 范围时归入产品/设计确认项。1.47+ 中 a11y/SEO/视觉等问题会自动剔除不匹配的 API/表格/分页修复建议，防止模板串味进入 fixTasks 或人类报告。CI 默认使用 professional gate：`--min-score` 读取 proof-aware 的 `summary.adjustedScore`，`--fail-on` 只统计 actionable 且 defectProof 为 proven/probable 的 finding；只有显式传 `--gate-mode raw` 时才让部署/产品/工具噪音按旧 scanner 口径失败。P2 visual 在配置 `p2.visual.baselineDir` 后会读取 `baseline.png`，保存当前截图 `visual/current.png` 和差异图 `visual/diff.png`，用像素变化比例而不是 PNG 字节差异判断视觉回归；未配置基线时只采集当前截图作为证据。CI、MCP、后续修复 Agent 和 LLM 复盘都应优先读取 `professionalSummary` + `claimGuard` + `qaIntake` + `defectProof` + `qaSignoff` + `qualityGate` + `requirementCoverage` + `testData` + `environment` + `pageProfile` + `scopeReview` + `sourceAnalysis` + `sourceRuntimeCorrelation` + `sourceHealth` + `artifactIntegrity` + `issueDisposition` + `rootCauseGroups` + `regressionPlan`，再结合需求、源码和运行证据做最终验收判断。

## 误报降噪原则

`frontend-qa` skill 内置了针对前端 QA 的二次校准规则，例如：

- Vite dev server 的 `/src/*.vue`、`@vite/client`、HMR WebSocket 不直接算生产安全/性能问题。
- 异常模拟产生的 500/404/401/403 不直接算后端契约问题；但如果页面没有错误态/重试，会保留为前端韧性根因候选。
- 浏览器原生 `Failed to load resource` 不直接算应用 console bug。
- 卡片/主从布局不能套表格分页/导出规则。
- URL path 中的 `credentials` 不等于敏感信息泄露。
- CSS 类名如 `.el-input__password` 不等于真实密码泄露。
- 所有 retained 前端问题必须尽量给出源码 file:line 证据。
- 录制业务流只是回放骨架；没有成功断言、测试数据和角色态时不能宣称业务 100% 通过。
- 多个 raw issue 如果指向同一实现缺陷，应合并为一个根因修复；新报告会在 `issueDisposition` 中先过滤行动性，再在 `rootCauseGroups` 中机器化输出根因，并由 `defectProof` 决定是否进入 proof-ready 修复队列。
- `scopeReview.status=needs-input` 时，不把样式风格、产品设计取舍、分页/导出/刷新/移动触控等推测项列入 must-fix；先回答 scope 问题或把确认后的 `productContext` 写入配置再复测。
- `claimGuard.status!=clear` 时，最终答复必须避开 `forbiddenClaims`，只使用 `allowedWording` 范围内的限定结论。
- `qaIntake.status!=ready` 时，必须先列出 topQuestions；这些是专业测试工程师会向产品/研发/测试环境 owner 追问的输入，未回答前不能把对应范围当作已确认缺陷或已通过结论。
- `defectProof.status!=ready` 或某个 root cause 为 `needs-evidence` 时，不能直接把它当 must-fix / fixTask / CI 阻断缺陷排期；先补齐缺失证据或降级为条件项/观察项。

## 证据采集引擎开发

一般用户不需要直接使用下面命令；这些主要用于维护 FrontLens 引擎或在 skill 内部被调用。

### 环境要求

- Node.js >= 20
- npm
- Playwright Chromium

### 安装依赖

```bash
npm install
```

### 构建与测试

```bash
npm run build
npm run check
npm test
```

### 手动运行引擎

```bash
node dist/cli.js qa \
  --url "https://example.com" \
  --source-root "/path/to/frontend" \
  --source-run-scripts \
  --source-scripts "typecheck,lint" \
  --output "reports/frontlens/example" \
  --no-trace \
  --json
```

如需带验收标准：

```bash
node dist/cli.js qa --url "https://example.com" --requirements "requirements.json"
node dist/cli.js disposition --report "reports/frontlens/example/result.json"
node dist/cli.js root-causes --report "reports/frontlens/example/result.json"
```

### 查看已有结果

```bash
node dist/cli.js inspect --report "reports/frontlens/example/result.json"
node dist/cli.js issues --report "reports/frontlens/example/result.json" --severity high
node dist/cli.js security --report "reports/frontlens/example/result.json"
node dist/cli.js coverage --report "reports/frontlens/example/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/example/result.json"
```

### 对比两次结果

```bash
node dist/cli.js diff \
  --before "reports/frontlens/old/result.json" \
  --after "reports/frontlens/new/result.json" \
  --output "reports/frontlens/diff"
```

### 对比 dev 与 build/preview 环境

当同一路由既有 Vite dev server 又有 build/preview 地址时，用环境对比把 dev 伪影、preview-only 生产构建问题和双环境都存在的高置信问题分开：

```bash
node dist/cli.js env-compare \
  --dev-url "http://127.0.0.1:5173/users" \
  --preview-url "http://127.0.0.1:4173/users" \
  --source-root "/path/to/frontend" \
  --output "reports/frontlens/users-env" \
  --no-trace \
  --json
```

产物：

- `environment-comparison.json`
- `environment-comparison.md`
- `dev/result.json` 与 `preview/result.json`

解释原则：dev 结果用于功能和源码关联；preview/生产等价结果用于 bundle、传输体积、安全头、HMR/WebSocket、源码路径泄露等生产结论；两个环境都存在的问题优先级最高。

## 默认安全策略

FrontLens 引擎默认采用非破坏策略：

- 默认阻断 `POST` / `PUT` / `PATCH` / `DELETE` 等可能产生副作用的请求。
- 默认不执行真实新增、编辑、删除、上传、下载/导出等危险动作。
- 被阻断的写请求会作为潜在副作用证据记录，不直接当作后端失败。
- 只有明确授权的测试环境才建议开启 mutating requests。

## MCP

FrontLens 证据采集引擎也可以作为 MCP server 暴露给其他 Agent：

```bash
node dist/cli.js mcp
```

可用工具包括：

- `frontlens_qa`
- `frontlens_requirements_synthesize`
- `frontlens_matrix`
- `frontlens_role_matrix`
- `frontlens_inspect`
- `frontlens_issues`
- `frontlens_root_causes`
- `frontlens_disposition`
- `frontlens_network`
- `frontlens_coverage`
- `frontlens_security`
- `frontlens_fix_tasks`
- `frontlens_diff`
- `frontlens_env_compare`
- `frontlens_suggestions`

## 推荐协作模式

1. 用户用自然语言提出 QA 目标。
2. `frontend-qa` skill 选择模块并派生独立 subagent。
3. 证据采集引擎生成 raw artifacts、决策型 `report.md`、精简 `qa-review.md` 和完整 `evidence-report.md`。
4. LLM 读取报告、源码和规则文档。
5. LLM 输出经过校准后的真实问题与修复建议。
6. 修复后再次运行 skill，并用 diff 对比前后变化。

## 作者

果比AI guobi.ai
