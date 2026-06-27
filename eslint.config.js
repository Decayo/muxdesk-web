import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

// Flat config (eslint 9+). Type-unaware recommended (fast); tsc handles the deep type checks.
export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // Match tsc's noUnusedLocals/Parameters semantics: allow _-prefixed + rest-sibling discards (`{ node, ...props }`).
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
      // react-hooks v7 compiler-era rule; too aggressive for our legitimate poll/sync effects (setState in
      // a fetch callback or to clear state on a dep change). exhaustive-deps + rules-of-hooks stay on.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
)
