import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import path from 'path';
import { indexProject } from './indexer/indexer.js';
import { loadIndex } from './indexer/store.js';
import { searchCode, searchSymbols, getFileOutline, getProjectSummary } from './indexer/search.js';
import { getDirectoryStructure } from './utils/files.js';
import type { ProjectIndex } from './indexer/store.js';

// Cache for loaded indexes
const indexCache = new Map<string, ProjectIndex>();

async function getOrLoadIndex(rootDir: string): Promise<ProjectIndex | null> {
  const cached = indexCache.get(rootDir);
  if (cached) return cached;
  const loaded = await loadIndex(rootDir);
  if (loaded) {
    indexCache.set(rootDir, loaded);
  }
  return loaded;
}

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'codebase-context',
    version: '1.0.0',
  });

  // Tool 1: index_codebase
  server.tool(
    'index_codebase',
    'Parse a directory into symbols and chunks, building a searchable index. Supports TypeScript, JavaScript, Python, CSS, JSON.',
    {
      directory: z.string().describe('Absolute path to the project root directory to index'),
    },
    async ({ directory }) => {
      const rootDir = path.resolve(directory);
      try {
        const index = await indexProject(rootDir);
        indexCache.set(rootDir, index);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  success: true,
                  rootDir: index.rootDir,
                  fileCount: index.fileCount,
                  symbolCount: index.symbolCount,
                  indexedAt: index.indexedAt,
                  languages: Object.entries(
                    Object.values(index.files).reduce(
                      (acc, f) => ({ ...acc, [f.language]: (acc[f.language] || 0) + 1 }),
                      {} as Record<string, number>
                    )
                  ).map(([lang, count]) => `${lang}: ${count}`),
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [{ type: 'text', text: `Error indexing: ${error}` }],
          isError: true,
        };
      }
    }
  );

  // Tool 2: search_symbols
  server.tool(
    'search_symbols',
    'Find functions, classes, types, and other symbols by name or pattern in an indexed codebase.',
    {
      directory: z.string().describe('Absolute path to the indexed project'),
      query: z.string().describe('Symbol name or pattern to search for'),
      kind: z
        .enum(['function', 'class', 'method', 'interface', 'type', 'enum', 'variable'])
        .optional()
        .describe('Filter by symbol kind'),
      maxResults: z.number().optional().default(20).describe('Maximum results to return'),
    },
    async ({ directory, query, kind, maxResults }) => {
      const rootDir = path.resolve(directory);
      const index = await getOrLoadIndex(rootDir);
      if (!index) {
        return {
          content: [{ type: 'text', text: 'No index found. Run index_codebase first.' }],
          isError: true,
        };
      }

      const results = searchSymbols(index, query, kind, maxResults);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              results.map((r) => ({
                name: r.symbol.name,
                kind: r.symbol.kind,
                file: r.symbol.filePath,
                lines: `${r.symbol.startLine}-${r.symbol.endLine}`,
                signature: r.symbol.signature,
                parent: r.symbol.parentName || null,
                score: Math.round(r.score * 100) / 100,
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 3: search_code
  server.tool(
    'search_code',
    'BM25 full-text search across all files in an indexed codebase. Returns ranked results with matching lines.',
    {
      directory: z.string().describe('Absolute path to the indexed project'),
      query: z.string().describe('Search query (keywords or code patterns)'),
      maxResults: z.number().optional().default(15).describe('Maximum results to return'),
    },
    async ({ directory, query, maxResults }) => {
      const rootDir = path.resolve(directory);
      const index = await getOrLoadIndex(rootDir);
      if (!index) {
        return {
          content: [{ type: 'text', text: 'No index found. Run index_codebase first.' }],
          isError: true,
        };
      }

      const results = await searchCode(index, query, maxResults);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              results.map((r) => ({
                file: r.filePath,
                score: Math.round(r.score * 100) / 100,
                matchedLines: r.matchedLines,
              })),
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 4: get_file_outline
  server.tool(
    'get_file_outline',
    'Get the structure of a file: functions, classes, imports, exports with line numbers.',
    {
      directory: z.string().describe('Absolute path to the indexed project'),
      filePath: z.string().describe('Relative path to the file within the project'),
    },
    async ({ directory, filePath }) => {
      const rootDir = path.resolve(directory);
      const index = await getOrLoadIndex(rootDir);
      if (!index) {
        return {
          content: [{ type: 'text', text: 'No index found. Run index_codebase first.' }],
          isError: true,
        };
      }

      const outline = getFileOutline(index, filePath);
      if (!outline) {
        return {
          content: [{ type: 'text', text: `File not found in index: ${filePath}` }],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                file: filePath,
                symbols: outline.symbols.map((s) => ({
                  name: s.name,
                  kind: s.kind,
                  lines: `${s.startLine}-${s.endLine}`,
                  signature: s.signature,
                  parent: s.parentName || null,
                })),
                imports: outline.imports,
                exports: outline.exports,
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // Tool 5: get_project_summary
  server.tool(
    'get_project_summary',
    'Get an overview of an indexed project: tech stack, file counts by language, directory structure.',
    {
      directory: z.string().describe('Absolute path to the indexed project'),
    },
    async ({ directory }) => {
      const rootDir = path.resolve(directory);
      const index = await getOrLoadIndex(rootDir);
      if (!index) {
        return {
          content: [{ type: 'text', text: 'No index found. Run index_codebase first.' }],
          isError: true,
        };
      }

      const summary = getProjectSummary(index);
      let dirStructure: string[] = [];
      try {
        dirStructure = await getDirectoryStructure(rootDir);
      } catch {
        // ignore
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                ...summary,
                directoryStructure: dirStructure.slice(0, 50),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  return server;
}
