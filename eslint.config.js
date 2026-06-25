import js from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintPluginVitest from "eslint-plugin-vitest";

export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      vitest: eslintPluginVitest,
    },
    languageOptions: {
      parserOptions: {
        // Avoid TypeScript projectService errors for files excluded from tsconfig.json
        // while still providing type-aware rules where possible.
        projectService: false,
      },
    },
    rules: {
      // Keep the repo noise low; tighten later if desired.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": "warn",
    },
  },
];

