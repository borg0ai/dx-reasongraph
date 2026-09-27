import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config({
  files: ["apps/cli/src/**/*.ts", "apps/cli/test/**/*.ts"],
  extends: [js.configs.recommended, ...tseslint.configs.recommended],
  languageOptions: {
    globals: globals.node,
  },
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "no-useless-assignment": "off",
  },
});
