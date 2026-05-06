import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/*.config.{js,ts,mjs,cjs}",
      "engine/**",
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,

  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          args: "all",
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { prefer: "type-imports", fixStyle: "separate-type-imports" },
      ],
      "@typescript-eslint/no-import-type-side-effects": "error",
      "@typescript-eslint/explicit-function-return-type": [
        "error",
        { allowExpressions: true, allowTypedFunctionExpressions: true },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/switch-exhaustiveness-check": "error",
      "@typescript-eslint/no-extraneous-class": ["error", { allowStaticOnly: true }],

      // Stub-friendly: stubs declare `constructor(_p: T) {}` and `async fn() { throw }`
      // both as documented future-shape signatures. Re-enable once bodies are filled in
      // if you want them.
      "@typescript-eslint/no-useless-constructor": "off",
      "@typescript-eslint/require-await": "off",

      eqeqeq: ["error", "always", { null: "ignore" }],
      curly: ["error", "all"],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "no-implicit-coercion": "error",
      "no-param-reassign": ["error", { props: true }],
      "object-shorthand": ["error", "always"],
      "prefer-const": ["error", { destructuring: "all" }],
      "prefer-template": "error",
    },
  },

  {
    files: ["**/*.{tsx,jsx}"],
    plugins: { "react-hooks": reactHooks },
    languageOptions: {
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },

  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      "@typescript-eslint/no-non-null-assertion": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
    },
  },
);
