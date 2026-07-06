# FrontLens module selection

Use this reference before every target-page QA run to ask the user which modules to enable and to translate the selection into CLI flags/config.

## Selection rules

- Ask before running QA unless the user already selected modules or said `全选`, `all`, or `default`.
- Keep core safe scan mandatory: page load, screenshot/DOM snapshot, page model, Console/Network collection, safe interaction discovery, reports, issue fingerprints, fixTasks, and mutating request blocking.
- Run target-page QA only in a fresh worker subagent (`fork_context=false`). The main session coordinates selection and returns the worker's Markdown summary.
- If a module has a direct `--no-*` flag, use that flag when disabled. If not, create a per-run config JSON and pass `--config`.

## User-facing checklist

Show this checklist in Chinese unless the user requested another language:

```text
请选择本次要启用的 FrontLens 分析模块（默认建议全选安全非破坏）：
1. API / Network / Contract / 前后端一致性
2. Security 被动安全扫描
3. Performance / Coverage / P2 视觉+预算+弱网
4. Accessibility / Responsive / SEO
5. User journeys 用户旅程
6. Exception simulation 异常模拟
7. Realtime GraphQL / WebSocket / SSE
8. AI 综合分析
9. Browser matrix 多浏览器兼容性

回复：全选，或回复编号/模块名，例如：1,2,3,4,8。
```

If the user selects module 4, ask whether SEO should be included only when SEO matters; otherwise keep `analysis.seo=false` because SEO is optional for authenticated/admin pages.

## Default/full selection

For `全选/all/default`, use:

```bash
node dist/cli.js qa --url "<URL>" --output "<OUTPUT_DIR>" --no-trace --json
```

This default enables security, contract, realtime, safe smoke journey, exception simulation, heuristic AI, coverage, P2 visual capture, P2 budgets, P2 offline + slow-3g profiles, accessibility, responsive, performance, resource, integration, Console, Network, reports, and fixTasks. It keeps destructive actions disabled.

Use browser matrix only when the user selected module 9 or explicitly asked compatibility:

```bash
node dist/cli.js matrix --url "<URL>" --browsers chromium,firefox,webkit --output "<OUTPUT_DIR>-matrix" --no-trace --json
```

## Module-to-config mapping

Start from the default config and disable only unselected modules.

| Module | Enabled by | Disable with |
| --- | --- | --- |
| API / Network / Contract / consistency | `analysis.network=true`, `analysis.integration=true`, `contract.enabled=true` | config: set `analysis.integration=false`, `contract.enabled=false`; keep Network collection for evidence |
| Security passive scan | `security.enabled=true` | `--no-security` or config `security.enabled=false` |
| Performance / Coverage / P2 | `analysis.performance=true`, `analysis.resource=true`, `analysis.coverage=true`, `p2.enabled=true` | `--no-coverage --no-p2` and config `analysis.performance=false`, `analysis.resource=false` |
| Accessibility / Responsive / SEO | `analysis.accessibility=true`, `analysis.responsive=true`, optional `analysis.seo=true` | config booleans false; keep `analysis.seo=false` unless selected |
| User journeys | `journeys.enabled=true` safe smoke journey | `--no-journeys` or config `journeys.enabled=false` |
| Exception simulation | `exception.enabled=true` | `--no-exceptions` or config `exception.enabled=false` |
| Realtime | `realtime.enabled=true` | `--no-realtime` or config `realtime.enabled=false` |
| AI comprehensive analysis | `analysis.ai=true` | `--no-ai` or config `analysis.ai=false` |
| Browser matrix | separate `matrix` command | omit matrix command |

## Per-run config template

When the user deselects modules without direct CLI flags, create `<OUTPUT_DIR>/frontlens.modules.json`:

```json
{
  "analysis": {
    "network": true,
    "console": true,
    "resource": true,
    "coverage": true,
    "accessibility": true,
    "seo": false,
    "performance": true,
    "integration": true,
    "responsive": true,
    "ai": true
  },
  "security": { "enabled": true },
  "journeys": { "enabled": true },
  "contract": { "enabled": true },
  "realtime": { "enabled": true },
  "p2": {
    "enabled": true,
    "visual": { "enabled": true },
    "budgets": { "enabled": true },
    "networkProfiles": { "enabled": true, "profiles": ["offline", "slow-3g"] }
  },
  "exception": { "enabled": true }
}
```

Then run:

```bash
node dist/cli.js qa --url "<URL>" --output "<OUTPUT_DIR>" --config "<OUTPUT_DIR>/frontlens.modules.json" --no-trace --json
```

## Worker subagent prompt template

Use a fresh worker prompt like:

```text
使用 /Users/justin/code/FrontLens 的 FrontLens 框架分析 <URL>。
已选择模块：<MODULE_LIST>。
输出目录：<OUTPUT_DIR>。
前端源码路径：<SOURCE_ROOT 或 未提供>。
本地部署/预览 URL：<DEPLOY_URL 或 与目标 URL 相同>。
保持默认非破坏安全策略，不开启新增/编辑/删除/上传/真实提交，不使用 --allow-mutating-requests。
如果提供了源码路径或存在已知项目映射，必须读取 skills/frontend-qa/references/source-code-correlation.md，并做源码关联复核。
如果需要部署/刷新本地页面：先在源码目录检查 package.json；页面不可达或用户要求部署时，按 source-code-correlation.md 自动安装缺失依赖、构建、启动 Vite dev/preview 服务；服务可达后再运行 FrontLens。不要修改业务代码。
先运行 npm run build，再按模块选择生成配置并执行 QA 命令。
如果 Chromium 或私网访问被沙箱限制，使用 escalated 执行；仍失败则输出诊断。
读取 report.md/result.json，并按 skills/frontend-qa/references/triage-guidelines.md 做二次校准。若有源码路径，逐项核对相关 router/view/composable/store/api/component/vite/ADR 文件，为每个保留的前端问题给出 file:line 证据；对误报给出被源码、部署归属、异常模拟或扫描阶段反驳的理由。降级 dev/synthetic raw issue 后仍要继续做源码归因；若源码或 dev 模块图揭示真实设计缺陷（如路由静态导入导致非当前页面代码进入首屏），必须以 source-discovered/frontend fix 单独保留。
必须按“实现根因”合并 raw issue：同一视图/组件/组合函数导致的 500/401/403/404/timeout 无反馈，只作为一个可执行前端修复输出，并列出支持它的 raw issue / EX-*；不要把 raw issue 数量或 fixTasks 数量当成工作量。若报告建议与问题类别不匹配（例如触控尺寸却建议表格分页接口），标记为模板噪音并改写建议。
返回 Markdown 摘要：页面信息、部署/服务动作、原始分数、调整后风险判断、问题计数（raw issue 与根因计数分开）、已启用模块、triage 分桶（真实前端 / 后端API / 部署安全 / 产品决策 / 误报或工具局限）、源码关联复核表、根因合并表、核心问题、前端问题、后端/API问题、安全问题、性能/P2、用户旅程（特别标注 skipped 覆盖缺口）、异常模拟、AI结论、证据路径、修改建议和复测命令。
不要修改业务代码。
```
