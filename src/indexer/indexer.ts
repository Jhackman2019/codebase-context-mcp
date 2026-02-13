import { walkDirectory, readFileContent } from '../utils/files.js';
import { getLanguageForFile } from '../parsers/index.js';
import { parseFile, initTreeSitter } from '../parsers/tree-sitter.js';
import {
  ProjectIndex,
  IndexedFile,
  IndexedSymbol,
  loadIndex,
  saveIndex,
  contentHash,
} from './store.js';

/** Build or update the index for a project directory */
export async function indexProject(rootDir: string): Promise<ProjectIndex> {
  await initTreeSitter();

  const existingIndex = await loadIndex(rootDir);
  const files = await walkDirectory(rootDir);

  const indexedFiles: Record<string, IndexedFile> = {};
  let totalSymbols = 0;
  let skipped = 0;
  let parsed = 0;

  for (const file of files) {
    const content = await readFileContent(file.absolutePath);
    if (!content) continue;

    const hash = contentHash(content);
    const langConfig = getLanguageForFile(file.relativePath);
    if (!langConfig) continue;

    // Incremental: skip unchanged files
    const existing = existingIndex?.files[file.relativePath];
    if (existing && existing.hash === hash) {
      indexedFiles[file.relativePath] = existing;
      totalSymbols += existing.symbols.length;
      skipped++;
      continue;
    }

    // Parse the file
    const parseResult = await parseFile(file.relativePath, content);
    if (!parseResult) continue;

    const symbols: IndexedSymbol[] = parseResult.symbols.map((s) => ({
      ...s,
      filePath: file.relativePath,
    }));

    indexedFiles[file.relativePath] = {
      language: langConfig.language,
      hash,
      sizeBytes: file.sizeBytes,
      symbols,
      imports: parseResult.imports,
      exports: parseResult.exports,
    };

    totalSymbols += symbols.length;
    parsed++;
  }

  // Build vocabulary for BM25
  const vocabulary = buildVocabulary(indexedFiles);

  const index: ProjectIndex = {
    rootDir,
    indexedAt: new Date().toISOString(),
    fileCount: Object.keys(indexedFiles).length,
    symbolCount: totalSymbols,
    files: indexedFiles,
    vocabulary,
  };

  await saveIndex(index);

  return index;
}

/** Build term -> document frequency map for BM25 */
function buildVocabulary(files: Record<string, IndexedFile>): Record<string, number> {
  const vocab: Record<string, number> = {};

  for (const [filePath, file] of Object.entries(files)) {
    const terms = new Set<string>();

    // Add symbol names
    for (const sym of file.symbols) {
      for (const token of tokenize(sym.name)) {
        terms.add(token);
      }
      for (const token of tokenize(sym.signature)) {
        terms.add(token);
      }
    }

    // Add file path tokens
    for (const token of tokenize(filePath)) {
      terms.add(token);
    }

    // Count document frequency
    for (const term of terms) {
      vocab[term] = (vocab[term] || 0) + 1;
    }
  }

  return vocab;
}

/** Tokenize text into lowercase terms */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9_$]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1);
}
