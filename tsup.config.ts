import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node20',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  dts: false,
  noExternal: [],
  // Keep all deps external — they're installed via node_modules
  external: [
    '@modelcontextprotocol/sdk',
    'web-tree-sitter',
    'tree-sitter-wasms',
    'zod',
    'glob',
    'ignore',
  ],
  banner: {
    js: '#!/usr/bin/env node',
  },
});
