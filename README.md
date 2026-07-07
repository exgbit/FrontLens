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
- **代码负责取证与收敛**：浏览器自动化、截图、网络记录、异常模拟、Coverage、安全扫描、JSON/Markdown 报告生成，以及 `qa-review.md` 专业复盘摘要。
- **最终报告不是 raw 扫描结果**：LLM 会结合源码、运行阶段、部署环境、产品 ADR 和异常模拟上下文做二次校准。

## 适用场景

- 前端页面 QA / 冒烟 / 复盘
- UI、交互、响应式、可访问性检查
- Network、API、Console、异常场景分析
- 前后端联动问题排查
- Vite dev server 与生产 preview 结果区分
- 安全响应头 / 敏感信息 / Cookie 等被动安全检查
- 性能、资源体积、Coverage、P2 预算检查
- 结合前端源码进行 file:line 级别的问题定位
- 基于 PRD/验收标准 JSON 生成需求覆盖矩阵和 QA Gate
- 自动校验证据截图、DOM、trace、视频和报告路径是否真实存在
- 生成可交给后续修复 Agent 使用的 fix tasks

## 为什么还需要代码

“纯 skills / LLM 驱动”并不等于完全没有代码。

LLM 擅长判断、归因、解释和修复建议，但浏览器证据采集需要稳定、可复现、可机器读取的执行层。例如：

- 截图与 DOM 快照
- Network 请求与响应状态
- Console / Page Error
- JS/CSS Coverage
- 多视口响应式截图
- API 500/404/401/403/timeout 异常模拟
- 安全响应头和敏感信息扫描
- Markdown / JSON 报告产物
- 面向修复排期的 `qa-review.md` 精简专业复盘

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
6. 读取 `qa-review.md` / `report.md` / `result.json`。
7. 结合源码做 file:line 级复核。
8. 对 raw issue 进行误报过滤和根因合并。
9. 输出最终 Markdown 摘要。

### 2. 分析指定模块

```text
用 frontend-qa 分析 http://127.0.0.1:5173/rules，只看 API、异常模拟、可访问性和源码关联
```

如果用户没有明确选择模块，skill 会先询问；如果用户说“全选”，则直接启用默认完整扫描。

### 3. 带验收标准分析

```json
[
  {
    "id": "REQ-SEARCH",
    "title": "搜索可以筛选列表",
    "priority": "P1",
    "interactionKinds": ["search"],
    "selectors": ["css=[data-testid='search-input']"],
    "expectedTexts": ["搜索"],
    "journeySteps": [
      { "action": "fill", "target": "css=[data-testid='search-input']", "value": "test" },
      { "action": "press", "target": "css=[data-testid='search-input']", "value": "Enter" }
    ]
  }
]
```

保存为 `requirements.json` 后，可在手动 CLI 中追加 `--requirements requirements.json`；通过 skill 使用时，把该文件路径告诉 Codex。报告会生成 `requirementCoverage`，并让未覆盖/失败的 P0/P1 验收标准影响 `qualityGate`。
其中 `selectors` / `expectedTexts` / `journeySteps` 会自动生成安全的验收用户旅程并回链到需求；只有自由文本、没有明确断言的需求不会被误判为“业务已通过”。

### 3.1 带产品/ADR 上下文分析

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
- 用户旅程 / 异常模拟 / AI 结论
- skipped 覆盖缺口
- 证据路径
- 复测命令

从 `result.json` 的 `metadata.schemaVersion >= 1.3.0` 开始，报告会额外包含 `qualityGate`；从 `1.4.0` 开始包含 `requirementCoverage`；从 `1.5.0` 开始包含 `artifactIntegrity`；从 `1.6.0` 开始包含 `rootCauseGroups`；从 `1.7.0` 开始包含 `issueDisposition`；从 `1.8.0` 开始包含验收标准生成旅程的来源/需求回链；从 `1.9.0` 开始支持 `productContext` 驱动产品/ADR 降噪；从 `1.10.0` 开始包含 `sourceAnalysis` 源码索引；从 `1.11.0` 开始包含 `sourceRuntimeCorrelation` 源码×运行时绑定；从 `1.12.0` 开始包含 `sourceHealth` 源码健康/语法解析；从 `1.13.0` 开始包含 `qaSignoff` 专业测试签核；从 `1.14.0` 开始 `sourceHealth` 可显式运行受控的 `typecheck/lint` 等源码脚本；从 `1.15.0` 开始包含 `environment` 测试环境可信度评估；从 `1.16.0` 开始包含 `pageProfile` 页面画像/产品范围建议：

- `status`: `pass` / `pass-with-risks` / `fail` / `blocked`
- `confidence`: `high` / `medium` / `low`
- `reasons` / `coverageGaps`: 为什么可以验收、为什么有风险、或为什么阻断

`requirementCoverage` 会区分用户提供的验收标准和从页面推断的能力覆盖；推断项只能说明覆盖缺口，不能代表 100% 业务通过。带 `selectors` / `expectedTexts` / `journeySteps` 的显式需求会生成 `journeyTests[].source = requirement-generated` 和 `requirementIds[]`，用于把运行时证据绑定到 PRD。`productContext` 会让产品/ADR 明确的必选、可选、不在范围内能力参与 raw issue 处置，减少把样式风格、导出、分页、刷新、移动触控等需求取舍误报为代码缺陷。`pageProfile` 会在缺少显式产品上下文时基于页面结构给出 credential/security、admin-list、dashboard、form、detail-master、login、public-content 等画像、建议问题和 productContext 草案；它只是提问与范围校准依据，不会替代 PRD/ADR 自动确认产品决策。`environment` 会识别 Vite dev server、本地 preview、内网/staging、file 和生产等价 HTTPS 环境，并给出 functional/performance/security/businessSignoff 可信度；dev server 下的请求数、源码路径泄露、HMR WebSocket 和传输体积不会当成生产结论。`sourceAnalysis` 会在提供 `--source-root` 或 `source.root` 时扫描路由、静态/动态 import、API 调用、loading/error/empty/retry 线索，并把静态路由导入等源码级问题变成可复核证据。`sourceRuntimeCorrelation` 会把运行时 XHR/Fetch 与源码 API 调用、状态信号、页面组件、列表响应路径建立绑定，未绑定的全局 Network 数据不会直接触发“接口有数据但页面空”缺陷。`sourceHealth` 会识别 package scripts、对 TS/JS/Vue script 做非破坏性语法解析，并在显式启用 `--source-run-scripts` / `source.runScripts=true` 时运行受控脚本（默认 `typecheck,lint`），把脚本失败纳入源码确认问题；语法错误和失败的 typecheck/build/test 会成为发布阻断。`qaSignoff` 会把质量门禁、需求覆盖、登录/角色态、运行时旅程、非破坏授权、测试环境可信度、页面画像/产品范围确认度、证据完整性和 source script checks 汇总成 pass / pass-with-risks / fail / blocked 以及 runtime-verified / runtime-partial / static-source-only / not-verified，避免把 raw score 当成业务验收结论。`artifactIntegrity` 会检查报告引用的本地证据路径是否存在，缺失路径不能作为证据。`rootCauseGroups` 会把多个 raw issue 合并成实现层根因，避免把同一 bug 的 500/404/timeout/a11y 多条证据当作多份工作量。`issueDisposition` 会给每条 raw issue 标注 confirmed、needs-source-confirmation、deployment-only、product-decision、tool-limitation、insufficient-evidence 或 reference，并区分 actionable / conditional / non-actionable。CI、MCP、后续修复 Agent 和 LLM 复盘都应优先读取 `qaSignoff` + `qualityGate` + `requirementCoverage` + `environment` + `pageProfile` + `sourceAnalysis` + `sourceRuntimeCorrelation` + `sourceHealth` + `artifactIntegrity` + `issueDisposition` + `rootCauseGroups`，再结合需求、源码和运行证据做最终验收判断。

## 误报降噪原则

`frontend-qa` skill 内置了针对前端 QA 的二次校准规则，例如：

- Vite dev server 的 `/src/*.vue`、`@vite/client`、HMR WebSocket 不直接算生产安全/性能问题。
- 异常模拟产生的 500/404/401/403 不直接算后端契约问题。
- 浏览器原生 `Failed to load resource` 不直接算应用 console bug。
- 卡片/主从布局不能套表格分页/导出规则。
- URL path 中的 `credentials` 不等于敏感信息泄露。
- CSS 类名如 `.el-input__password` 不等于真实密码泄露。
- 所有 retained 前端问题必须尽量给出源码 file:line 证据。
- 多个 raw issue 如果指向同一实现缺陷，应合并为一个根因修复；新报告会在 `issueDisposition` 中先过滤行动性，再在 `rootCauseGroups` 中机器化输出根因。

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
- `frontlens_matrix`
- `frontlens_inspect`
- `frontlens_issues`
- `frontlens_network`
- `frontlens_coverage`
- `frontlens_security`
- `frontlens_fix_tasks`
- `frontlens_diff`
- `frontlens_suggestions`

## 推荐协作模式

1. 用户用自然语言提出 QA 目标。
2. `frontend-qa` skill 选择模块并派生独立 subagent。
3. 证据采集引擎生成 raw artifacts、完整 `report.md` 和精简 `qa-review.md`。
4. LLM 读取报告、源码和规则文档。
5. LLM 输出经过校准后的真实问题与修复建议。
6. 修复后再次运行 skill，并用 diff 对比前后变化。

## 作者

果比AI guobi.ai
