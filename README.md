# FrontLens

FrontLens 是一套面向 Codex / LLM Agent 的**需求驱动 QA 方案**。

- `frontend-qa`：页面、API、前端源码与发布风险测试。
- `backend-qa`：从 PRD 和后端源码自动识别、部署、发现 API、执行测试并清理。
- TypeScript CLI：提供确定性的需求拆分、Playwright 取证、测试计划、证据归因和 Markdown/JSON 报告。

目标流程：

```text
需求文档
  → 结构化需求
  → 前端 / 后端 / API / 代码测点
  → P0～P3 测试用例
  → 开发 P0 阻塞自测 + QA 全量测试
  → 运行证据、缺陷定位与复现步骤
  → Markdown 报告
```

## 核心能力

- 将 Markdown、文本 PRD 转成结构化需求和验收草案。
- 按 `frontend | backend | api | source` 分层生成测点。
- 生成正常、异常、边界、权限、状态流转、一致性、幂等、恢复和回归场景。
- 自动检查启动、认证、核心流程、数据完整性、依赖失败和兼容性等阻塞类别。
- P0 用例同时交给开发和 QA；P1～P3 进入 QA 全量用例。
- 页面项目采集 Network、Console、DOM、截图、Coverage、异常模拟和源码关联证据。
- 后端项目通过 Skill 复用仓库现有 Testcontainers、Docker Compose、Make/Task 或项目脚本自动部署。
- 只把实际执行且完成需求、层级和场景绑定的证据标记为通过。
- 输出缺陷优先级、复现步骤、预期/实际结果、证据和源码 `file:line`。
- 默认返回有界低 Token 摘要，完整明细写入本地产物。

## 安装

要求：Node.js 20+。

```bash
git clone git@github.com:exgbit/FrontLens.git
cd FrontLens
npm install
npx playwright install chromium
npm run build
```

安装 Skills：

```bash
mkdir -p ~/.codex/skills
for skill in skills/backend-qa skills/frontend-qa*; do
  rsync -a "$skill/" "$HOME/.codex/skills/$(basename "$skill")/"
done
```

重新打开 Codex 会话后即可通过自然语言调用。

## 前端项目使用方式

最简单的指令：

```text
用 frontend-qa 分析这个页面：
页面 http://127.0.0.1:5173/admin/users
源码 /path/to/frontend
需求文档 /path/to/prd.md
如果项目没有启动，请自动构建和部署；输出 SME 标准 QA 结论。
```

`frontend-qa` 默认执行影响发布决策的核心检查，不默认展开完整安全、性能、视觉、移动端或取证矩阵。专项需求使用：

- `frontend-qa-performance`
- `frontend-qa-security`
- `frontend-qa-visual`
- `frontend-qa-mobile`
- `frontend-qa-automation`
- `frontend-qa-forensics`

手动运行证据引擎：

```bash
node dist/cli.js qa \
  --url "http://127.0.0.1:5173/admin/users" \
  --source-root "/path/to/frontend" \
  --source-run-scripts \
  --source-scripts "typecheck,lint,test" \
  --output reports/frontend-qa \
  --sme --json-summary
```

## 纯后端项目使用方式

用户不需要提前提供 API 地址。正常输入只有需求文档和源码：

```text
用 backend-qa 测试这个纯后端项目：
需求文档 /path/to/prd.md
源码 /path/to/backend
请自动部署、发现 API、执行 P0～P3 测试、生成 Markdown 报告并清理本轮资源。
```

`backend-qa` 将：

1. 有界读取 README、构建清单、锁文件、Compose、Makefile、迁移、路由和测试配置。
2. 识别语言、框架、测试命令、依赖服务、启动方式、Health、OpenAPI 和认证线索。
3. 使用隔离端口、数据库、缓存和队列部署测试环境。
4. 从实际监听端口、容器映射、日志、Health/OpenAPI 和源码发现 API。
5. 执行格式化检查、lint、typecheck、build、单元/集成测试及真实 HTTP 请求。
6. 验证状态码、响应契约、权限、持久化、副作用、回滚、并发、幂等和恢复。
7. 在 `finally` 等价路径中只清理本轮记录的 PID、Compose project、容器、网络、卷和测试数据。

缺失外部凭证或依赖无法安全启动时，结果为 `blocked`，不会虚构 URL 或通过结论。

单独生成纯后端测试计划：

```bash
node dist/cli.js test-plan \
  --input /path/to/prd.md \
  --source-root /path/to/backend \
  --project-type backend \
  --output reports/backend-plan
```

`backend` 模式保证不生成前端、页面或浏览器用例。`--project-type` 支持：

```text
auto | frontend | backend | fullstack
```

`auto` 只读取有界项目元数据和框架标记；未知技术栈由 Skill 复核后显式选择类型。

## 需求驱动完整流程

### 1. 生成测试计划

```bash
node dist/cli.js test-plan \
  --input docs/prd.md \
  --source-root /path/to/project \
  --project-type auto \
  --output reports/test-plan
```

主要产物：

| 文件 | 用途 |
| --- | --- |
| `test-plan-summary.json` | 低 Token 计划摘要 |
| `requirements.md` | 结构化需求和分层测点 |
| `developer-test-cases.md` | 开发提测前必须执行的 P0 子集 |
| `qa-full-test-cases.md` | QA P0～P3 全量用例 |
| `test-design-traceability.md` | 需求→测点→用例追踪 |
| `test-plan.json` | 完整机器可读计划，按需读取 |

### 2. 执行页面/API/代码测试

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

后端需求级自动化证据应在目标项目的 `.frontlens/test-evidence.json` 显式绑定：

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

全局测试通过只证明仓库健康，不会批量冒充每条需求通过。

### 3. 合并最终报告

```bash
node dist/cli.js test-report \
  --plan reports/test-plan/test-plan.json \
  --report reports/qa/result.json \
  --output reports/final \
  --fail-on-blocked
```

最终输出包括：

- `test-execution-summary.json`
- `test-report.md`
- `test-execution-details.md`
- `test-execution-report.json`
- `artifact-manifest.json`

## 结果状态

- `passed`：该用例的需求、层级和场景证据实际执行通过。
- `partial`：只有部分证据通过，仍有子场景未执行或跳过。
- `needs-review`：PRD、角色、写操作或验收标准需要确认，不等同代码失败。
- `needs-input` / `not-run`：缺少执行条件或尚未测试。
- `blocked`：P0 未关闭、环境不可用、代码健康失败或关键证据缺失。
- `failed`：存在可复现且证据充分的失败。

预期的 `401/403/404` 可以是验收成功结果。API 证据严格按 HTTP method、模板路径和该操作自己的预期状态码绑定，不会把同路径 GET/DELETE 或多 API 状态码交叉归因。

## 内网无效 TLS 证书

FrontLens 默认校验证书。明确的内网测试环境可以显式绕过：

```bash
node dist/cli.js qa \
  --url "$TARGET_URL" \
  --ignore-https-errors \
  --output reports/intranet \
  --sme --json-summary
```

配置文件方式：

```json
{
  "browser": {
    "ignoreHTTPSErrors": true
  }
}
```

该能力适用于任意目标，不绑定 IP、域名或端口，并已贯通：

- `qa`
- `auth save`
- `journey record`
- `matrix`
- `role-matrix`
- `env-compare`
- MCP 对应入口

绕过只用于继续功能测试。报告仍记录 `tlsVerificationBypassed: true`、降低安全可信度并生成证书整改项。正确部署应使用受信任 CA，并确保 SAN 匹配实际域名或 IP。

## Windows 沙箱产物权限

Windows 下新建产物目录会启用父目录 ACL 继承；CLI 结束前递归恢复本轮新建目录的继承权限，并重置 `CodexSandboxOffline` 可能遗留的显式 DACL。

修复旧产物目录：

```powershell
node dist/cli.js permissions repair `
  --output "D:\path\to\generated-output"
```

安全边界：

- 不向 `Everyone` 或本机所有用户授权。
- 不修改目标目录的父级 ACL。
- 拒绝磁盘根、用户 Home、当前源码工作区及祖先、宽泛顶层目录、文件和符号链接。
- 只应传入明确的生成产物目录。

## 登录态与权限矩阵

保存登录态：

```bash
node dist/cli.js auth save \
  --url "$LOGIN_URL" \
  --output .frontlens/auth/admin.json
```

多角色测试：

```bash
node dist/cli.js role-matrix \
  --url "$TARGET_URL" \
  --role admin=.frontlens/auth/admin.json \
  --role viewer=.frontlens/auth/viewer.json \
  --output reports/roles
```

隐藏按钮不能证明权限安全；权限结论必须同时验证服务端/API 拒绝行为。

## 低 Token 使用原则

Agent 默认读取顺序：

1. `test-plan-summary.json`
2. `brief.md`
3. `qa-review.md` 或 `test-report.md`
4. 仅针对失败需求读取对应明细

默认不要把以下大型文件整体放入模型上下文：

- `result.json`
- `network.json`
- `page-model.json`
- `evidence-report.md`
- `test-plan.json`
- `test-execution-report.json`

CLI 的 `--json`、MCP 的 `detail=true` / `includeMarkdown=true` 只在明确需要完整明细时使用。

## 安全与数据原则

- 默认阻止未经授权的 POST/PUT/PATCH/DELETE。
- 不连接或修改生产数据库。
- 写操作必须使用隔离测试数据，并记录 setup、cleanup 和授权范围。
- 自动部署不能通过修改业务源码来“让测试通过”。
- 不停止已有进程，不执行宽泛 Docker/system 清理。
- 只清理本轮明确记录的资源。
- 未执行、跳过或证据不足不得写成通过。

## MCP

启动 MCP Server：

```bash
node dist/cli.js mcp
```

MCP 覆盖 QA、测试计划、测试报告、矩阵、角色、环境对比及结果消费工具，并默认返回 compact response。

## 开发与验证

```bash
npm run check
npm test
npm run build
```

当前回归基线：

- TypeScript 检查通过
- 单元/回归测试 `267/267` 通过
- 构建通过
- 所有仓库 Skills 通过 `quick_validate.py`

## 目录结构

```text
FrontLens/
├── skills/
│   ├── backend-qa/
│   ├── frontend-qa/
│   └── frontend-qa-*/
├── src/                  # CLI、Playwright 取证、计划与报告引擎
├── test/                 # 单元和回归测试
├── docs/                 # 详细操作指南
├── examples/             # 示例 PRD 和应用
└── frontlens.config.example.json
```

详细需求驱动流程参见：[docs/requirement-driven-testing-guide.md](docs/requirement-driven-testing-guide.md)。

## 能力边界

- `backend-qa` 的自动部署由 Agent 根据目标仓库已有机制编排，不是一个假定所有项目启动方式相同的固定部署器。
- 未知技术栈、不可用外部依赖或缺失凭证会输出阻塞证据和下一步，不会伪造测试结果。
- Windows ACL 行为已通过参数和安全边界测试，仍建议在 Windows 真机执行一次集成验证。
