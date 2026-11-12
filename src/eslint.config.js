// Lint configuration (development only, not shipped in the extension zip)
import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['extension/**/*.js', 'tests/**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {global: 'readonly', console: 'readonly', print: 'readonly', TextDecoder: 'readonly',
                TextEncoder: 'readonly', ARGV: 'readonly'},
        },
        rules: {
            'no-unused-vars': ['error', {argsIgnorePattern: '^_'}],
            'max-len': ['warn', {code: 120}],
        },
    },
];
