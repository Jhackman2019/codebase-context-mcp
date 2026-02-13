# CLAUDE.md — codebase-context-mcp

ARM64-compatible MCP server for codebase indexing and search using WASM-based tree-sitter. Zero native bindings.

- **Repo:** github.com/Jhackman2019/codebase-context-mcp
- **Package:** `codebase-context-mcp` on npm
- **Registry name:** `io.github.jhackman2019/codebase-context-mcp`
- **License:** MIT
- **Author:** Finit Solutions

## Tech Stack

- TypeScript (ESM), tsup bundler, Node 20+
- `web-tree-sitter` (WASM) + `tree-sitter-wasms` (pre-built grammars)
- `@modelcontextprotocol/sdk` (stdio transport)
- BM25 search (pure JS), JSON file index at `~/.codebase-context-mcp/`

## Project Structure

```
src/
  index.ts              # Entry: McpServer + StdioServerTransport
  server.ts             # 5 tool registrations (index, search_symbols, search_code, outline, summary)
  parsers/
    index.ts            # Extension -> language mapping (LANGUAGE_CONFIGS)
    tree-sitter.ts      # WASM init, AST parsing, symbol extraction, VB.NET/XML regex parsers
  indexer/
    indexer.ts           # File walker + incremental indexing pipeline
    store.ts             # JSON read/write to ~/.codebase-context-mcp/
    search.ts            # BM25 scoring + symbol matching + outline/summary
  utils/
    files.ts             # Glob, .gitignore, file filtering, safety limits
```

## Build & Run

```bash
npm install
npm run build          # tsup -> dist/index.js
npm run dev            # Watch mode
npm start              # Run the MCP server (stdio)
```

## Key Patterns

- **tsup.config.ts**: All runtime deps MUST be listed in `external` array — bundling them breaks MCP stdio
- **Language support**: C#/TS/JS/Python/CSS/JSON use tree-sitter WASM; VB.NET and XML use regex parsers (no WASM grammars available)
- **web-tree-sitter imports**: Use named imports `{ Parser, Language }` — NOT default import
- **Incremental indexing**: Files with unchanged SHA-256 hash are skipped on re-index

## Supported Languages

TypeScript, TSX, JavaScript, Python, C#, VB.NET, XML, CSS, JSON

---

## Git & Contribution Rules

**IMPORTANT: Read and follow ALL contribution guidelines for any external repo BEFORE creating commits, branches, PRs, or issues. Violation of community guidelines damages reputation.**

### Our Repo (Jhackman2019/codebase-context-mcp)

- Main branch auto-deploys npm package — treat main as production
- NEVER force push to main
- NEVER commit secrets, tokens, or API keys
- Commit messages: concise, imperative tense, describe the "why"
- Build must pass (`npm run build`) before any commit

### MCP Registry (modelcontextprotocol/registry)

The official MCP Registry does NOT accept server listing PRs — it is a Go codebase for the registry infrastructure itself. To list our server:

1. Publish package to npm with `mcpName` field in package.json
2. Use `mcp-publisher` CLI to authenticate and publish `server.json`
3. Do NOT fork the registry repo or submit PRs to add our server
4. Registry namespace: `io.github.jhackman2019/*` (authenticated via GitHub)
5. Only trusted registries allowed: npm (`registry.npmjs.org`), PyPI, NuGet, Docker Hub, GHCR

### modelcontextprotocol/servers

- **No longer accepts PRs for new server listings** — they redirect to the MCP Registry
- Only accepts bug fixes, usability improvements, and MCP protocol feature demonstrations for existing reference servers
- Do NOT submit our server here

### awesome-mcp-servers (punkpeye/awesome-mcp-servers)

If submitting a PR to this community list:

1. **Fork** the repo, create a descriptive branch (e.g., `add-codebase-context-mcp`)
2. Edit **README.md only** — follow existing format exactly
3. Place entry in the correct **category** in **alphabetical order**
4. One server per line: `- [server-name](url) - Brief description`
5. Keep descriptions concise and accurate
6. Commit message: `Add codebase-context-mcp` (simple, clear)
7. PR title and description should be clear and match the contribution
8. Do NOT modify translated READMEs (README-zh.md, README-ja.md, etc.)

### General External Repo Rules

Before contributing to ANY external/community repository:

1. **READ the CONTRIBUTING.md** — every repo has different rules
2. **READ the README** — check for contribution sections, code of conduct links
3. **Check open issues and PRs** — avoid duplicates, understand current discussions
4. **Check if the repo accepts the type of contribution** you want to make
5. **Fork first** — never assume push access to external repos
6. **One logical change per PR** — don't bundle unrelated changes
7. **Match the repo's style** — formatting, naming, commit message conventions
8. **Be patient** — maintainers are volunteers; don't spam or bump PRs
9. **NEVER force push** to shared branches on external repos
10. **NEVER open issues or PRs that are promotional** — contributions should add genuine value

---

## Publishing Checklist

### npm Publish
```bash
npm run build
npm publish
```

### MCP Registry Publish
```bash
mcp-publisher login github
mcp-publisher publish
```

### Version Bumps
- Update `version` in both `package.json` AND `server.json`
- Rebuild before publishing
