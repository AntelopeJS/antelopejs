import { defineConfig } from "oxlint";
import { antelopePreset } from "@antelopejs/tooling-configs/oxc/lint";

export default defineConfig({
  extends: [antelopePreset()],
  ignorePatterns: ["!src/core/build/**", "!src/core/output/**"],
  options: { typeAware: true },
  overrides: [
    {
      files: ["src/cli/commands/**"],
      rules: { "eslint/no-console": "error" },
    },
  ],
});
