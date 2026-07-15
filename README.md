# FrontLens

FrontLens 是一套面向 Codex / LLM Agent 的**需求驱动测试工具与 Skills 集合**。它把需求文档转换成可追踪的测试计划，执行页面、API、源码和数据侧验证，并输出带证据、复现步骤和发布结论的 Markdown/JSON 报告。

```text
需求文档 + 项目源码
        ↓
结构化需求与验收标准
        ↓
Git 基线差异与影响模块
        ↓
frontend / backend / api / source 测点
        ↓
新需求 + 受影响原业务的 P0～P3 测试用例
        ↓
开发 P0 阻塞自测 + QA 全量测试
        ↓
执行证据、缺陷定位、复现步骤
        ↓
Markdown 报告与发布建议
```

## 解决什么问题

- 从 Markdown 或文本 PRD 拆分需求、验收标准和测试点。
- 覆盖正常、异常、边界、权限、状态流转、一致性、事务、幂等、并发、依赖失败和恢复场景。
- 将用例划分为 `P0`～`P3`：开发获得 P0 阻塞子集，测试工程师获得完整用例。
- 测试前端页面、接口、后端服务和相关源码，而不只检查页面是否能打开。
- 只有实际执行且正确绑定到需求、层级和场景的证据才能判定通过。
- 缺陷报告包含优先级、复现步骤、预期/实际结果、证据和可支持时的源码 `file:line`。
- 自动比较当前变更与 Git 基础分支，分析直接/传播影响模块，并生成受影响原业务的定向回归用例。
- 默认返回低 Token 摘要，完整证据保留在本地产物中。

## 组成

| 组件 | 适用场景 |
| --- | --- |
| `frontend-qa` | 常规前端页面、API、源码与发布风险检查 |
| `backend-qa` | 纯后端/API/服务项目；复用现有测试环境或编排隔离部署 |
| `frontend-qa-performance` | 性能、资源体积、Coverage、Core Web Vitals |
| `frontend-qa-security` | CSP、HTTPS、Cookie、敏感信息和权限安全 |
| `frontend-qa-visual` | 截图对比、视觉回归和设计验收 |
| `frontend-qa-mobile` | H5、响应式、触控、iOS/Android 兼容 |
| `frontend-qa-automation` | Playwright 流程录制和回归脚本 |
| `frontend-qa-forensics` | 完整取证、事故调查和高深度报告 |
| TypeScript CLI | 确定性的计划生成、Playwright 取证、证据归因和报告生成 |

> `backend-qa` 的部署与环境发现由 Agent 读取目标仓库已有的 Compose、Testcontainers、Make/Task、启动脚本和部署配置后编排；CLI 本身不是一套对所有技术栈使用固定命令的通用部署器。

## 安装

要求：Node.js 20+。

```bash
git clone git@github.com:exgbit/FrontLens.git
cd FrontLens
npm install
npx playwright install chromium
npm run build
```

将 Skills 安装到 Codex：

```bash
mkdir -p "$HOME/.codex/skills"
for skill in skills/backend-qa skills/frontend-qa*; do
  rsync -a "$skill/" "$HOME/.codex/skills/$(basename "$skill")/"
done
```

重新打开 Codex 会话后，通过自然语言调用相应 Skill。

## 快速开始

### 测试前端项目

```text
用 frontend-qa 测试这个项目：
需求文档 /path/to/prd.md
前端源码 /path/to/frontend
页面 http://127.0.0.1:5173/admin/users
如果尚未启动，请按项目现有方式自动构建和启动。
生成 P0～P3 用例，执行前端、API 和代码检查，输出 Markdown 报告。
```

默认 `frontend-qa` 聚焦中小项目的核心发布风险。只有明确需要时再调用性能、安全、视觉、移动端、自动化或完整取证 Skill，避免无意义的执行与 Token 消耗。

直接运行 CLI：

```bash
node dist/cli.js qa \
  --url "http://127.0.0.1:5173/admin/users" \
  --source-root "/path/to/frontend" \
  --source-run-scripts \
  --source-scripts "typecheck,lint,test" \
  --output reports/frontend-qa \
  --sme --json-summary
```

### 测试纯后端项目

正常情况下只需提供需求文档和源码，**不需要预先提供 API 地址**：

```text
用 backend-qa 测试这个纯后端项目：
需求文档 /path/to/prd.md
源码 /path/to/backend
自动识别项目和测试环境；没有可用测试环境时按仓库现有方式隔离部署。
发现 API，执行 P0～P3 的接口、后端、数据和代码测试。
生成 Markdown 报告，只清理本轮创建的资源和测试数据。
```

如果测试环境已经部署，可额外提供精确线索：

```text
用 backend-qa 测试这个纯后端项目：
需求文档 D:\project\docs\prd.md
源码 D:\project\service
测试环境已经部署，可通过 SSH alias 171 连接。
远程部署目录 /var/www/service，环境文件 /var/www/service/.env。
优先复用并健康检查现有测试环境。
允许创建并清理带本轮唯一标记的测试数据，禁止连接或修改生产环境。
```

`backend-qa` 按以下顺序选择环境：

1. 复用已授权且健康的 test/staging 环境。
2. 用户明确要求部署/更新，或项目提供每轮独立命名空间时执行部署。
3. 没有可用环境时启动本地隔离环境。
4. 安全部署仍失败时运行可执行的源码检查，并将其他项目标记为 `blocked`/`needs-input`。

环境发现可以使用用户声明的环境名、精确 SSH alias、部署目录、Compose 端口映射、代理/Ingress、白名单环境键、有限日志、Health、OpenAPI 和路由源码。它不会：

- 扫描未声明的主机、网段或无关容器；
- 打印整份远程 `.env` 或把秘密写入报告；
- 把容器内部地址直接当成客户端可访问地址；
- 因发现失败就重启、迁移、清库或重部署共享测试环境；
- 要求所有项目使用固定 IP、端口或部署命令。

服务只监听远端回环地址时，可以建立本轮临时 SSH tunnel；结束时只关闭该 tunnel。**用户提供或开放明确标记为 test/staging 的数据库，即视为已经授权本轮进行受控的业务数据读写，不再二次询问。** Skill 会先生成 run ID、登记精确清理操作，并只删除本轮实际创建的记录 ID。该默认授权不包含迁移、`DROP`、`TRUNCATE`、批量更新/删除或修改原有数据。

创建业务数据时优先调用业务 API、Service 命令或项目已有 Seed/Fixture，以覆盖校验、状态流转和副作用；只有缺少业务入口时才直接写数据库。连接权限、必填业务前置或账号能力确实不足时，报告必须给出具体失败命令和缺失条件，不能再笼统询问“是否允许写测试数据”。

## Git 变更影响与原业务回归

提供 `sourceRoot` 时，`test-plan` 默认启用变更影响分析：

1. 基础分支优先使用用户传入的 `--base-ref`；否则依次检测远端默认分支、`main`、`master`、`develop`。
2. 使用 merge-base 比较提交差异，不把分支分叉后的无关提交误算为本次变更。
3. 目标为当前 `HEAD` 时，默认同时包含 staged、unstaged 和 untracked 文件。
4. 从变更文件、符号、路由、相对 import、相关测试和一至二跳引用中生成影响模块与业务流程。
5. 生成带 `CHANGE-REG-*` 标识的原业务回归目标和 P0～P3 用例；高风险 P0 同时进入开发阻塞自测。
6. 最终报告将“新需求验证”与“受影响原业务回归”分开显示。

```bash
node dist/cli.js test-plan \
  --input docs/prd.md \
  --source-root /path/to/project \
  --base-ref origin/main \
  --include-working-tree \
  --output reports/test-plan
```

`--base-ref` 可以省略；项目不会写死 `main`。`--head-ref` 默认为 `HEAD`，可以用于检查指定提交或分支。只比较已经提交的两个 ref 时使用 `--no-working-tree`；确实不需要变更影响分析时使用 `--no-change-impact`。

当 `sourceRoot` 指向 monorepo 子目录时，变更文件和计数只覆盖该子目录；工具会规范化 macOS `/tmp`、符号链接等真实路径差异，并在文件重命名移入/移出范围时同时检查旧路径。为避免报告占用过多 Token，`change-impact.md` 按风险优先最多展示 50 个文件、30 个模块和 30 个回归目标，完整有界结果保留在 `change-impact.json`。

静态影响分析只负责选择回归范围，不能证明旧业务正常。`CHANGE-REG-*` 目标必须通过运行时证据或 `.frontlens/test-evidence.json` 中对应目标 ID 的自动化绑定实际执行；未执行时保持 `not-run`/`needs-input`，不会写成通过。

单独生成纯后端测试计划：

```bash
node dist/cli.js test-plan \
  --input /path/to/prd.md \
  --source-root /path/to/backend \
  --project-type backend \
  --output reports/backend-plan
```

`backend` 模式不会生成页面、浏览器或前端用例。`--project-type` 支持：

```text
auto | frontend | backend | fullstack
```

## 需求驱动完整流程

### 1. 生成测试计划

```bash
node dist/cli.js test-plan \
  --input docs/prd.md \
  --source-root /path/to/project \
  --project-type auto \
  --base-ref origin/main \
  --output reports/test-plan
```

| 产物 | 内容 |
| --- | --- |
| `test-plan-summary.json` | 低 Token 计划摘要 |
| `change-impact.md` | Git 基线、变更文件、影响模块和原业务回归摘要 |
| `change-impact.json` | 完整机器可读影响图和 `CHANGE-REG-*` 目标 |
| `requirements.md` | 结构化需求与分层测点 |
| `developer-test-cases.md` | 开发提测前执行的 P0 阻塞用例 |
| `qa-full-test-cases.md` | 测试工程师执行的 P0～P3 全量用例 |
| `test-design-traceability.md` | 需求 → 测点 → 用例追踪 |
| `test-plan.json` | 完整机器可读计划 |

### 2. 执行测试并收集证据

```bash
node dist/cli.js qa \
  --url "$TEST_URL" \
  --requirements reports/test-plan/test-plan.json \
  --source-root /path/to/project \
  --source-run-scripts \
  --source-scripts "typecheck,lint,test" \
  --output reports/qa \
  --sme --json-summary
```

后端需求级自动化证据应在目标项目的 `.frontlens/test-evidence.json` 中显式绑定：

```json
{
  "bindings": [
    {
      "id": "ORDER-CREATE-IDEMPOTENCY",
      "requirementIds": ["REQ-003"],
      "layer": "backend",
      "scenarios": ["idempotency", "consistency"],
      "scriptNames": ["test"],
      "evidenceRefs": ["test/orders.create.test.ts"]
    }
  ]
}
```

仓库全局测试通过只代表代码健康，不能批量替代每条需求的验收证据。
原业务回归使用相同机制：把 `requirementIds` 设置为计划生成的 `CHANGE-REG-*` 目标 ID，并使用 `scenario: regression`；只有该目标对应的测试实际通过后，报告才会声明受影响原业务正常。

### 3. 生成最终报告

```bash
node dist/cli.js test-report \
  --plan reports/test-plan/test-plan.json \
  --report reports/qa/result.json \
  --output reports/final \
  --fail-on-blocked
```

主要输出：

- `test-report.md`
- `test-execution-summary.json`
- `test-execution-details.md`
- `test-execution-report.json`
- `artifact-manifest.json`

## 结果状态

| 状态 | 含义 |
| --- | --- |
| `passed` | 需求、层级和场景对应的证据实际执行通过 |
| `partial` | 部分证据通过，仍有子场景未执行或跳过 |
| `failed` | 存在可复现且证据充分的失败 |
| `needs-review` | PRD、角色、验收标准或授权范围需要确认 |
| `needs-input` / `not-run` | 缺少执行条件或尚未测试 |
| `blocked` | P0 未关闭、环境不可用、代码健康失败或关键证据缺失 |

预期的 `401/403/404` 可以是验收成功。API 证据按 HTTP method、模板路径和该操作自己的预期状态码绑定，不会把同路径的不同方法相互归因。

## 内网 TLS 证书

FrontLens 默认严格校验证书。明确属于内网测试环境且证书无效时，可以按目标启用请求级绕过：

```bash
node dist/cli.js qa \
  --url "$TARGET_URL" \
  --ignore-https-errors \
  --output reports/intranet \
  --sme --json-summary
```

或在配置中设置：

```json
{
  "browser": {
    "ignoreHTTPSErrors": true
  }
}
```

该配置适用于任意项目，不绑定 IP、域名或端口，并已覆盖 `qa`、`auth save`、`journey record`、`matrix`、`role-matrix`、`env-compare` 和 MCP 对应入口。报告仍会记录 `tlsVerificationBypassed: true`、降低安全可信度并保留证书整改项。

## 登录态与权限矩阵

```bash
node dist/cli.js auth save \
  --url "$LOGIN_URL" \
  --output .frontlens/auth/admin.json

node dist/cli.js role-matrix \
  --url "$TARGET_URL" \
  --role admin=.frontlens/auth/admin.json \
  --role viewer=.frontlens/auth/viewer.json \
  --output reports/roles
```

隐藏按钮不能证明权限安全；权限结论还必须验证服务端/API 的拒绝行为。

## Windows 产物目录权限

CLI 在 Windows 下会让新产物目录继承父目录 ACL，并在结束前清理 `CodexSandboxOffline` 可能遗留的显式 DACL。修复旧产物目录：

```powershell
node dist/cli.js permissions repair `
  --output "D:\path\to\generated-output"
```

修复仅面向明确的生成产物目录：不会向 `Everyone` 授权，不修改父级 ACL，并拒绝磁盘根目录、用户 Home、源码工作区及其祖先、文件和符号链接。

## 低 Token 使用

推荐按以下顺序读取产物：

1. `test-plan-summary.json`
2. `change-impact.md`
3. `brief.md`
4. `qa-review.md` 或 `test-report.md`
5. 只针对失败/阻塞需求和原业务回归目标读取对应明细

默认不要把 `result.json`、`network.json`、`page-model.json`、`evidence-report.md`、`test-plan.json` 或 `test-execution-report.json` 整体放入模型上下文。CLI 的 `--json`、MCP 的 `detail=true` / `includeMarkdown=true` 仅在确实需要完整明细时使用。

## 安全与清理边界

- 未明确为 test/staging 的环境默认阻止未经授权的 `POST/PUT/PATCH/DELETE`；用户提供或开放明确的测试数据库后，默认允许本轮自有记录的有界 CRUD，无需二次确认。
- 不连接、测试或修改生产环境及生产数据库。
- 测试数据库默认授权不包含迁移、`DROP`、`TRUNCATE`、宽泛更新/删除或修改原有记录；优先通过 UI/API/Service 执行业务写入。
- 前端测试数据库写入使用步骤级 `allowMutating=true` 和最小 `safety.allowCreate/allowEdit/allowDelete/allowSubmit` 临时配置，同时保持 `blockMutatingRequests=true`；不因测试库授权而全局放开所有写请求。
- 自动部署不能修改业务源码来制造测试通过。
- 不停止已有进程，不执行宽泛 Docker/system 清理。
- 共享测试环境只清理由本轮 run ID 登记并记录精确 ID 的数据。
- 新建隔离环境只清理本轮记录的 PID、Compose project、容器、网络、卷和临时配置。
- 清理失败必须保留在发布风险/阻塞结论中。
- 未执行、跳过或证据不足不能写成通过。

## MCP

```bash
node dist/cli.js mcp
```

MCP 覆盖 QA、测试计划、测试报告、浏览器矩阵、角色矩阵、环境对比和结果消费工具，默认返回 compact response。

## 开发与验证

```bash
npm run check
npm test
npm run build
```

校验单个 Skill：

```bash
python "$HOME/.codex/skills/.system/skill-creator/scripts/quick_validate.py" \
  skills/backend-qa
```

## 目录结构

```text
FrontLens/
├── skills/       # Codex Skills
├── src/          # CLI、Playwright 取证、计划与报告引擎
├── test/         # 单元和回归测试
├── docs/         # 详细使用指南
├── examples/     # 示例 PRD 与应用
└── frontlens.config.example.json
```

更完整的操作说明参见 [需求驱动测试指南](docs/requirement-driven-testing-guide.md)。CLI 全部命令与参数：

```bash
node dist/cli.js --help
```

## 能力边界

- 未知技术栈、缺失凭证、不可用外部依赖或环境身份不明确时，FrontLens 会输出阻塞证据和下一步，而不是猜测地址或伪造结果。
- `backend-qa` 依赖目标项目已有且可验证的部署入口；不同项目不会被强制套用同一 IP、端口或启动命令。
- Windows ACL 已有自动化安全边界测试，发布前仍建议在目标 Windows 环境做一次真机集成验证。
