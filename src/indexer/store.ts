import { readFile, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';

export interface IndexedSymbol {
  name: string;
  kind: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature: string;
  parentName?: string;
  docComment?: string;
  bodyPreview: string;
}

export interface IndexedFile {
  language: string;
  hash: string;
  sizeBytes: number;
  symbols: IndexedSymbol[];
  imports: string[];
  exports: string[];
}

export interface ProjectIndex {
  rootDir: string;
  indexedAt: string;
  fileCount: number;
  symbolCount: number;
  files: Record<string, IndexedFile>;
  vocabulary: Record<string, number>; // term -> document frequency
}

const STORE_DIR = path.join(os.homedir(), '.codebase-context-mcp');

function projectHash(rootDir: string): string {
  return crypto.createHash('sha256').update(rootDir).digest('hex').slice(0, 16);
}

function indexPath(rootDir: string): string {
  return path.join(STORE_DIR, `${projectHash(rootDir)}.json`);
}

export async function loadIndex(rootDir: string): Promise<ProjectIndex | null> {
  try {
    const data = await readFile(indexPath(rootDir), 'utf-8');
    return JSON.parse(data) as ProjectIndex;
  } catch {
    return null;
  }
}

export async function saveIndex(index: ProjectIndex): Promise<void> {
  await mkdir(STORE_DIR, { recursive: true });
  await writeFile(indexPath(index.rootDir), JSON.stringify(index, null, 2));
}

/** Compute a content hash for incremental indexing */
export function contentHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}
