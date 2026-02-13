# codebase-context-mcp

ARM64-compatible MCP server for codebase indexing and search. Uses **WASM-based tree-sitter** — no native bindings, works everywhere: ARM64 (Raspberry Pi, Apple Silicon), x86_64, macOS, Linux, Windows.

Built as a drop-in replacement for `@zilliz/claude-context-mcp` which requires native `tree-sitter` and `faiss-node` bindings that lack ARM64 prebuilts.

## Tools

| Tool | Description |
|---|---|
| `index_codebase` | Parse a directory into symbols/chunks, cache as JSON |
| `search_symbols` | Find functions, classes, types by name or pattern |
| `search_code` | BM25 full-text search across indexed files |
| `get_file_outline` | File structure: functions, classes, imports, exports with line numbers |
| `get_project_summary` | Tech stack, file counts by language, directory structure |

## Supported Languages

TypeScript, TSX, JavaScript, Python, CSS, JSON

## Install

### Claude Code (recommended)

```bash
claude mcp add codebase-context -s user -- npx codebase-context-mcp
```

Or from a local clone:

```bash
git clone https://github.com/Jhackman2019/codebase-context-mcp.git
cd codebase-context-mcp
npm install && npm run build
claude mcp add codebase-context -s user -- node /path/to/codebase-context-mcp/dist/index.js
```

### MCP Settings (JSON)

```json
{
  "mcpServers": {
    "codebase-context": {
      "command": "npx",
      "args": ["codebase-context-mcp"]
    }
  }
}
```

## How It Works

- **Parsing:** `web-tree-sitter` (WASM) — same AST quality as native tree-sitter, runs on any architecture
- **Search:** BM25 text ranking (pure JS) + symbol name matching
- **Storage:** JSON file index at `~/.codebase-context-mcp/<project-hash>.json`
- **Transport:** MCP stdio via `@modelcontextprotocol/sdk`
- **Incremental:** Files with unchanged content hash are skipped on re-index

## Safety Limits

| Limit | Value |
|---|---|
| Max files | 20,000 |
| Max file size | 512KB |
| Default ignores | node_modules, .git, dist, build, .venv, binaries, lock files |
| .gitignore | Respected (root level) |

## Development

```bash
npm install
npm run build    # Build with tsup
npm run dev      # Watch mode
npm start        # Run the server
```

## License

MIT
