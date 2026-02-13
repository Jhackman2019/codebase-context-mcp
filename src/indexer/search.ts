import { ProjectIndex, IndexedSymbol } from './store.js';
import { tokenize } from './indexer.js';
import { readFileContent } from '../utils/files.js';
import path from 'path';

// BM25 parameters
const K1 = 1.2;
const B = 0.75;

interface SearchResult {
  filePath: string;
  score: number;
  matchedLines: { lineNumber: number; content: string }[];
}

interface SymbolSearchResult {
  symbol: IndexedSymbol;
  score: number;
}

/** BM25 full-text search across all indexed files */
export async function searchCode(
  index: ProjectIndex,
  query: string,
  maxResults = 20
): Promise<SearchResult[]> {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0) return [];

  const N = index.fileCount;
  const avgDl = Object.values(index.files).reduce(
    (sum, f) => sum + f.symbols.length + f.imports.length,
    0
  ) / Math.max(N, 1);

  const results: SearchResult[] = [];

  for (const [filePath, file] of Object.entries(index.files)) {
    // Build term frequency map for this document
    const tf: Record<string, number> = {};
    const docText = [
      filePath,
      ...file.symbols.map((s) => `${s.name} ${s.signature} ${s.bodyPreview}`),
      ...file.imports,
      ...file.exports,
    ].join(' ');

    const docTokens = tokenize(docText);
    for (const t of docTokens) {
      tf[t] = (tf[t] || 0) + 1;
    }

    const dl = docTokens.length;
    let score = 0;

    for (const term of queryTerms) {
      const termTf = tf[term] || 0;
      if (termTf === 0) continue;

      const df = index.vocabulary[term] || 0;
      const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
      const tfNorm = (termTf * (K1 + 1)) / (termTf + K1 * (1 - B + B * (dl / avgDl)));
      score += idf * tfNorm;
    }

    if (score > 0) {
      // Find matching lines in the actual file
      const content = await readFileContent(path.join(index.rootDir, filePath));
      const matchedLines: { lineNumber: number; content: string }[] = [];

      if (content) {
        const lines = content.split('\n');
        const queryLower = query.toLowerCase();
        for (let i = 0; i < lines.length; i++) {
          if (lines[i].toLowerCase().includes(queryLower) ||
              queryTerms.some((t) => lines[i].toLowerCase().includes(t))) {
            matchedLines.push({
              lineNumber: i + 1,
              content: lines[i].slice(0, 200),
            });
            if (matchedLines.length >= 5) break;
          }
        }
      }

      results.push({ filePath, score, matchedLines });
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/** Search symbols by name/pattern */
export function searchSymbols(
  index: ProjectIndex,
  query: string,
  kind?: string,
  maxResults = 30
): SymbolSearchResult[] {
  const queryLower = query.toLowerCase();
  const queryTerms = tokenize(query);
  const results: SymbolSearchResult[] = [];

  for (const [filePath, file] of Object.entries(index.files)) {
    for (const symbol of file.symbols) {
      if (kind && symbol.kind !== kind) continue;

      const nameLower = symbol.name.toLowerCase();
      let score = 0;

      // Exact match
      if (nameLower === queryLower) {
        score = 10;
      }
      // Starts with query
      else if (nameLower.startsWith(queryLower)) {
        score = 7;
      }
      // Contains query
      else if (nameLower.includes(queryLower)) {
        score = 5;
      }
      // Token overlap (fuzzy)
      else {
        const nameTokens = tokenize(symbol.name);
        const overlap = queryTerms.filter((t) =>
          nameTokens.some((nt) => nt.includes(t) || t.includes(nt))
        ).length;
        if (overlap > 0) {
          score = (overlap / queryTerms.length) * 3;
        }
      }

      if (score > 0) {
        results.push({ symbol, score });
      }
    }
  }

  return results.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/** Get file outline: symbols, imports, exports */
export function getFileOutline(
  index: ProjectIndex,
  filePath: string
): { symbols: IndexedSymbol[]; imports: string[]; exports: string[] } | null {
  const file = index.files[filePath];
  if (!file) return null;

  return {
    symbols: file.symbols.sort((a, b) => a.startLine - b.startLine),
    imports: file.imports,
    exports: file.exports,
  };
}

/** Get project summary stats */
export function getProjectSummary(index: ProjectIndex): {
  rootDir: string;
  indexedAt: string;
  fileCount: number;
  symbolCount: number;
  languageBreakdown: Record<string, number>;
  topDirectories: { dir: string; fileCount: number }[];
} {
  const languageBreakdown: Record<string, number> = {};
  const dirCounts: Record<string, number> = {};

  for (const [filePath, file] of Object.entries(index.files)) {
    languageBreakdown[file.language] = (languageBreakdown[file.language] || 0) + 1;

    const dir = path.dirname(filePath).split(path.sep)[0] || '.';
    dirCounts[dir] = (dirCounts[dir] || 0) + 1;
  }

  const topDirectories = Object.entries(dirCounts)
    .map(([dir, fileCount]) => ({ dir, fileCount }))
    .sort((a, b) => b.fileCount - a.fileCount)
    .slice(0, 15);

  return {
    rootDir: index.rootDir,
    indexedAt: index.indexedAt,
    fileCount: index.fileCount,
    symbolCount: index.symbolCount,
    languageBreakdown,
    topDirectories,
  };
}
