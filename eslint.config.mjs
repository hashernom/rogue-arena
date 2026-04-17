import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsParser from '@typescript-eslint/parser';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** @type {import('eslint').Linter.Config[]} */
export default [
  {
    ignores: ['**/dist/**', '**/node_modules/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        project: [
          join(__dirname, 'tsconfig.base.json'),
          join(__dirname, 'client/tsconfig.json'),
          join(__dirname, 'server/tsconfig.json'),
          join(__dirname, 'shared/tsconfig.json'),
        ],
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      prettier: prettierPlugin,
    },
    rules: {
      // Reglas TypeScript strict
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      
      // Reglas generales de ESLint
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'prefer-const': 'error',
      'no-var': 'error',
      'eqeqeq': ['error', 'always'],
      'no-unused-vars': 'off', // Usamos la versión de TypeScript
      
      // Integración con Prettier
      'prettier/prettier': 'error',
    },
  },
  {
    files: ['client/src/**/*.ts', 'client/src/**/*.tsx'],
    rules: {
      'no-console': 'warn',
    },
  },
  {
    files: ['server/src/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  prettierConfig,
];