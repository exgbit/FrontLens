# FrontLens

FrontLens 是一个面向 AI Agent 和前端团队的自动化前端 QA 分析工具，基于 Playwright 对线上页面、本地开发页或预览构建产物进行端到端扫描，并生成可读的 Markdown 报告与可被其他工具消费的 `result.json`。

它的目标不是只给出一个简单分数，而是把浏览器证据、Network/Console/API/性能/安全/可访问性/响应式结果组织成可复盘、可定位、可修复的问题清单。

## 主要能力

- **页面基础扫描**：页面加载、截图、DOM 快照、页面模型、组件/表单/表格/按钮识别。
- **Network / API 分析**：失败请求、慢请求、重复请求、可疑请求、接口契约推断。
- **前后端一致性检查**：API 响应、页面状态、空态/错误态/加载态等联动问题。
- **Console / Page Error 检测**：采集运行时错误、浏览器错误和页面异常。
- **异常模拟**：模拟 API 500/404/401/403/timeout、断网、刷新等场景，检查用户可见反馈。
- **可访问性检查**：识别缺少 accessible name、表单 label、触控目标等问题。
- **响应式检查**：多视口截图、横向溢出、裁剪元素、移动端交互风险。
- **性能与资源分析**：Performance 指标、资源体积、Coverage 未使用 JS/CSS、P2 预算检查。
- **被动安全扫描**：安全响应头、Cookie、敏感信息、混合内容、第三方资源、API 泄露等检查。
- **Realtime 捕获**：GraphQL、WebSocket、SSE 连接与错误采集。
- **用户旅程与安全交互**：默认非破坏 smoke journey，支持安全策略下的交互探索。
- **报告对比**：对比两次 `result.json`，识别新增、修复、持续存在的问题。
- **Fix Tasks**：生成机器可执行/可交给后续修复工具消费的修复任务。
- **MCP Server**：可作为 MCP 工具被其他 Agent 调用。

## 环境要求

- Node.js >= 20
- npm
- Playwright Chromium（缺失时可通过 `npx playwright install chromium` 安装）

## 安装依赖

```bash
npm install
```

## 构建与验证

```bash
npm run build
npm run check
npm test
```

## 快速开始

分析一个页面：

```bash
node dist/cli.js qa \
  --url "https://example.com/admin/users" \
  --output "reports/frontlens/users" \
  --no-trace \
  --json
```

也可以使用 npm 脚本运行源码版：

```bash
npm run qa -- --url "https://example.com" --output "reports/frontlens/example"
```

生成结果通常包含：

- `report.md`：人类可读报告
- `result.json`：机器可读结果
- `network.json`：网络请求记录
- `coverage.json`：Coverage 结果
- `security.json`：安全扫描结果
- `p2.json`：P2 视觉/预算/弱网结果
- `screenshots/`：页面和响应式截图

## 常用命令

### 运行 QA

```bash
node dist/cli.js qa --url "https://example.com" --output "reports/frontlens/example"
```

### 指定浏览器

```bash
node dist/cli.js qa --url "https://example.com" --browser chromium
node dist/cli.js qa --url "https://example.com" --browser firefox
node dist/cli.js qa --url "https://example.com" --browser webkit
```

### 调试模式

```bash
node dist/cli.js qa --url "https://example.com" --headed --trace --video
```

### 使用登录态

先保存登录态：

```bash
node dist/cli.js auth save \
  --url "https://example.com/login" \
  --output ".frontlens/auth/admin.json"
```

再带登录态分析页面：

```bash
node dist/cli.js qa \
  --url "https://example.com/admin" \
  --storage-state ".frontlens/auth/admin.json" \
  --output "reports/frontlens/admin-auth"
```

### 多浏览器兼容性矩阵

```bash
node dist/cli.js matrix \
  --url "https://example.com" \
  --browsers chromium,firefox,webkit \
  --output "reports/frontlens/compat"
```

### 质量门禁

```bash
node dist/cli.js qa \
  --url "https://example.com" \
  --output "reports/frontlens/ci" \
  --fail-on high \
  --min-score 80 \
  --json
```

当存在指定严重级别及以上的问题，或分数低于阈值时，命令会以非 0 状态退出，适合 CI 使用。

## 查看已有报告

查看摘要：

```bash
node dist/cli.js inspect --report "reports/frontlens/users/result.json"
```

查看高危及以上问题：

```bash
node dist/cli.js issues --report "reports/frontlens/users/result.json" --severity high
```

查看完整问题对象：

```bash
node dist/cli.js issues --report "reports/frontlens/users/result.json" --severity high --full
```

查看网络、Coverage、安全和修复任务：

```bash
node dist/cli.js network --report "reports/frontlens/users/result.json"
node dist/cli.js coverage --report "reports/frontlens/users/result.json"
node dist/cli.js security --report "reports/frontlens/users/result.json"
node dist/cli.js fix-tasks --report "reports/frontlens/users/result.json"
node dist/cli.js suggestions --report "reports/frontlens/users/result.json"
```

对比两次报告：

```bash
node dist/cli.js diff \
  --before "reports/frontlens/old/result.json" \
  --after "reports/frontlens/new/result.json" \
  --output "reports/frontlens/diff"
```

## 模块开关

默认 QA 会开启安全非破坏的完整扫描，包括 security、contract、realtime、journeys、exception、AI heuristic、coverage、P2 等模块。

可按需关闭：

```bash
node dist/cli.js qa --url "https://example.com" --no-security
node dist/cli.js qa --url "https://example.com" --no-contract
node dist/cli.js qa --url "https://example.com" --no-realtime
node dist/cli.js qa --url "https://example.com" --no-p2
node dist/cli.js qa --url "https://example.com" --no-journeys
node dist/cli.js qa --url "https://example.com" --no-exceptions
node dist/cli.js qa --url "https://example.com" --no-ai
node dist/cli.js qa --url "https://example.com" --no-coverage
```

## 安全策略

FrontLens 默认采用非破坏策略：

- 默认阻断 `POST` / `PUT` / `PATCH` / `DELETE` 等可能产生副作用的请求。
- 默认不执行真实新增、编辑、删除、上传、下载/导出等危险动作。
- 被阻断的写请求会作为潜在副作用证据记录，而不是误判为后端失败。
- 只有在明确授权的测试环境中，才建议使用：

```bash
node dist/cli.js qa --url "https://example.com" --allow-mutating-requests
```

## 配置文件

可以通过 `--config` 传入 JSON / JS / MJS 配置文件：

```bash
node dist/cli.js qa \
  --url "https://example.com" \
  --config "frontlens.config.example.json" \
  --output "reports/frontlens/configured"
```

示例配置见：

```text
frontlens.config.example.json
```

## MCP Server

启动 MCP server：

```bash
node dist/cli.js mcp
```

暴露的 MCP 工具包括：

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

## Codex Skill

仓库内包含 `frontend-qa` skill：

```text
skills/frontend-qa/
```

该 skill 用于在 Codex/Agent 场景中规范化 FrontLens 使用流程，包括模块选择、独立 subagent 运行、源码关联复核、误报降噪、根因合并和最终 Markdown 摘要输出。

## 推荐工作流

1. 对目标页面运行 FrontLens QA。
2. 阅读 `report.md` 和 `result.json`。
3. 对 raw issues 做二次校准：区分真实前端问题、后端/API 问题、部署安全项、产品决策和工具误报。
4. 结合源码定位 file:line 证据。
5. 按根因合并问题，不直接把 raw issue 数量当工作量。
6. 修复后重新运行 QA，并用 `diff` 对比前后结果。

## 作者

果比AI guobi.ai
