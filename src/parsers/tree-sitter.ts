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

  // Use regex-based parsers for languages without WASM grammars
  if (!langConfig.wasmFile) {
    if (langConfig.language === 'vb_net') return parseVbNet(content);
    if (langConfig.language === 'xml') return parseXml(content);
    return null;
  }

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
    } else if (type === 'namespace_declaration' || type === 'file_scoped_namespace_declaration') {
      // C#: recurse into namespace body
      const sym = extractSymbolInfo(child, lines, language, parentName);
      if (sym) {
        result.symbols.push(sym);
        const body = child.childForFieldName('body');
        if (body) {
          extractSymbols(body, result, lines, language, sym.name);
        } else {
          // File-scoped namespace: symbols are direct children
          extractSymbols(child, result, lines, language, sym.name);
        }
      }
    } else if (type === 'program' || type === 'module' || type === 'compilation_unit') {
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

  if (language === 'c_sharp') {
    common.add('method_declaration');
    common.add('constructor_declaration');
    common.add('property_declaration');
    common.add('namespace_declaration');
    common.add('struct_declaration');
    common.add('delegate_declaration');
    common.add('event_declaration');
    common.add('field_declaration');
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
    method_declaration: 'method',
    constructor_declaration: 'constructor',
    class_declaration: 'class',
    class_definition: 'class',
    interface_declaration: 'interface',
    type_alias_declaration: 'type',
    enum_declaration: 'enum',
    arrow_function: 'function',
    variable_declarator: 'variable',
    decorated_definition: 'function',
    namespace_declaration: 'namespace',
    struct_declaration: 'struct',
    property_declaration: 'property',
    delegate_declaration: 'delegate',
    event_declaration: 'event',
    field_declaration: 'field',
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

    if (type === 'import_statement' || type === 'import_from_statement' || type === 'using_directive') {
      result.imports.push(child.text.slice(0, 200));
    } else if (type === 'export_statement' || type === 'export_default_declaration') {
      result.exports.push(child.text.slice(0, 200));
    }
  }
}

// ── Regex-based parsers for languages without WASM grammars ──

/** Parse VB.NET source using regex patterns */
function parseVbNet(content: string): ParseResult {
  const result: ParseResult = { symbols: [], imports: [], exports: [] };
  const lines = content.split('\n');

  const patterns: Array<{ regex: RegExp; kind: string }> = [
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?(?:Shared\s+)?(?:Overrides\s+|Overridable\s+|MustOverride\s+|NotOverridable\s+)?(?:Async\s+)?Sub\s+(\w+)/i, kind: 'function' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?(?:Shared\s+)?(?:Overrides\s+|Overridable\s+|MustOverride\s+|NotOverridable\s+)?(?:Async\s+)?Function\s+(\w+)/i, kind: 'function' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?(?:Partial\s+)?(?:MustInherit\s+|NotInheritable\s+)?Class\s+(\w+)/i, kind: 'class' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?Interface\s+(\w+)/i, kind: 'interface' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?(?:Partial\s+)?Module\s+(\w+)/i, kind: 'namespace' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?Structure\s+(\w+)/i, kind: 'struct' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?Enum\s+(\w+)/i, kind: 'enum' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?(?:Shared\s+)?(?:ReadOnly\s+|WriteOnly\s+)?Property\s+(\w+)/i, kind: 'property' },
    { regex: /^\s*Namespace\s+([\w.]+)/i, kind: 'namespace' },
    { regex: /^\s*(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?Delegate\s+(?:Sub|Function)\s+(\w+)/i, kind: 'delegate' },
  ];

  const endPatterns: Record<string, RegExp> = {
    function: /^\s*End\s+(?:Sub|Function)/i,
    class: /^\s*End\s+Class/i,
    interface: /^\s*End\s+Interface/i,
    namespace: /^\s*End\s+(?:Namespace|Module)/i,
    struct: /^\s*End\s+Structure/i,
    enum: /^\s*End\s+Enum/i,
    property: /^\s*End\s+Property/i,
  };

  // Track parent context
  const parentStack: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check imports
    if (/^\s*Imports\s+/i.test(line)) {
      result.imports.push(line.trim().slice(0, 200));
      continue;
    }

    // Check for symbol definitions
    for (const { regex, kind } of patterns) {
      const match = line.match(regex);
      if (match) {
        const name = match[1];
        const startLine = i + 1;

        // Find end line
        let endLine = startLine;
        const endPat = endPatterns[kind];
        if (endPat) {
          for (let j = i + 1; j < lines.length; j++) {
            if (endPat.test(lines[j])) {
              endLine = j + 1;
              break;
            }
          }
        }

        const bodyLines = lines.slice(i, Math.min(i + 3, endLine));
        result.symbols.push({
          name,
          kind,
          startLine,
          endLine,
          signature: line.trim().slice(0, 200),
          parentName: parentStack.length > 0 ? parentStack[parentStack.length - 1] : undefined,
          bodyPreview: bodyLines.join('\n').slice(0, 300),
        });

        if (['class', 'interface', 'namespace', 'struct'].includes(kind)) {
          parentStack.push(name);
        }
        break;
      }
    }

    // Track end statements for parent context
    if (/^\s*End\s+(?:Class|Interface|Namespace|Module|Structure)/i.test(line)) {
      parentStack.pop();
    }
  }

  return result;
}

/** Parse XML source using regex patterns */
function parseXml(content: string): ParseResult {
  const result: ParseResult = { symbols: [], imports: [], exports: [] };
  const lines = content.split('\n');

  // Extract XML declaration
  if (/^\s*<\?xml\s/.test(lines[0] || '')) {
    result.imports.push(lines[0].trim().slice(0, 200));
  }

  // Extract namespace declarations from root element
  const nsRegex = /xmlns(?::(\w+))?="([^"]+)"/g;
  const fullText = content.slice(0, 2000); // Only scan first 2KB for namespaces
  let nsMatch;
  while ((nsMatch = nsRegex.exec(fullText)) !== null) {
    const prefix = nsMatch[1] || '(default)';
    result.imports.push(`xmlns:${prefix}="${nsMatch[2]}"`);
  }

  // Extract top-level and significant elements as symbols
  const elementStack: string[] = [];
  const elementRegex = /^(\s*)<(\w[\w:.]*)((?:\s+[^>]*)?)\s*(?:\/>|>)/;
  const closingRegex = /^(\s*)<\/(\w[\w:.]*)\s*>/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const closeMatch = line.match(closingRegex);
    if (closeMatch) {
      const tag = closeMatch[2];
      if (elementStack.length > 0 && elementStack[elementStack.length - 1] === tag) {
        elementStack.pop();
      }
    }

    const openMatch = line.match(elementRegex);
    if (openMatch) {
      const indent = openMatch[1].length;
      const tag = openMatch[2];
      const attrs = openMatch[3] || '';
      const isSelfClosing = line.includes('/>');

      // Only extract elements at depth <= 2 (root + direct children + grandchildren)
      if (indent <= 8 || elementStack.length <= 2) {
        // Extract meaningful attributes for name
        const nameAttr = attrs.match(/\b(?:name|id|key|type|class)="([^"]+)"/i);
        const symbolName = nameAttr ? `${tag}[${nameAttr[1]}]` : tag;

        // Find end line for non-self-closing elements
        let endLine = i + 1;
        if (!isSelfClosing) {
          const closeTag = new RegExp(`^\\s*</${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*>`);
          for (let j = i + 1; j < lines.length; j++) {
            if (closeTag.test(lines[j])) {
              endLine = j + 1;
              break;
            }
          }
        }

        const bodyLines = lines.slice(i, Math.min(i + 3, endLine));
        result.symbols.push({
          name: symbolName,
          kind: 'element',
          startLine: i + 1,
          endLine,
          signature: line.trim().slice(0, 200),
          parentName: elementStack.length > 0 ? elementStack[elementStack.length - 1] : undefined,
          bodyPreview: bodyLines.join('\n').slice(0, 300),
        });
      }

      if (!isSelfClosing) {
        elementStack.push(tag);
      }
    }
  }

  return result;
}
