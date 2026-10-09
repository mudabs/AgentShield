import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

const eslintConfig = defineConfig([
  ...tseslint.configs.recommended,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "hardhat.config.ts",
    "scripts/**",
    "test/**",
    "artifacts/**",
    "cache/**",
  ]),
]);

export default eslintConfig;
