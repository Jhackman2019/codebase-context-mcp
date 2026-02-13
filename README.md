# codebase-context-mcp

**MCP server for codebase indexing and search that works on every platform** — including ARM64 devices like Raspberry Pi and Apple Silicon where most alternatives fail.

## The Problem

Popular codebase-indexing MCP servers like `@zilliz/claude-context-mcp` depend on native C++ bindings (`tree-sitter`, `faiss-node`) that ship pre-built binaries only for x86_64. If you're on **ARM64** — a Raspberry Pi, Apple Silicon Mac, AWS Graviton, or any other arm64 host — `npm install` fails with missing prebuilts and no fallback. There's no workaround short of cross-compiling the native modules yourself.

## The Solution

This package replaces every native dependency with a **WASM equivalent**. The tree-sitter parser runs as WebAssembly, search uses a pure-JS BM25 implementation, and the index is stored as plain JSON. Zero native bindings means `npm install` succeeds on the first try on **any** architecture: ARM64, x86_64, macOS, Linux, Windows.

Drop-in compatible — provides the same core tools (index, search, outline, summary) via the standard MCP stdio transport.

## Tools

| Tool | Description |
|---|---|
| `index_codebase` | Parse a directory into symbols/chunks, cache as JSON |
| `search_symbols` | Find functions, classes, types by name or pattern |
| `search_code` | BM25 full-text search across indexed files |
| `get_file_outline` | File structure: functions, classes, imports, exports with line numbers |
| `get_project_summary` | Tech stack, file counts by language, directory structure |

## Supported Languages

TypeScript, TSX, JavaScript, Python, C#, VB.NET, XML, CSS, JSON

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
