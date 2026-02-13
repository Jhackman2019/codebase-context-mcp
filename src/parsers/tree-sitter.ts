import { Parser, Language } from 'web-tree-sitter';
import type { SyntaxNode } from 'web-tree-sitter';
import path from 'path';
import { fileURLToPath } from 'url';
import { readFile } from 'fs/promises';
import { getLanguageForFile } from './index.js';

let parserReady = false;
const languageCache = new Map<string, Language>();

/** Initialize the tree-sitter WASM runtime (call once) */
export async function initTreeSitter(): Promise<void> {
  if (parserReady) return;

  // Locate tree-sitter.wasm from web-tree-sitter package
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  let wasmPath: string;

  // Try to find it relative to node_modules or in the package itself
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    path.resolve(__dirname, '..', '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
    path.resolve(__dirname, '..', '..', '..', 'node_modules', 'web-tree-sitter', 'tree-sitter.wasm'),
  ];

  wasmPath = candidates[0];
  for (const c of candidates) {
    try {
      await readFile(c);
      wasmPath = c;
      break;
    } catch {
      // try next
    }
  }

  await Parser.init({
    locateFile: () => wasmPath,
  });
  parserReady = true;
}

/** Load a language grammar WASM file */
async function loadLanguage(wasmFile: string): Promise<Language> {
  const cached = languageCache.get(wasmFile);
  if (cached) return cached;

  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(__dirname, '..', 'node_modules', 'tree-sitter-wasms', 'out', wasmFile),
    path.resolve(__dirname, '..', '..', 'node_modules', 'tree-sitter-wasms', 'out', wasmFile),
    path.resolve(__dirname, '..', '..', '..', 'node_modules', 'tree-sitter-wasms', 'out', wasmFile),
  ];

  let wasmPath = candidates[0];
  for (const c of candidates) {
    try {
      await readFile(c);
      wasmPath = c;
      break;
    } catch {
      // try next
    }
  }

  const lang = await Language.load(wasmPath);
  languageCache.set(wasmFile, lang);
  return lang;
}

export interface SymbolInfo {
  name: string;
  kind: string;
  startLine: number;
  endLine: number;
  signature: string;
  parentName?: string;
  docComment?: string;
  bodyPreview: string;
}

export interface ParseResult {
  symbols: SymbolInfo[];
  imports: string[];
  exports: string[];
}

/** Parse a file and extract symbols */
export async function parseFile(filePath: string, content: string): Promise<ParseResult | null> {
  const langConfig = getLanguageForFile(filePath);
  if (!langConfig) return null;

  await initTreeSitter();
  const language = await loadLanguage(langConfig.wasmFile);

  const parser = new Parser();
  parser.setLanguage(language);

  const tree = parser.parse(content);
  const result: ParseResult = { symbols: [], imports: [], exports: [] };

  const lines = content.split('\n');

  extractSymbols(tree.rootNode, result, lines, langConfig.language);
  extractImportsExports(tree.rootNode, result, lines, langConfig.language);

  parser.delete();
  tree.delete();

  return result;
}

function extractSymbols(
  node: SyntaxNode,
  result: ParseResult,
  lines: string[],
  language: string,
  parentName?: string
): void {
  const symbolNodeTypes = getSymbolNodeTypes(language);

  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    const type = child.type;

    if (symbolNodeTypes.has(type)) {
      const sym = extractSymbolInfo(child, lines, language, parentName);
      if (sym) {
        result.symbols.push(sym);
        // Recurse into class/object bodies for nested symbols
        if (type.includes('class') || type === 'object') {
          const body = child.childForFieldName('body');
          if (body) {
            extractSymbols(body, result, lines, language, sym.name);
          }
        }
      }
    } else if (type === 'export_statement' || type === 'decorated_definition') {
      // Look inside export wrappers
      extractSymbols(child, result, lines, language, parentName);
    } else if (type === 'program' || type === 'module') {
      extractSymbols(child, result, lines, language, parentName);
    }
  }
}

function getSymbolNodeTypes(language: string): Set<string> {
  const common = new Set([
    'function_declaration',
    'function_definition',
    'class_declaration',
    'class_definition',
    'method_definition',
    'arrow_function',
    'interface_declaration',
    'type_alias_declaration',
    'enum_declaration',
    'variable_declarator',
  ]);

  if (language === 'python') {
    common.add('decorated_definition');
  }

  return common;
}

function extractSymbolInfo(
  node: SyntaxNode,
  lines: string[],
  language: string,
  parentName?: string
): SymbolInfo | null {
  let name = '';
  let kind = nodeTypeToKind(node.type);

  // Get the name
  const nameNode =
    node.childForFieldName('name') ||
    node.childForFieldName('declarator');

  if (nameNode) {
    name = nameNode.text;
  }

  // For variable declarations with arrow functions, use the variable name
  if (node.type === 'variable_declarator') {
    const valueNode = node.childForFieldName('value');
    if (valueNode && (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression' || valueNode.type === 'function')) {
      kind = 'function';
    } else {
      kind = 'variable';
    }
    const id = node.childForFieldName('name');
    if (id) name = id.text;
  }

  if (!name) return null;

  const startLine = node.startPosition.row + 1;
  const endLine = node.endPosition.row + 1;

  // Build signature from the first line
  const sigLine = lines[startLine - 1]?.trim() || '';
  const signature = sigLine.length > 200 ? sigLine.slice(0, 200) + '...' : sigLine;

  // Get doc comment (line above)
  let docComment: string | undefined;
  const prevSibling = node.previousNamedSibling;
  if (prevSibling && prevSibling.type === 'comment') {
    docComment = prevSibling.text.slice(0, 200);
  }

  // Body preview: first 3 lines
  const bodyLines = lines.slice(startLine - 1, Math.min(startLine + 2, endLine));
  const bodyPreview = bodyLines.join('\n').slice(0, 300);

  return {
    name,
    kind,
    startLine,
    endLine,
    signature,
    parentName,
    docComment,
    bodyPreview,
  };
}

function nodeTypeToKind(type: string): string {
  const map: Record<string, string> = {
    function_declaration: 'function',
    function_definition: 'function',
    method_definition: 'method',
    class_declaration: 'class',
    class_definition: 'class',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'enum',
    arrow_function: 'function',
    variable_declarator: 'variable',
    decorated_definition: 'function',
  };
  return map[type] || 'unknown';
}

function extractImportsExports(
  node: SyntaxNode,
  result: ParseResult,
  lines: string[],
  language: string
): void {
  for (let i = 0; i < node.childCount; i++) {
    const child = node.child(i)!;
    const type = child.type;

    if (type === 'import_statement' || type === 'import_from_statement') {
      result.imports.push(child.text.slice(0, 200));
    } else if (type === 'export_statement' || type === 'export_default_declaration') {
      result.exports.push(child.text.slice(0, 200));
    }
  }
}
