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
- **代码负责取证与收敛**：浏览器自动化、截图、网络记录、异常模拟、Coverage、安全扫描、JSON/Markdown 报告生成，以及一页式 `brief.md`、`professional-audit.md`、`claim-guard.md`、`defect-proof.md`、`report-content-audit.md`、`journey-assertion-audit.md`、`business-journeys.md`、`qa-plan.md`、`risk-register.md`、`risk-acceptance.md`、`report.md` / `qa-review.md` 专业复盘摘要，并生成 `scope-review.md` / `product-context.md` / `product-context.config.json` / `qa-intake.md` / `qa-intake.config.json` 把产品/PRD 缺口转成可回答的问题和可直接 rerun 的配置草案，生成 `claim-guard.md` 防止业务通过/生产就绪等过度承诺，并用 `defect-proof.md` 防止待补证据项进入修复排期，并用 `defect-tickets.md` 只输出可真正登记到 Jira/Linear 的 proof-ready 缺陷工单，用 `traceability.md` 把 PRD/验收项、测试用例、运行证据、缺陷工单和风险串成可签核链路，并用 `automation-specs.md` / `automation/frontlens.spec.ts` 生成需测试工程师复核后执行的 Playwright 回归草案，最后用 `evidence-bundle.md/json` 把可登记缺陷、失败用例、需求缺口、自动化草案与本地证据文件存在性打成可交付证据包，用 `test-strategy.md/json` 明确哪些模块该测、需补输入、可出范围或被阻断，并用 `business-journeys.md/json` 把 PRD、journey、断言草案、角色和测试数据缺口整理成可复跑业务场景。
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
- 生成可交给后续修复 Agent 使用的 fix tasks、专业 QA 执行计划 `qa-plan.md/json`、覆盖矩阵 `qa-coverage.md/json`、发布风险登记 `risk-register.md/json`、风险接受/必须整改清单 `risk-acceptance.md/json`、缺陷工单队列 `defect-tickets.md/json`、需求追踪矩阵 `traceability.md/json`、自动化回归草案 `automation-specs.md/json` + `automation/frontlens.spec.ts`、证据交付包 `evidence-bundle.md/json`、测试策略规划 `test-strategy.md/json`、业务场景计划 `business-journeys.md/json`、复核校准 `review-calibration.md/json`、`review-calibration.config.json` 与修复后回归复测计划
- 生成 `scope-review.md` / `product-context.md` / `product-context.config.json` / `qa-intake.config.json`，把“样式是否要改 / 产品是否设计如此 / 页面是否该有分页导出”等不确定点变成产品范围问题和可直接传给 `--config` 的 `productContext` 配置草案；`qa-intake.config.json` 还内置需人工确认的 `draftAssertionSteps[]`，用于把 weak/path-only journey 升级后复跑
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
- Markdown / JSON 报告产物（一页式 `brief.md` + 报告契约与处置质量自检 `professional-audit.md/json` + 结论护栏 `claim-guard.md/json` + 缺陷证明 `defect-proof.md/json` + 缺陷工单 `defect-tickets.md/json` + 需求追踪 `traceability.md/json` + 自动化草案 `automation-specs.md/json` / `automation/frontlens.spec.ts` + 证据交付包 `evidence-bundle.md/json` + 测试策略规划 `test-strategy.md/json` + 业务场景计划 `business-journeys.md/json` + 复核校准 `review-calibration.md/json` / `review-calibration.config.json` + 生成报告内容自检 `report-content-audit.md/json` + journey 断言质量自检 `journey-assertion-audit.md/json` + 专业 QA 执行计划 `qa-plan.md/json` + 覆盖矩阵 `qa-coverage.md/json` + 发布风险登记 `risk-register.md/json` + 风险接受/必须整改清单 `risk-acceptance.md/json` + 产品范围配置草案 `product-context.md/json` + 待补输入 `qa-intake.md/json` + 可 rerun 的 `product-context.config.json` / `qa-intake.config.json` + 决策型 `report.md` + 原始证据 `evidence-report.md`）
- 面向修复排期的 `brief.md` / `professional-audit.md` / `claim-guard.md` / `defect-proof.md` / `defect-tickets.md` / `traceability.md` / `automation-specs.md` / `evidence-bundle.md` / `test-strategy.md` / `business-journeys.md` / `review-calibration.md` / `review-calibration.config.json` / `report-content-audit.md` / `journey-assertion-audit.md` / `qa-plan.md` / `qa-coverage.md` / `risk-register.md` / `risk-acceptance.md` / `product-context.md` / `product-context.config.json` / `qa-intake.md` / `qa-intake.config.json` / 可配置详略的 `report.md` / `qa-review.md` 精简专业复盘、`evidence-report.md` 原始证据附录与 `regression-plan.json` 回归复测清单
- 人工业务流录制生成 `journeys` 配置，再由自动化回放验证核心路径

这些由仓库内的 Playwright/TypeScript 引擎完成。Skill 再读取这些产物，并结合源码进行 LLM 级复盘。

因此 FrontLens 的正确理解是：

> **Skill-first，LLM-driven，code-assisted evidence collection.**

## 最新更新（1.86.0）

本版本重点解决“分析过于细致、风格/产品取舍被误当缺陷、复核反馈下轮仍重复出现”的问题：

- `review-calibration.config.json` 不再只是报告说明，会直接进入 `issueDisposition`、`summary.adjustedScore`、`fixTasks` 和 professional summary。
- 已经被测试工程师 / 产品 / 开发确认的样式设计、PC-first 触控取舍、dev server / HMR 噪音、未满足四段证据的 API/UI data mismatch，会自动归入产品决策、工具局限或待补证据，不再污染 must-fix 队列。
- `summary.adjustedScore` 与 `fixTasks` 现在更接近专业测试工程师的修复排期口径：只让 proof-ready、当前页面范围内、可复现且有 owner/fix surface 的问题进入实现队列。
- 校准配置可在同类页面复用，但不会盲目压制新页面真实缺陷；如果当前页面显式声明了 `requiredFeatures`、mobile-first / responsive / WCAG 或明确验收标准，当前页面需求优先于旧校准。
- 后续 Agent 读取 `reviewCalibration.calibrationSource=config` 时，可以知道人工复核结论已经被机器分诊层应用，不需要反复追问同样的“样式是否设计如此 / dev server 是否算问题 / API 有数据但页面空是否误报”等问题。

推荐流程：

```text
首次扫描 → 人工/产品/开发复核 → frontlens review-calibration → 生成 review-calibration.config.json → rerun → 输出校准后的专业 QA 结论
```

## 默认测试策略：SME 标准 QA + 按需专项

`frontend-qa` 现在默认按中小企业标准测试工程师的工作方式运行：先给出模块选择，默认勾选 **SME standard QA**，而不是把所有深度模块都跑一遍。

默认主报告只保留 7 类决策信息：

1. 核心回归清单
2. 上线前风险清单
3. 历史 bug 回归清单
4. 权限矩阵
5. 缺陷优先级判断
6. 哪些问题不修的说明
7. 上线是否可接受的结论

`全选 / all / default` 的含义也调整为 **SME 标准 QA 全选**，不是旧版全模块 forensic 扫描。旧版“全量证据/深度取证”能力保留在专项 skill 中，需要用户明确说 `full / forensic / 深度 / 全量证据` 才触发。

为了降低 token 与不必要测试，以下能力已拆成按需专项 skills：

| Skill | 触发场景 |
|---|---|
| `frontend-qa` | 默认低 token SME 标准 QA |
| `frontend-qa-performance` | 性能、慢、bundle、Coverage、P2、生产 preview 性能 |
| `frontend-qa-security` | 安全、CSP、HTTPS、Cookie、敏感信息、部署安全 checklist |
| `frontend-qa-visual` | 视觉回归、设计稿、baseline、像素 diff |
| `frontend-qa-mobile` | 移动端、平板、响应式、触控目标、H5 |
| `frontend-qa-automation` | journey 录制/回放、Playwright 自动化、回归脚本 |
| `frontend-qa-forensics` | 旧版全量逻辑、深度取证、事故复盘、raw network/evidence drill-down |

默认 `frontend-qa` 通过 CLI 的 `--sme --json-summary` 运行：关闭默认安全深扫、Coverage、Realtime、P2/弱网/视觉等专项模块，只保留页面可达、核心 API、异常反馈、源码关联、基础权限与基础 a11y。它也禁止直接读取大型原始产物，例如 `result.json`、`network.json`、`page-model.json`、`evidence-report.md` 和大型 `report.md`；优先使用 `--json-summary` stdout、`brief.md` / `qa-review.md` / compact helper 输出，需要专项取证时再调用 `frontend-qa-forensics`。

## 目录结构

```text
FrontLens/
├── skills/frontend-qa/              # 默认入口：SME 标准 QA
├── skills/frontend-qa-*/            # 按需专项：performance/security/visual/mobile/automation/forensics
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

克隆仓库后，将默认 `frontend-qa` 和按需专项 `frontend-qa-*` skills 安装到 Codex skills 目录：

```bash
git clone git@github.com:exgbit/FrontLens.git
cd FrontLens
mkdir -p ~/.codex/skills
for skill in skills/frontend-qa*; do
  rsync -a "$skill/" "$HOME/.codex/skills/$(basename "$skill")/"
done
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

1. 给出模块多选，默认勾选 SME 标准 QA；`全选` 只代表 SME 标准全选。
2. 新开独立 subagent，避免上下文污染。
3. 检查目标页面是否可达。
4. 必要时启动本地 dev / preview 服务。
5. 构建并调用 FrontLens 证据采集引擎。
6. 默认使用 `--sme --json-summary` 的低 token 输出；必要时再读取 `brief.md` / `qa-review.md` / compact helper 输出；禁止直接打开大型 `result.json`、`network.json`、`page-model.json`、`evidence-report.md` 或大型 `report.md`。
7. 结合源码做 file:line 级复核。
8. 对 raw issue 进行误报过滤和根因合并。
9. 把 PRD/产品范围未确认项作为条件项，而不是缺陷。
10. 输出固定 7 类 SME 决策摘要。

### 2. 分析指定模块

```text
用 frontend-qa 分析 http://127.0.0.1:5173/rules，只看 API、异常模拟、可访问性和源码关联
```

如果用户没有明确选择模块，skill 会先询问；如果用户说“全选”，则启用 SME 标准 QA。若要旧版全量深度取证，请明确使用 `frontend-qa-forensics` 或说明 `full / forensic / 深度 / 全量证据`。

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
  --sme \
  --json-summary
```

注意：录制出的点击/填写步骤只能证明路径可执行。要达到业务验收级别，需要在 JSON 中补 `expectVisible`、`expectText`、`expectUrl`、`expectRequest`，并为新增/编辑/删除/上传/提交等写操作配置 `testData`、setup/cleanup 和授权环境。FrontLens `1.24.0+` 会在 `qaSignoff.scope` 统计 assertion 步骤，并把没有成功断言的录制旅程自动降级为 `runtime-partial`，避免误写“业务 100% 通过”。密码、token、secret、凭证等敏感输入会自动写成 `<REDACTED>`，回放前必须替换为隔离测试数据。危险按钮默认不会标记 `allowMutating=true`，除非录制时显式加 `--allow-mutating-steps`。

### 3.2 带产品/ADR 上下文分析

如果某些能力是产品设计取舍，例如“PC 为主、移动端降级”“凭证页不允许导出”“当前页面不做分页”，优先读取 `product-context.md` 或运行 `frontlens product-context --report <result.json>` 获取草案；schema 1.53+ 的正常 QA 运行会同时写出 `product-context.config.json`，产品/QA 确认后可直接把这个文件传给 `--config` 重跑，也可以把它们写入配置的 `productContext`：

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

确认 `product-context.config.json` 后可直接重跑：

```bash
node dist/cli.js qa \
  --url "http://127.0.0.1:5173/credentials" \
  --config "reports/frontlens/credentials/product-context.config.json" \
  --output "reports/frontlens/credentials-confirmed" \
  --sme \
  --json-summary
```

这样 `issueDisposition` 会把匹配 `optionalFeatures` / `outOfScopeFeatures` 的 raw issue 降级为产品决策或非缺陷观察；匹配 `requiredFeatures` 的问题则不会被当成“样式取舍”误降级。

### 3.3 把人工复核反馈沉淀为复用配置

当测试工程师或产品反馈“样式是设计如此”“PC 为主，移动端触控可选”“接口有数据但页面空是误报，需要四段证据”“dev server 指标不进看板”时，不要只把这些结论留在聊天上下文里。使用 `review-calibration` 把反馈转成下一轮可复用配置：

```bash
node dist/cli.js review-calibration \
  --report "reports/frontlens/credentials/result.json" \
  --feedback-file "feedback.md" \
  --json
```

正常 QA 运行也会写出 `review-calibration.md/json` 与 `review-calibration.config.json`。未提供反馈且没有应用过校准配置时状态为 `needs-feedback`，用于提醒 Agent 先询问产品/QA；提供反馈后会输出结构化 signals、每条 issue 的 keep / downgrade / out-of-scope / needs-evidence / ask-product 动作，以及可直接 `--config` 的 `productContext` / `requirements` / `source` 补丁。复跑时如果传入这个 config，schema 1.85+ 会显示 `reviewCalibration.calibrationSource=config`，schema 1.86+ 还会把这些已确认校准直接应用到 `issueDisposition`、`summary.adjustedScore`、`fixTasks` 和专业摘要，后续 Agent 不会重复追问同样的样式/PC-first/dev-server/API-UI 误报，也不会把它们重新排进 must-fix。

```bash
node dist/cli.js qa \
  --url "http://127.0.0.1:5173/credentials" \
  --config "reports/frontlens/credentials/review-calibration.config.json" \
  --source-root "/path/to/frontend" \
  --output "reports/frontlens/credentials-calibrated" \
  --sme \
  --json-summary
```

这个配置是页级/同类页面复用的校准合同：它不会证明缺陷已修复，也不会自动否定真实问题；它只让后续分析在同样产品范围下少猜、少报样式取舍、少把未满足证据门槛的数据不一致当成实现 bug。若新页面显式声明了移动端、导出、分页、刷新、WCAG 或其他必需能力，schema 1.86+ 会让当前页的明确需求优先于旧校准，避免跨页面误压制真实缺陷。

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

从 1.62 起，普通 QA 运行如果识别到凭证/权限敏感页面、危险操作按钮、权限检查告警或显式角色/权限需求，会在 `qa-plan.md` / `regression-plan.json` 中自动生成 `role-matrix` 待补项；没有多角色 storageState 前，权限结论保持 needs-input，而不是用单角色扫描结果直接签核。

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
- 专业摘要与执行计划：proof-ready must-fix、should-fix、非缺陷观察、覆盖缺口、发布风险、`qa-plan.md/json` 下一步工作清单、`qa-coverage.md/json` 覆盖矩阵、`assertion-suggestions.md/json` 断言补强建议、`business-journeys.md/json` 业务场景计划、`review-calibration.md/json` 复核校准、`test-cases.md/json` 正式测试用例执行矩阵、`risk-register.md/json` 发布风险矩阵、`risk-acceptance.md/json` 风险接受/必须整改清单
- 缺陷工单队列：`defect-tickets.md/json`、只包含 proven/probable root cause、含 expected/actual/reproduce/source/evidence/acceptance/verification，避免把 raw issue 直接当 bug 提交
- 需求追踪矩阵：`traceability.md/json`、把 requirement → testCase/journey/interaction → defectTicket/risk 串起来；高优先级缺口或 orphan defect 会阻止“业务已验证”式结论
- 自动化草案：`automation-specs.md/json` 和 `automation/frontlens.spec.ts`，从 requirements / journeys / assertionSuggestions / testCases 生成需人工复核的 Playwright 回归起点；未实际执行前不算通过证据
- 证据交付包：`evidence-bundle.md/json`，把 proof-ready 缺陷、失败/阻断测试用例、高优先级需求追踪缺口、自动化草案与 artifactIntegrity 的本地文件存在性合并，missing-artifact 项不能作为可引用证据
- 测试策略规划：`test-strategy.md/json`，把 runtime、requirements、journeys、API、source、a11y、responsive、performance、security、role、test-data、env-compare、automation、evidence-handoff 等模块标为 run / run-if-input / out-of-scope / blocked / already-covered，减少过度细节和无依据发散
- 业务场景计划：`business-journeys.md/json`，把 provided requirements、recorded journeys、assertion suggestions、role needs、testData gaps 合并成可复跑场景；ready 也只代表可复跑，不能当作已通过证据
- 复核校准：`review-calibration.md/json` 与 `review-calibration.config.json`，把人工复核/产品设计/PC-first/dev-server 噪音/API-UI 证据门槛等反馈沉淀为可复用配置，schema 1.86+ 会先把校准应用到 issueDisposition/adjustedScore/fixTasks 再判断 must-fix，同时保留当前页显式需求优先，避免过度细节、发散假设和跨页面误压制
- 产品范围确认：`scope-review.md`、`product-context.md/json`、`product-context.config.json`、待回答问题、`productContext` 草案
- 结论护栏：`claim-guard.md`、允许措辞、禁止措辞、待补输入
- 专业待补输入：`qa-intake.md`、`qa-intake.config.json`、P0-P3 追问、配置提示、哪些结论仍需保持条件化
- 缺陷证明强度：`defect-proof.md`、proven/probable/needs-evidence、缺失证据与下一步补证
- 证据完整性：`artifactIntegrity`、缺失/不可移植截图/视频/下载/DOM/trace 路径，防止报告引用不存在的证据
- 修复建议口径：默认只输出 proof-ready/actionable 建议；raw 建议仅用于审计被抑制的产品/样式/部署/工具/待补证据项
- 回归复测计划：完整 rerun 命令、根因/需求/旅程/下载/环境复测项、阻断项与待补输入
- 报告内容自检：`report-content-audit.md/json`、禁止措辞、报告详略 profile、raw score caveat、覆盖缺口是否被隐藏
- 业务流断言自检：`journey-assertion-audit.md/json`、runtime-verified / weakly-asserted / path-only 分类、无断言或弱断言 journey 的补证建议
- 断言补强建议：`assertion-suggestions.md/json`、把 path-only / weak journey 转成可复制的 expectVisible / expectText / expectUrl / expectRequest 草案；`business-journeys.md/json` 将这些草案和 PRD/角色/测试数据缺口整理成业务场景计划
- 测试用例矩阵：`test-cases.md/json`、passed / failed / partial / blocked / skipped / needs-input、runtime/static/hybrid/manual-required、expected/actual/evidence/next-step

从 `result.json` 的 `metadata.schemaVersion >= 1.3.0` 开始，报告会额外包含 `qualityGate`；从 `1.4.0` 开始包含 `requirementCoverage`；从 `1.5.0` 开始包含 `artifactIntegrity`；从 `1.6.0` 开始包含 `rootCauseGroups`；从 `1.7.0` 开始包含 `issueDisposition`；从 `1.8.0` 开始包含验收标准生成旅程的来源/需求回链；从 `1.9.0` 开始支持 `productContext` 驱动产品/ADR 降噪；从 `1.10.0` 开始包含 `sourceAnalysis` 源码索引；从 `1.11.0` 开始包含 `sourceRuntimeCorrelation` 源码×运行时绑定；从 `1.12.0` 开始包含 `sourceHealth` 源码健康/语法解析；从 `1.13.0` 开始包含 `qaSignoff` 专业测试签核；从 `1.14.0` 开始 `sourceHealth` 可显式运行受控的 `typecheck/lint` 等源码脚本；从 `1.15.0` 开始包含 `environment` 测试环境可信度评估；从 `1.16.0` 开始包含 `pageProfile` 页面画像/产品范围建议；从 `1.17.0` 开始包含 `testData` 测试数据生命周期评估；从 `1.18.0` 开始包含下载/导出文件产物路径、大小和哈希；从 `1.19.0` 开始包含 `downloadContent` 内容解析摘要；从 `1.20.0` 开始包含 `regressionPlan` 与 `regression-plan.json` 回归复测计划；从 `1.21.0` 开始包含 `professionalSummary` 与 `professional-summary.json` 专业摘要/缺陷分流层；从 `1.22.0` 开始 P2 visual 使用 PNG 像素级 diff，并输出 `visual/diff.png`、changed/total pixels、尺寸差异和 diff bounding box；从 `1.23.0` 开始 `qaSignoff.scope` 记录 journey assertion 计数，并把只有 click/fill/press、没有 expect 成功断言的录制旅程自动降级为 `runtime-partial`；从 `1.24.0` 开始支持 `expectRequest` journey API 断言；从 `1.25.0` 开始 `rootCauseGroups` / `fixTasks` 只由 `issueDisposition.actionability=actionable` 的 raw findings 生成，产品取舍、部署项、工具局限和证据不足项不再进入修复任务；从 `1.26.0` 开始 `summary.adjustedScore` 提供 actionability-aware 评分，避免 raw score 被非缺陷项拉低；从 `1.27.0` 开始 `report.md` 默认改为决策型专业报告，并新增 `evidence-report.md` 保存完整原始证据附录；从 `1.28.0` 开始包含 `scopeReview` / `scope-review.md` / `scope-review.json`，把 pageProfile、PRD、ADR 和 productContext 缺口转成可回答问题与配置草案；从 `1.29.0` 开始包含 `claimGuard` / `claim-guard.md` / `claim-guard.json`，把业务验收、发布签核、生产性能/安全、API/UI 绑定、下载导出、源码健康等常见结论转成允许/禁止措辞；从 `1.30.0` 开始包含 `qaIntake` / `qa-intake.md` / `qa-intake.json`，把 PRD、产品范围、角色、测试数据、环境、源码健康、证据完整性和回归阻断收敛成专业测试工程师式待补输入清单；从 `1.31.0` 开始包含 `defectProof` / `defect-proof.md` / `defect-proof.json`，按用户影响、运行时证据、源码/owner 修复面、需求/产品范围、复现步骤等维度标记 root cause 是 proven、probable 还是 needs-evidence；从 `1.32.0` 开始 `fixTasks`、`professionalSummary.mustFix/shouldFix`、`qualityGate`、`summary.adjustedScore` 和 CI professional gate 只把 `defectProof=proven|probable` 的 root cause 作为 proof-ready 实现工作，`needs-evidence` 自动转为证据补充/覆盖缺口；从 `1.33.0` 开始，可复现的异常模拟无反馈（500/401/403/404/timeout 后没有错误态/重试）会保留 EX/network/console/page-error 证据并进入前端错误态根因候选，但合成状态码仍不会被当成后端契约缺陷；从 `1.34.0` 开始 `rootCauseGroups[].sourceLocations` 会把源码 file:line 定位带入根因、defectProof、professionalSummary 和 fixTasks，减少“定位不准确”的人工复核成本；从 `1.35.0` 开始 human reports 会在 markdown/html 产物路径确定并完成 artifactIntegrity 复算后重写一次，确保 `report.md` / `report.html` 与最终 `result.json.artifactIntegrity` 一致；从 `1.36.0` 开始 `rootCauseGroups[].sourceLocations` 会吸收 `sourceRuntimeCorrelation.links[]` 中 medium/high 的源码 API/state 绑定，并且已提供 sourceRoot 但仍无法源码绑定的前端根因会保持 `defectProof=needs-evidence`，避免把纯运行时猜测排进 must-fix；从 `1.37.0` 开始 `sourceAnalysis.findings` 会识别源码模板中疑似无可访问名称的图标按钮，并把这些 file:line 汇入对应运行时 a11y 根因，减少“按钮无名称但定位不到组件”的漏判；从 `1.38.0` 开始 `sourceAnalysis.findings[kind=error-state-gap]` 会识别“源码捕获/暴露 error，但模板只显示空态、没有错误/重试态”的视图，并把异常模拟无反馈根因绑定到具体 file:line；从 `1.39.0` 开始该识别从 Vue 扩展到 Svelte 和 JSX/TSX 页面组件；从 `1.40.0` 开始源码模板中的无可访问名称图标按钮识别支持多行 Vue/Svelte/JSX 标签，减少真实组件写法下的 a11y 漏判；从 `1.41.0` 开始启发式 AI 只写入 `aiAnalysis.summary/suggestions` 与 `ai-context.json`，不再生成 `AI-001` raw issue，避免把综合摘要混入缺陷计数和修复队列；从 `1.42.0` 开始在启用 sourceRoot/sourceAnalysis 时，“接口有列表数据但页面表格为空”必须有通过的 sourceRuntimeCorrelation 且达到 medium/high 绑定才生成 raw finding，源码绑定缺失/不可用时直接抑制，避免把未绑定接口猜测成页面缺陷；从 `1.43.0` 开始 refresh/download/pagination 这类产品范围相关的交互 warning 默认只保留在 `interactionTests[]` 覆盖证据中，不再生成 raw issue，只有配置了显式 requirement 或 `productContext.requiredFeatures` 时才升级为 raw finding；从 `1.44.0` 开始移动/平板小触控目标默认也只保留在 `responsiveChecks[]` 覆盖证据中，只有显式移动端/触控/WCAG 需求或 `productContext` 将移动触控纳入范围时才生成 raw issue；从 `1.45.0` 开始人类报告结论区默认先展示 Professional summary、QA sign-off、Adjusted score 和 proof-ready root causes，再展示 raw score，避免把扫描器原始分误当修复排期；从 `1.46.0` 开始可选 SEO 缺失与颜色对比度这类产品/设计范围敏感项需要公开内容/SEO/WCAG/严格 a11y 范围证据才进入修复口径；从 `1.47.0` 开始修复建议会清理与问题类别不匹配的 API/表格/分页模板噪声，避免触控/a11y/SEO/视觉问题出现后端分页等串味建议；从 `1.48.0` 开始 sourceAnalysis 确认的路由静态导入/重型依赖源码问题会作为源码级 should-fix 保留，而 Vite dev 资源请求/传输噪声仍保持非缺陷；从 `1.49.0` 开始 Markdown 报告中的本地截图、DOM、下载、视觉 diff、视频等证据路径会直接标注 missing/unchecked，避免读者按不存在的截图或视频复核；从 `1.50.0` 开始 `qa-review.md` 会列出少量降级/不修/待补证据的 raw finding 样例与理由，帮助人工和后续 Agent 不把产品取舍、工具噪声、部署项重新排进修复队列；从 `1.51.0` 开始每次报告默认写出 `professional-audit.md` / `professional-audit.json`，把过度承诺、非 proof-ready 修复队列、弱证据 actionable、API/UI 猜测误升级、产品/样式项无 scope 误升级、源码证据不足、scope/claim/signoff 不一致和 artifactIntegrity 问题作为报告契约自检；从 `1.52.0` 开始每次报告默认写出 `product-context.md` / `product-context.json`，把 pageProfile/scopeReview 的产品范围建议转成可复核、可复制、可 rerun 的配置草案；从 `1.53.0` 开始同时写出 `product-context.config.json`，产品/QA 审核后可直接作为 `--config` 输入重跑；从 `1.54.0` 开始写出 `qa-plan.md/json`，把 PRD、journey、产品范围、环境、测试数据、缺陷补证和 rerun 命令收敛成专业测试工程师工作清单；从 `1.55.0` 开始写出 `qa-coverage.md/json`，明确每个 QA 维度 covered/partial/skipped/needs-input/failed；从 `1.56.0` 开始 `professional-audit.md/json` 会把 qaCoverage 缺口纳入报告契约自检，在覆盖不足但结论写成通过/验收时给出 blocker；从 `1.57.0` 开始支持 `report.profile=executive|professional|full` / `--report-profile` 控制主报告详略，防止默认报告过细同时保留 evidence appendix；从 `1.58.0` 开始写出 `report-content-audit.md/json` 和 `result.json.reportContentAudit`，检查生成报告是否包含 claimGuard 禁止措辞、profile 过深、raw score 缺 caveat、覆盖缺口隐藏或证据缺失未提示；从 `1.59.0` 开始写出 `journey-assertion-audit.md/json` 和 `result.json.journeyAssertionAudit`，把通过的用户旅程区分为 `runtime-verified`、`weakly-asserted`、`path-only`，无意义断言或没有 expect 的 click/fill 回放不能支撑业务通过结论；从 `1.60.0` 开始 `professional-audit.md/json` 会检查 issueDisposition 处置质量，弱证据高危 actionable、API/UI mismatch 猜测、状态/actionability 自相矛盾、未确认 productContext 的样式/触控/导出/分页等问题被误升为 actionable 时直接阻断；从 `1.61.0` 开始 `report-content-audit.md/json` 会对 executive/professional report 的长度、H2 数量、表格行数和正文行数做 compactness 检查，并收紧默认 professional 报告表格行数，避免主报告重新退化成扫描器明细；从 `1.62.0` 开始，凭证/权限敏感页面、危险操作按钮、权限检查告警或显式权限需求会自动在 `regressionPlan` / `qaPlan` 中生成 `role-matrix` 补测项，要求多角色 storageState 与 expected allowed/forbidden 文本后再做权限签核；从 `1.63.0` 开始，若 `sourceHealth` 发现项目已有 build/typecheck/test/e2e/lint 脚本但本轮未执行，`regressionPlan` / `qaPlan` 会生成 source-health 待补项，避免只凭页面扫描签核；从 `1.64.0` 开始包含 `riskRegister` / `risk-register.md` / `risk-register.json`，把 proof-ready 缺陷、覆盖缺口、环境/source/test-data/artifact 问题和签核阻断汇总为发布风险矩阵；从 `1.65.0` 开始包含 `riskAcceptance` / `risk-acceptance.md` / `risk-acceptance.json`，把发布风险拆成必须先整改的 must-mitigate 项和需要产品/QA/Release 显式接受的 needs-acceptance 项；从 `1.66.0` 开始包含 `testCases` / `test-cases.md` / `test-cases.json`，把需求、journey、交互、异常、a11y、响应式、性能、安全、源码健康、测试数据、证据完整性和覆盖缺口转成专业测试用例执行矩阵；从 `1.67.0` 开始包含 `assertionSuggestions` / `assertion-suggestions.md` / `assertion-suggestions.json`，为 path-only / weak journey 生成具体 expect* 补强步骤；从 `1.68.0` 开始 `report.profile` 默认值从 `professional` 调整为 `executive`，`report.md` 默认成为最短决策摘要，专业详报需显式 `--report-profile professional`；从 `1.69.0` 开始 API/UI data-mismatch 必须同时具备明确需求、具体列表响应、可见空 UI 区域和源码 API/state/render 绑定四层证据才可进入 actionable/fix 队列，否则保留为 QA 证据缺口；从 `1.70.0` 开始空状态、分页参数等产品/范围敏感的弱证据观察默认归属 QA/test 证据缺口，不再显示为 frontend owner 的实现修复；从 `1.71.0` 开始 journey 断言审计会把 `expectText body OK` 等泛化成功文本判为弱断言，需求绑定 journey 仅有这类断言时会阻断业务通过结论；从 `1.72.0` 开始缺少 PRD/验收标准或 productContext/page scope 未确认时，Professional summary 默认使用 QA intake needed 结论，并把相关 coverage gap 提升为 P1 待输入项，而不是把扫描观察包装成业务缺陷列表；从 `1.73.0` 开始默认 brief/executive 报告进一步压缩签核、风险、覆盖和 artifact 索引，并收紧 reportContentAudit 的 compactness 阈值，防止主报告重新退化成扫描器明细；从 `1.74.0` 开始写出 `qa-intake.config.json`，把待确认 PRD/productContext/journey/testData/safety/source 输入收敛成可编辑、可复跑的配置包；从 `1.75.0` 开始，API/UI data-mismatch raw issue 必须同时具备显式 provided requirement 和 medium/high sourceRuntimeCorrelation，CLI/MCP `suggestions` 默认只返回 proof-ready/actionable 建议，并新增一等 helper：`qa-intake`、`risk-register`、`risk-acceptance`、`artifact-integrity`；从 `1.76.0` 开始新增一等 helper：`claim-guard`、`defect-proof`、`report-content-audit`、`journey-assertion-audit`，让后续 Agent 不必解析整份 Markdown 就能读取结论护栏、缺陷证明、报告内容自检和旅程断言自检；从 `1.77.0` 开始 `qa-intake.config.json` 的 `_frontlensQaIntake` 会内嵌 review-only `draftAssertionSteps[]`，可复制到 requirements/journeys 后复跑，但在复跑前不会作为通过证据。`testCases.summary` 会给出 total/passed/failed/blocked/needs-input/runtimeVerified/manualRequired/highPriorityOpen 等统计；从 `1.78.0` 开始写出 `defect-tickets.md/json` 与 `result.json.defectTickets`，只为 `defectProof=proven|probable` 的 root cause 生成可登记的缺陷工单，needs-evidence/product/deployment/tool 观察不会进工单队列；从 `1.79.0` 开始写出 `traceability.md/json` 与 `result.json.traceability`，把需求、测试用例、journey/interaction 证据、缺陷工单和风险串成 PRD-to-test-to-defect 签核矩阵；从 `1.80.0` 开始写出 `automation-specs.md/json`、`automation/frontlens.spec.ts` 与 `result.json.automationSpecs`，把需求/旅程/断言建议/测试用例转成需 QA 复核执行的 Playwright 自动化草案；从 `1.81.0` 开始写出 `evidence-bundle.md/json` 与 `result.json.evidenceBundle`，把缺陷工单、失败/阻断测试、需求追踪缺口、自动化草案和 artifactIntegrity 汇总成可交付证据包；从 `1.82.0` 开始写出 `test-strategy.md/json` 与 `result.json.qaStrategy`，把模块策略、环境计划、待补输入和下一步命令变成机器可读的专业测试策略；从 `1.83.0` 开始写出 `business-journeys.md/json` 与 `result.json.businessJourneys`，把 requirements、journeys、assertion suggestions、角色和测试数据缺口汇总成专业业务场景计划；从 `1.84.0` 开始写出 `review-calibration.md/json`、`review-calibration.config.json` 与 `result.json.reviewCalibration`，把人工复核/产品取舍/dev 环境噪音/API-UI 证据门槛沉淀为可复用校准配置；从 `1.85.0` 开始，复跑应用 `review-calibration.config.json` 时会识别 `_frontlensReviewCalibration` 并标记 `reviewCalibration.calibrationSource=config`，让后续分析知道人工校准已经生效；从 `1.86.0` 开始，已应用的 review calibration 会进入 `issueDisposition` / `summary.adjustedScore` / `fixTasks` / professional summary 口径，dev-server 噪音、产品取舍、未满足四段证据的 API/UI mismatch 不再污染机器修复队列，同时当前页显式 required scope 会覆盖旧校准。

`qaSignoff` 关键字段包括：

- `status`: `pass` / `pass-with-risks` / `fail` / `blocked`
- `confidence`: `high` / `medium` / `low`
- `businessValidationConfidence`: `runtime-verified` / `runtime-partial` / `static-source-only` / `not-verified`
- `scope.runtimeVerifiedJourneyCount` / `scope.requirementBoundRuntimeVerifiedJourneyCount` / `scope.weaklyAssertedJourneyCount` / `scope.pathOnlyJourneyCount`: 区分业务断言通过、弱断言和路径回放
- `blockers` / `risks` / `coverageGaps` / `requiredFollowups`: 为什么可以验收、为什么有风险、或为什么阻断

`requirementCoverage` 会区分用户提供的验收标准和从页面推断的能力覆盖；推断项只能说明覆盖缺口，不能代表 100% 业务通过。带 `selectors` / `expectedTexts` / `apiPatterns` / `journeySteps` 的显式需求会生成 `journeyTests[].source = requirement-generated` 和 `requirementIds[]`，用于把运行时证据绑定到 PRD。`productContext` 会让产品/ADR 明确的必选、可选、不在范围内能力参与 raw issue 处置，减少把样式风格、导出、分页、刷新、移动触控等需求取舍误报为代码缺陷。`testData` 会评估测试数据准备、setup、cleanup、敏感数据和生产写入风险；写操作需求没有隔离数据或清理策略时，`qaSignoff` 会降级或失败。`pageProfile` 会在缺少显式产品上下文时基于页面结构给出 credential/security、admin-list、dashboard、form、detail-master、login、public-content 等画像、建议问题和 productContext 草案；它只是提问与范围校准依据，不会替代 PRD/ADR 自动确认产品决策。`scopeReview` 会进一步把这些画像问题、缺失 PRD、目标设备、无障碍等级、角色态和可选/不在范围能力整理成 `scope-review.md`，并给出可复制到配置里的 `productContext` 草案；1.52+ 同时生成 `product-context.md/json`，1.53+ 额外生成可直接 `--config` 的 `product-context.config.json`，便于产品/QA 确认后重跑；未回答前，样式/产品/交互偏好类发现默认保持 conditional 或 non-actionable。`journeyAssertionAudit` 会把 `journeyTests[]` 中的路径回放与业务断言分开：只有带有业务文本、URL、选择器或 API 请求等有意义 `expect*` 的通过用例才算 `runtime-verified`；仅点击/填写或只验证 `body/#app` 可见的用例只能作为覆盖证据。`claimGuard` 会把分散在 qaSignoff、environment、scopeReview、sourceRuntimeCorrelation、artifactIntegrity、sourceHealth 中的证据收敛成“允许说/禁止说”的结论护栏；例如无 PRD、无 runtime assertion 或 scope 未配置时，会禁止“业务功能验证通过可信度 100%”这类过度承诺。`environment` 会识别 Vite dev server、本地 preview、内网/staging、file 和生产等价 HTTPS 环境，并给出 functional/performance/security/businessSignoff 可信度；dev server 下的请求数、源码路径泄露、HMR WebSocket 和传输体积不会当成生产结论。`sourceAnalysis` 会在提供 `--source-root` 或 `source.root` 时扫描路由、静态/动态 import、API 调用、loading/error/empty/retry 线索、单行/多行模板中的图标按钮可访问名称风险，以及 Vue/Svelte/JSX 页面里“错误态被空态吞掉”的 error-state-gap 风险，并把静态路由导入等源码级问题变成可复核证据。`sourceRuntimeCorrelation` 会把运行时 XHR/Fetch 与源码 API 调用、状态信号、页面组件、列表响应路径建立绑定，未绑定的全局 Network 数据不会直接触发“接口有数据但页面空”缺陷；1.42+ 在 sourceRoot/sourceAnalysis 已启用时，如果 sourceRuntimeCorrelation 未通过或绑定为 none/low，会直接抑制该类 raw finding；当绑定置信度为 medium/high 时，相关源码位置会汇总进 `rootCauseGroups[].sourceLocations`，作为专业报告的首选 file:line 修复面；1.69+ 还要求明确需求、具体列表响应和目标 UI 空态证据同时齐全，才会把 API/UI data-mismatch 升级为 actionable。`sourceHealth` 会识别 package scripts、对 TS/JS/Vue script 做非破坏性语法解析，并在显式启用 `--source-run-scripts` / `source.runScripts=true` 时运行受控脚本（默认 `typecheck,lint`），把脚本失败纳入源码确认问题；语法错误和失败的 typecheck/build/test 会成为发布阻断。`qaSignoff` 会把质量门禁、需求覆盖、登录/角色态、测试数据生命周期、运行时旅程、journey 成功断言、下载/导出文件产物与内容摘要、非破坏授权、测试环境可信度、页面画像/产品范围确认度、证据完整性和 source script checks 汇总成 pass / pass-with-risks / fail / blocked 以及 runtime-verified / runtime-partial / static-source-only / not-verified，避免把 raw score 当成业务验收结论。`artifactIntegrity` 会检查报告引用的本地证据路径是否存在，包括截图、DOM、视频、trace、JSON sidecar 和下载文件；缺失路径不能作为证据。`aiAnalysis` 是建议/摘要层；1.41+ 的 heuristic provider 不再产生 raw issue，command provider 返回的 issues 也必须经过 claimGuard、defectProof、source/runtime 证据门后才能当缺陷。`rootCauseGroups` 只从可执行 raw finding 生成，并会把多个 raw issue 合并成实现层根因，避免把同一 bug 的 500/404/timeout/a11y 多条证据当作多份工作量。`interactionTests[]` 是覆盖/证据层；1.43+ 中刷新、导出/下载、分页等产品可选能力的 warning 不再自动进入 raw issue，除非 PRD/productContext 明确要求该交互。`responsiveChecks[]` 同样是覆盖/证据层；1.44+ 中小触控目标默认不进入 raw issue，除非移动端/触控/WCAG 范围已明确。`issueDisposition` 会给每条 raw issue 标注 confirmed、needs-source-confirmation、deployment-only、product-decision、tool-limitation、insufficient-evidence 或 reference，并区分 actionable / conditional / non-actionable。`regressionPlan` 会把完整 rerun、proof-ready 根因验证、defect-proof 证据补充、需求缺口、失败 journey、下载/导出、sourceHealth、artifactIntegrity、环境复测和 testData 输入汇成可执行清单，修复后优先按 `regressionPlan.items[]` 而不是 raw issue 数量安排复测。`professionalSummary` 会进一步把 must-fix、should-fix、non-defect observations、coverage gaps、release risks 和 next actions 收敛成默认人类可读结论；`riskRegister` 会把这些 proof-ready 缺陷、覆盖缺口、环境/source-health/test-data/artifact 风险和签核阻断转成 impact × likelihood 发布风险矩阵，标明是否 blocks release、owner、mitigation 和 verification；`riskAcceptance` 会把 release-blocking/high/critical 风险进一步拆成必须整改或需要显式接受的决策清单，避免把“接受风险”误写成“缺陷已修复”；`assertionSuggestions` 会给弱断言/无断言 journey 生成可复制的 expect* 草案，帮助从“路径跑通”升级为“业务可验证”；`businessJourneys` 会把需求、已录 journey、断言草案、角色态和测试数据缺口汇成可复跑业务场景，但不替代实际执行证据；`reviewCalibration` 会把人工复核反馈转成 productContext/requirements/source 配置和 issue 动作，未提供反馈且没有应用校准配置时保持 needs-feedback；复跑应用 `review-calibration.config.json` 时会标记 `calibrationSource=config`，防止后续 Agent 凭上下文猜产品意图或重复追问；`testCases` 会把覆盖和证据转成正式测试用例账本，清楚标记哪些是 runtime-verified、哪些是 failed/blocked、哪些只是 manual-required/needs-input，避免把“没测/需输入”误写成“业务通过”或“代码缺陷”；`claimGuard` 是撰写这些结论前的安全阀，要求 Agent 使用 allowedWording、避免 forbiddenWording；`qaIntake` 是“不要猜、先问什么”的统一清单，会把 scopeReview、claimGuard、qaSignoff、regressionPlan、environment、sourceHealth、testData 和 artifactIntegrity 缺口合并成 P0-P3 问题，防止把样式/产品取舍或 API/UI 未绑定观察误写成必须修复缺陷；`defectProof` 是“能不能登记为专业缺陷”的证据强度表，needs-evidence 的 root cause 会被排除在 `fixTasks`、must-fix/should-fix、adjustedScore 和 professional CI 阻断之外，必须补 runtime/source/requirement/product/repro/owner 证据或降级为观察项后再排期；当前端 sourceRoot 已启用但根因没有 file:line 或 medium/high runtime-source 绑定时，默认不进入 proof-ready；异常模拟中的无反馈问题会按“用户能否看到失败原因/恢复入口”评估为前端错误态候选；在 1.38+ 中如果源码存在 `error-state-gap` 绑定，会进入 proof-ready 修复面，否则保持 needs-evidence，不会倒推成真实后端 5xx/4xx 契约问题；`report.md` 默认以 executive profile 承载最短决策型视图（需要更完整 QA-lead 复盘时传 `--report-profile professional`），完整 raw 细节移到 `evidence-report.md`，避免用户把 raw evidence 当作待办列表。1.45+ 的人类报告结论区以 Professional summary、QA sign-off、Adjusted score 和 proof-ready root causes 为先，raw score 只作为扫描趋势参考。1.46+ 中后台/管理页的可选 SEO 缺失默认不生成 raw issue，颜色对比度在未声明 WCAG AA/AAA 或严格 a11y 范围时归入产品/设计确认项。1.47+ 中 a11y/SEO/视觉等问题会自动剔除不匹配的 API/表格/分页修复建议，防止模板串味进入 fixTasks 或人类报告。1.48+ 中 dev server 性能噪声继续降级，但 sourceAnalysis 已定位到 file:line 的路由静态导入/重型依赖会保留为源码级 should-fix，并要求 build + preview 复测收益。1.49+ 中 Markdown 报告会在引用的本地证据路径后直接标注 `(missing artifact)` 或 `(unchecked artifact)`，artifactIntegrity 失败时不能把这些路径当作有效证据。1.50+ 中 `qa-review.md` 会在“非缺陷与降噪”下列出代表性的降级/不修/待补证据 issue、处置状态、owner、理由和下一步，默认以这张表解释为什么某些 raw findings 不进入修复。1.51+ 中 `professional-audit.md/json` 会随报告生成，作为后续 Agent 复盘前的硬性自检；若 audit 为 failed，应先修正报告契约、issueDisposition/actionability 或降级结论，再使用 must-fix/fixTasks。1.52+ 中 `product-context.md/json` 会随报告生成，作为产品范围复核和二次 rerun 的配置草案；1.53+ 同时生成 `product-context.config.json`，确认后可直接传给 `--config`；1.54+ 中 `qa-plan.md/json` 会把后续验收、补证和复测工作转成专业测试工作清单；1.55+ 中 `qa-coverage.md/json` 会把已覆盖、部分覆盖、跳过和待输入的 QA 维度显式列出；1.56+ 中 `professional-audit.md/json` 会用 qaCoverage 阻断覆盖不足下的验收/通过类过度承诺；1.57+ 中 `report.profile` 控制 `report.md` 的详略；1.68+ 默认是 executive 最短决策摘要，professional 更完整，full 会把 raw evidence 合并进主报告。1.58+ 中 `reportContentAudit` 会对生成后的 `report.md` 做内容级自检，发现 forbidden wording、profile-depth、raw-score-caveat、coverage-boundary 或 artifact-reference blocker 时，后续 Agent 不应直接复述该结论。1.59+ 中 `journeyAssertionAudit` 会阻断无断言或弱断言的需求绑定 journey 被写成“业务已通过”；1.60+ 中 `professionalAudit` 会把弱证据/产品范围/API-UI 推测的误升级作为 disposition-quality blocker；1.61+ 中 `reportContentAudit` 会把过长或表格过多的默认报告标成 profile-depth warning，要求把明细放到 evidence-report；1.62+ 中 `regressionPlan` / `qaPlan` 会把凭证/权限敏感页面、危险操作按钮和权限检查告警转成 `role-matrix` 补测项，要求用多角色期望合同复核后再下权限结论；1.63+ 中项目已有 build/typecheck/test/e2e/lint 脚本若未执行，会被列为 source-health 补测项；未经确认前它只是问题清单，不是 PRD。1.64+ 中 `riskRegister` 会把缺陷、覆盖缺口、环境、源码健康、测试数据和证据完整性汇总为 release-blocking / at-risk 风险矩阵；它用于发布风险管理，不替代产品风险接受。1.65+ 中 `riskAcceptance` 会输出 must-mitigate / needs-acceptance 决策清单；must-mitigate 会阻断 professional CI，needs-acceptance 需要记录接受人、范围、到期条件和后续验证。1.66+ 中 `testCases` 会输出正式用例矩阵，区分 passed/failed/partial/blocked/skipped/needs-input 与 runtime/static/hybrid/manual-required，帮助回答“测了什么、证据是什么、下一步是什么”，但不能单独替代 PRD、角色态、测试数据和 claimGuard 签核。1.67+ 中 `assertionSuggestions` 会输出断言补强建议；它不是通过证据，必须加入 journey/requirements 并复跑后才可用于业务验收。1.75+ 中 API/UI data-mismatch 缺少显式需求或 source-runtime 绑定时默认不再生成 raw 缺陷，`suggestions`/MCP suggestions 默认过滤 product/style/deployment/tool/needs-evidence 噪声，`--all`/`all=true` 仅用于 raw 审计。CI 默认使用 professional gate：`--min-score` 读取 proof-aware 的 `summary.adjustedScore`，`--fail-on` 只统计 actionable 且 defectProof 为 proven/probable 的 finding；同时会把 `reportContentAudit=failed`、`journeyAssertionAudit=failed`、`qaSignoff/qualityGate=fail|blocked`、`artifactIntegrity=failed`、`claimGuard/qaIntake=blocked`、`qaCoverage=insufficient/failed`、`riskRegister=blocked`、`riskAcceptance=blocked`、`testCases=blocked` 作为专业报告/签核契约阻断；只有显式传 `--gate-mode raw` 时才让部署/产品/工具噪音按旧 scanner 口径失败且忽略这些专业契约阻断。P2 visual 在配置 `p2.visual.baselineDir` 后会读取 `baseline.png`，保存当前截图 `visual/current.png` 和差异图 `visual/diff.png`，用像素变化比例而不是 PNG 字节差异判断视觉回归；未配置基线时只采集当前截图作为证据。CI、MCP、后续修复 Agent 和 LLM 复盘都应优先读取 `professional-audit.md/json` + `report-content-audit.md/json` + `journey-assertion-audit.md/json` + `qa-plan.md/json` + `qa-coverage.md/json` + `assertion-suggestions.md/json` + `business-journeys.md/json` + `test-cases.md/json` + `risk-register.md/json` + `risk-acceptance.md/json` + `product-context.md/json` + `product-context.config.json` + `qa-intake.config.json` + `professionalSummary` + `reportContentAudit` + `journeyAssertionAudit` + `assertionSuggestions` + `businessJourneys` + `reviewCalibration` + `testCases` + `claimGuard` + `qaIntake` + `defectProof` + `qaSignoff` + `qualityGate` + `requirementCoverage` + `testData` + `environment` + `pageProfile` + `scopeReview` + `sourceAnalysis` + `sourceRuntimeCorrelation` + `sourceHealth` + `artifactIntegrity` + `issueDisposition` + `rootCauseGroups` + `regressionPlan`，再结合需求、源码和运行证据做最终验收判断。

## 误报降噪原则

`frontend-qa` skill 内置了针对前端 QA 的二次校准规则，例如：

- Vite dev server 的 `/src/*.vue`、`@vite/client`、HMR WebSocket 不直接算生产安全/性能问题。
- 异常模拟产生的 500/404/401/403 不直接算后端契约问题；但如果页面没有错误态/重试，会保留为前端韧性根因候选。
- 浏览器原生 `Failed to load resource` 不直接算应用 console bug。
- 卡片/主从布局不能套表格分页/导出规则。
- URL path 中的 `credentials` 不等于敏感信息泄露。
- CSS 类名如 `.el-input__password` 不等于真实密码泄露。
- 所有 retained 前端问题必须尽量给出源码 file:line 证据。
- 录制业务流只是回放骨架；没有成功且有业务含义的 `expectVisible` / `expectText` / `expectUrl` / `expectRequest` 断言、测试数据和角色态时不能宣称业务 100% 通过；先读 `journey-assertion-audit.md`。
- `assertionSuggestions` 是补强建议，不是通过证据；只有加入配置并复跑通过后才能支撑业务结论。
- `testCases` 是测试执行账本，不是 PRD 替代品；`needs-input` / `manual-required` 是待补测项，不能当成代码 bug；`passed` 也只代表该用例范围内通过，不能覆盖未提供的业务需求。
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
  --report-profile executive \
  --sme \
  --json-summary
```

`--sme` 是中小企业标准 QA 快捷开关；如需深度性能/安全/视觉/移动/取证，请改用对应专项 skill 或显式开启模块。`--json-summary` 只打印可给 Agent 消费的低 token 摘要，完整机器数据仍写入 `result.json`。`--report-profile executive|professional|full` 控制主报告 `report.md` 详略：默认 `executive` 最短；`professional` 更适合 QA-lead 复盘；`full` 会把完整 evidence appendix 合进主报告。无论哪种 profile，`evidence-report.md` 都会完整生成。

如需带验收标准：

```bash
node dist/cli.js qa --url "https://example.com" --requirements "requirements.json"
node dist/cli.js disposition --report "reports/frontlens/example/result.json"
node dist/cli.js root-causes --report "reports/frontlens/example/result.json"
```

### 查看已有结果

```bash
node dist/cli.js brief --report "reports/frontlens/example/result.json"
node dist/cli.js audit --report "reports/frontlens/example/result.json"
node dist/cli.js product-context --report "reports/frontlens/example/result.json"
node dist/cli.js claim-guard --report "reports/frontlens/example/result.json"
node dist/cli.js qa-intake --report "reports/frontlens/example/result.json"
node dist/cli.js defect-proof --report "reports/frontlens/example/result.json"
node dist/cli.js defect-tickets --report "reports/frontlens/example/result.json"
node dist/cli.js traceability --report "reports/frontlens/example/result.json"
node dist/cli.js automation-specs --report "reports/frontlens/example/result.json"
node dist/cli.js report-content-audit --report "reports/frontlens/example/result.json"
node dist/cli.js journey-assertion-audit --report "reports/frontlens/example/result.json"
node dist/cli.js qa-plan --report "reports/frontlens/example/result.json"
node dist/cli.js qa-coverage --report "reports/frontlens/example/result.json"
node dist/cli.js assertion-suggestions --report "reports/frontlens/example/result.json"
node dist/cli.js business-journeys --report "reports/frontlens/example/result.json"
node dist/cli.js test-cases --report "reports/frontlens/example/result.json"
node dist/cli.js risk-register --report "reports/frontlens/example/result.json"
node dist/cli.js risk-acceptance --report "reports/frontlens/example/result.json"
node dist/cli.js artifact-integrity --report "reports/frontlens/example/result.json"
node dist/cli.js evidence-bundle --report "reports/frontlens/example/result.json"
node dist/cli.js test-strategy --report "reports/frontlens/example/result.json"
# claim-guard、qa-intake、defect-proof、defect-tickets、traceability、automation-specs、evidence-bundle、test-strategy、business-journeys、report-content-audit、journey-assertion-audit、assertion-suggestions、test-cases、risk-register、risk-acceptance、artifact-integrity 均由 qa 自动生成或可通过 helper 重算，也可直接读 result.json.claimGuard / qaIntake / defectProof / defectTickets / traceability / automationSpecs / evidenceBundle / qaStrategy / businessJourneys / reportContentAudit / journeyAssertionAudit / assertionSuggestions / testCases / riskRegister / riskAcceptance / artifactIntegrity
node dist/cli.js inspect --report "reports/frontlens/example/result.json"
node dist/cli.js issues --report "reports/frontlens/example/result.json" --severity high
node dist/cli.js security --report "reports/frontlens/example/result.json"
node dist/cli.js coverage --report "reports/frontlens/example/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/example/result.json"
node dist/cli.js suggestions --report "reports/frontlens/example/result.json"
node dist/cli.js suggestions --report "reports/frontlens/example/result.json" --all
```

`brief` 会输出一页式专业 QA 摘要：签核状态、adjusted/raw score、proof-ready 根因、非缺陷分桶、待补证据和关键报告路径。它适合作为 LLM / skill 最终答复的默认骨架，避免把完整 raw report 当成用户结论。

`qa-plan` 会把一次扫描转成专业测试工程师工作清单：缺哪些 PRD、要录哪些 journey、哪些产品范围要确认、哪些环境/测试数据/缺陷补证要先处理。

`claim-guard` 会输出允许/禁止措辞，防止“业务 100% 通过”等过度承诺；`defect-proof` 会输出 root cause 证据强度，防止 needs-evidence 被排进修复；`report-content-audit` 和 `journey-assertion-audit` 会分别检查报告内容和业务旅程断言质量。`qa-intake` 会输出专业测试待补输入和可编辑 rerun config，优先用它回答 PRD/product/source/testData 缺口，而不是猜；其中 `_frontlensQaIntake.draftAssertionSteps[]` 是待确认断言草案，确认并复制到 journey/requirement 后复跑才算业务证据。`qa-coverage` 会输出覆盖矩阵：哪些维度 covered、partial、skipped、needs-input 或 failed，避免把未执行的交互/业务流/环境检查误写成通过。`assertion-suggestions` 会输出可复制的 expect* 补强步骤，用于修正 path-only / weak journey 后复跑。`business-journeys` 会输出业务场景计划，用于决定哪些场景 ready、哪些还缺 PRD/动作/断言/角色/测试数据；它不是已通过证据。`test-cases` 会输出正式测试用例矩阵：每条用例的优先级、执行方式、期望、实际、证据和下一步，便于专业测试工程师复核。`risk-register.md/json` 会输出发布风险矩阵：哪些风险阻断发布、由谁处理、如何缓解和如何验证。`risk-acceptance.md/json` 会输出风险接受/必须整改清单：哪些风险不能接受必须先修，哪些风险需要产品/QA/Release 明确接受后才能带风险发布。`artifact-integrity` 会重算证据路径是否存在；缺失或不可移植路径不能作为截图/视频/下载证明。`suggestions` 默认只返回 proof-ready/actionable 建议；`--all` 只用于审计被抑制的 raw 建议。

`audit` 会对 `result.json` 做专业报告契约自检：是否过度承诺业务通过、是否把非 proof-ready / non-actionable 问题排进 must-fix/fixTasks、源码绑定和 artifactIntegrity 是否足够、claimGuard / qaIntake / qaSignoff 是否一致。它适合作为 CI 或后续 Agent 使用报告前的最后护栏。

`product-context` 会输出可复核的 `productContext` 配置草案与范围问题；产品/QA 确认后使用 `product-context.config.json` 或复制到配置并重跑，样式风格、分页/导出/刷新、移动触控等产品取舍项才会稳定降噪。

### 对比两次结果

```bash
node dist/cli.js diff \
  --before "reports/frontlens/old/result.json" \
  --after "reports/frontlens/new/result.json" \
  --output "reports/frontlens/diff"
```

`diff.md/json` 会先输出 Professional QA Diff：对比 `adjustedScore`、`qaSignoff`、业务验证置信度、proof-ready 修复项、新增/已解决 must-fix/should-fix，再把 raw scanner issue diff 放到后面作趋势参考。修复验收时优先看 professional.interpretation，而不是 raw issue 数量。

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
- `frontlens_audit`
- `frontlens_product_context`
- `frontlens_claim_guard`
- `frontlens_qa_intake`
- `frontlens_defect_proof`
- `frontlens_report_content_audit`
- `frontlens_journey_assertion_audit`
- `frontlens_qa_plan`
- `frontlens_qa_coverage`
- `frontlens_assertion_suggestions`
- `frontlens_business_journeys`
- `frontlens_review_calibration`
- `frontlens_test_cases`
- `frontlens_risk_register`
- `frontlens_risk_acceptance`
- `frontlens_artifact_integrity`
- `frontlens_diff`
- `frontlens_env_compare`
- `frontlens_suggestions`

## 推荐协作模式

1. 用户用自然语言提出 QA 目标。
2. `frontend-qa` skill 选择模块并派生独立 subagent。
3. 证据采集引擎生成 raw artifacts、`professional-audit.md/json` 报告契约自检、`claim-guard.md/json` 结论护栏、`defect-proof.md/json` 缺陷证明、`report-content-audit.md/json` 内容自检、`journey-assertion-audit.md/json` 旅程断言自检、`qa-plan.md/json` QA 执行计划、`qa-coverage.md/json` 覆盖矩阵、`assertion-suggestions.md/json` 断言补强建议、`business-journeys.md/json` 业务场景计划、`review-calibration.md/json` 复核校准、`test-cases.md/json` 测试用例矩阵、`risk-register.md/json` 发布风险矩阵、`risk-acceptance.md/json` 风险接受/必须整改清单、`product-context.md/json` + `product-context.config.json` + `qa-intake.config.json` 产品范围/测试输入草案、决策型 `report.md`、精简 `qa-review.md` 和完整 `evidence-report.md`。
4. LLM 优先读取一页式 `brief.md`，再按需读取 `professional-audit.md`、`claim-guard.md`、`defect-proof.md`、`report-content-audit.md`、`journey-assertion-audit.md`、`business-journeys.md`、`qa-plan.md`、`qa-coverage.md`、`assertion-suggestions.md`、`test-cases.md`、`risk-register.md`、`risk-acceptance.md`、`product-context.md`、`product-context.config.json`、`qa-intake.config.json`、源码和规则文档。
5. LLM 输出经过校准后的真实问题与修复建议。
6. 修复后再次运行 skill，并用 diff 的 Professional QA Diff 对比 adjustedScore、签核状态和 proof-ready 修复项，而不是只看 raw issue 数。

## 作者

果比AI guobi.ai
