# CI and MCP integration

## GitHub Actions

The repository includes `.github/workflows/frontlens.yml`.

Manual QA run:

1. Open the workflow named `FrontLens QA`.
2. Provide the target URL.
3. Choose browser: `chromium`, `firefox`, or `webkit`.
4. Optionally set `fail_on`, `min_score`, `storage_state`, and `session_storage_state`.
5. Download the `frontlens-report` artifact.

Pull request and push runs validate install/typecheck/build. Manual `workflow_dispatch` additionally installs the selected Playwright browser, runs QA, gates on `--fail-on` / `--min-score`, and uploads the report even when QA fails.

Local equivalent:

```bash
BROWSER=chromium
npm ci
npm run check
npm test
npm run build
npx playwright install --with-deps "$BROWSER"
node dist/cli.js qa \
  --url "https://example.com" \
  --browser "$BROWSER" \
  --output reports/frontlens-gha \
  --no-trace \
  --json \
  --fail-on high \
  --min-score 80
```

Authenticated QA:

```bash
node dist/cli.js qa \
  --url "https://example.com/admin" \
  --storage-state ".frontlens/auth/admin.json" \
  --session-storage-state ".frontlens/auth/admin.json.session-storage.json" \
  --output reports/frontlens-auth \
  --no-trace \
  --json
```

## MCP server

Start the stdio MCP server:

```bash
node dist/cli.js mcp
```

Run it from the FrontLens repo after `npm run build`, or use an absolute path to `dist/cli.js`.

MCP client config example:

```json
{
  "mcpServers": {
    "frontlens": {
      "command": "node",
      "args": ["/abs/path/to/FrontLens/dist/cli.js", "mcp"],
      "cwd": "/abs/path/to/FrontLens"
    }
  }
}
```

Smoke-test the MCP handshake:

```bash
{ printf 'Content-Length: 88\r\n\r\n{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26"}}'; printf 'Content-Length: 46\r\n\r\n{"jsonrpc":"2.0","id":2,"method":"tools/list"}'; } | node dist/cli.js mcp
```

Tools exposed:

- `frontlens_qa`: run QA for a URL and return summary + artifact paths.
- `frontlens_matrix`: run browser compatibility matrix.
- `frontlens_inspect`: summarize an existing `result.json`, including schema version and phase errors.
- `frontlens_issues`: return issues, optionally filtered by severity; pass `full=true` for full Issue objects.
- `frontlens_network`: return all requests plus failed/slow/duplicated/suspicious groups.
- `frontlens_coverage`: return Coverage totals and top unused JS/CSS resources.
- `frontlens_security`: return passive security score, checks, evidence, and security issue suggestions.
- `frontlens_fix_tasks`: return machine-executable fix tasks for downstream repair skills.
- `frontlens_diff`: compare two `result.json` files by stable fingerprints.
- `frontlens_suggestions`: return frontend/backend/product/test suggestions.

`frontlens_qa` and `frontlens_inspect` include `qualityGate` with `status` (`pass`, `pass-with-risks`, `fail`, `blocked`) and `confidence`, plus `requirementCoverage` summary/details; use them as the first machine-readable QA gate before applying source/requirement triage.

`auth save` is intentionally CLI-first because it usually launches a headed browser for manual login.

## CLI wrapper usage pattern

FrontLens is also exposed to other agents/tools through stable CLI and JSON artifacts.

Recommended CLI wrapper command:

```bash
node dist/cli.js qa --url "$URL" --output "$OUTPUT_DIR" --no-trace --json
```

Return these paths to the caller:

- `$OUTPUT_DIR/result.json`
- `$OUTPUT_DIR/report.md`
- `$OUTPUT_DIR/page-model.json`
- `$OUTPUT_DIR/network.json`
- `$OUTPUT_DIR/console.json`

Other skills should consume `result.json`, filter `issues[]`, and rerun FrontLens after applying fixes.

For lighter wrappers, call the helper commands:

```bash
node dist/cli.js inspect --report "$OUTPUT_DIR/result.json"
node dist/cli.js issues --report "$OUTPUT_DIR/result.json" --severity high --full
node dist/cli.js network --report "$OUTPUT_DIR/result.json"
node dist/cli.js coverage --report "$OUTPUT_DIR/result.json"
node dist/cli.js security --report "$OUTPUT_DIR/result.json"
node dist/cli.js fix-tasks --report "$OUTPUT_DIR/result.json"
node dist/cli.js diff --before "$OLD_OUTPUT_DIR/result.json" --after "$OUTPUT_DIR/result.json"
node dist/cli.js suggestions --report "$OUTPUT_DIR/result.json"
```
