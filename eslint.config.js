import js from "@eslint/js";
import tseslint from "typescript-eslint";
import astro from "eslint-plugin-astro";
import jsxA11y from "eslint-plugin-jsx-a11y";
import globals from "globals";

/**
 * ESLint flat config。
 * ESLint 10 系は eslint-plugin-jsx-a11y の peer が未対応のため、9 系で揃えている。
 */
export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".astro/**",
      "node_modules/**",
      "docs/**",
      ".references/**",
      "playwright-report/**",
      "test-results/**",
      "coverage/**",
      // 前工程の資料管理スクリプト。Node 素の .mjs で、サイトとは別系統。
      "scripts/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...astro.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always"],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "inline-type-imports" },
      ],
      // Solver の内部状態は意図的に unknown で受ける設計なので any だけ禁止する。
      "@typescript-eslint/no-explicit-any": "error",
    },
  },

  {
    files: ["**/*.tsx"],
    plugins: { "jsx-a11y": jsxA11y },
    rules: {
      ...jsxA11y.configs.recommended.rules,
    },
  },

  {
    files: ["**/*.astro"],
    rules: {
      // .astro のフロントマターは Node 側で動くため
      "no-console": "off",
    },
  },

  {
    files: ["tests/**/*.ts", "**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
    },
  },
);
