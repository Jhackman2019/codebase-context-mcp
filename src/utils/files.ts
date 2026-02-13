import { readFile, stat } from 'fs/promises';
import path from 'path';
import ignore, { Ignore } from 'ignore';
import { glob } from 'glob';
import { getSupportedExtensions } from '../parsers/index.js';

const DEFAULT_IGNORE = [
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  'coverage',
  '.nyc_output',
  '.turbo',
  '.cache',
  '.parcel-cache',
  'vendor',
  'target',
  '.idea',
  '.vscode',
  '.DS_Store',
  'Thumbs.db',
  '*.lock',
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.bundle.*',
  '*.chunk.*',
  '*.pyc',
  '*.pyo',
  '*.so',
  '*.dylib',
  '*.dll',
  '*.exe',
  '*.bin',
  '*.wasm',
  '*.png',
  '*.jpg',
  '*.jpeg',
  '*.gif',
  '*.svg',
  '*.ico',
  '*.woff',
  '*.woff2',
  '*.ttf',
  '*.eot',
  '*.mp3',
  '*.mp4',
  '*.pdf',
  '*.zip',
  '*.tar',
  '*.gz',
];

const MAX_FILES = 20_000;
const MAX_FILE_SIZE = 512 * 1024; // 512KB

export interface FileEntry {
  relativePath: string;
  absolutePath: string;
  sizeBytes: number;
}

/** Load .gitignore from project root if exists */
async function loadGitignore(rootDir: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORE);

  try {
    const gitignorePath = path.join(rootDir, '.gitignore');
    const content = await readFile(gitignorePath, 'utf-8');
    ig.add(content);
  } catch {
    // No .gitignore — use defaults only
  }

  return ig;
}

/** Walk a directory and return all parseable files */
export async function walkDirectory(rootDir: string): Promise<FileEntry[]> {
  const ig = await loadGitignore(rootDir);
  const extensions = getSupportedExtensions();
  const extPattern = extensions.map((e) => e.slice(1)).join(',');

  const matches = await glob(`**/*.{${extPattern}}`, {
    cwd: rootDir,
    nodir: true,
    dot: false,
    absolute: false,
  });

  const entries: FileEntry[] = [];

  for (const relPath of matches) {
    if (entries.length >= MAX_FILES) break;

    // Check gitignore
    if (ig.ignores(relPath)) continue;

    const absPath = path.join(rootDir, relPath);
    try {
      const info = await stat(absPath);
      if (info.size > MAX_FILE_SIZE) continue;
      if (!info.isFile()) continue;

      entries.push({
        relativePath: relPath,
        absolutePath: absPath,
        sizeBytes: info.size,
      });
    } catch {
      // Skip files we can't stat
    }
  }

  return entries;
}

/** Read file content as UTF-8, returns null on error */
export async function readFileContent(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf-8');
  } catch {
    return null;
  }
}

/** Get directory structure (top 2 levels) */
export async function getDirectoryStructure(rootDir: string): Promise<string[]> {
  const ig = await loadGitignore(rootDir);
  const matches = await glob('*/**', {
    cwd: rootDir,
    nodir: false,
    dot: false,
    absolute: false,
    maxDepth: 2,
  });

  return matches.filter((p) => !ig.ignores(p)).sort().slice(0, 200);
}
