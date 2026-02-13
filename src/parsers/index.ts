/** Extension-to-language mapping for tree-sitter grammars */

export interface LanguageConfig {
  language: string;
  wasmFile: string;
  extensions: string[];
}

export const LANGUAGE_CONFIGS: LanguageConfig[] = [
  {
    language: 'typescript',
    wasmFile: 'tree-sitter-typescript.wasm',
    extensions: ['.ts', '.mts', '.cts'],
  },
  {
    language: 'tsx',
    wasmFile: 'tree-sitter-tsx.wasm',
    extensions: ['.tsx'],
  },
  {
    language: 'javascript',
    wasmFile: 'tree-sitter-javascript.wasm',
    extensions: ['.js', '.mjs', '.cjs', '.jsx'],
  },
  {
    language: 'python',
    wasmFile: 'tree-sitter-python.wasm',
    extensions: ['.py', '.pyw'],
  },
  {
    language: 'css',
    wasmFile: 'tree-sitter-css.wasm',
    extensions: ['.css'],
  },
  {
    language: 'json',
    wasmFile: 'tree-sitter-json.wasm',
    extensions: ['.json'],
  },
];

const extensionMap = new Map<string, LanguageConfig>();
for (const config of LANGUAGE_CONFIGS) {
  for (const ext of config.extensions) {
    extensionMap.set(ext, config);
  }
}

export function getLanguageForFile(filePath: string): LanguageConfig | undefined {
  const ext = '.' + filePath.split('.').pop()?.toLowerCase();
  return extensionMap.get(ext);
}

export function getSupportedExtensions(): string[] {
  return LANGUAGE_CONFIGS.flatMap((c) => c.extensions);
}
