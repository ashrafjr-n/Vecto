import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // '.vite' is Vite's local dep pre-bundle cache — generated, not project code.
  // Without it `npm run lint` reported 448 errors from bundled vendor files and
  // was useless as a gate, so the real signal had to be run by hand.
  globalIgnores(['dist', '.vite']),
  {
    // .mjs included: the tests/ suite was matched by no config block at all and
    // was therefore never linted.
    files: ['**/*.{js,jsx,mjs}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // The suite runs in plain Node (process.exit, console) — browser globals alone
  // would flag every one of those as undefined.
  {
    files: ['tests/**/*.mjs'],
    languageOptions: { globals: globals.node },
  },
])
