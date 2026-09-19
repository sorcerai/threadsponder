// Root ESLint flat config (ESLint 9) for threadsponder.
// Covers packages without their own flat config (api, shared, workers).
// packages/dashboard keeps its own eslint.config.js. Kept deliberately
// narrow: eslint:recommended + typescript-eslint recommended (no
// type-aware rules), so it lints hygiene without reformatting the world.

// Note: `globals` is not a root dependency (the lockfile is not writable
// here), so the handful of Node globals we need are declared inline.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

const nodeGlobals = Object.fromEntries(
  [
    'process', '__dirname', '__filename', 'Buffer', 'console',
    'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval',
    'setImmediate', 'clearImmediate', 'queueMicrotask',
    'URL', 'URLSearchParams', 'TextEncoder', 'TextDecoder',
    'fetch', 'crypto', 'AbortController', 'AbortSignal',
    'FormData', 'Headers', 'Request', 'Response',
    'performance', 'structuredClone', 'atob', 'btoa',
  ].map((name) => [name, 'readonly']),
);

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    '**/coverage/**',
    'packages/dashboard/**', // has its own eslint.config.js
    'netlify/**', // deployment glue, outside the packages' lint scripts
    'backfill/**', // historical data dumps, not linted
    'supabase/**', // SQL migrations and generated types
  ]),
  {
    files: ['**/*.{js,jsx,mjs,cjs}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      // `_`-prefixed args are the conventional "intentionally unused" marker
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,tsx,mts,cts}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: nodeGlobals,
    },
    rules: {
      // `_`-prefixed args are the conventional "intentionally unused" marker
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
]);
