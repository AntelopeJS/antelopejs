import { defineConfig } from "oxlint";
import { antelopePreset } from "@antelopejs/tooling-configs/oxc/lint";

export default defineConfig({
  extends: [antelopePreset()],
  options: { typeAware: true },
  overrides: [
    {
      files: ["src/core/cli/commands/**"],
      rules: { "eslint/no-console": "error" },
    },
  ],
});
