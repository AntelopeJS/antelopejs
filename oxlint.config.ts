import { defineConfig } from "oxlint";
import { antelopePreset } from "@antelopejs/tooling-configs/oxc/lint";

export default defineConfig({
  extends: [antelopePreset()],
  /** `.claude/skills` only links to the skills authored in `.agents/skills`, which stay linted. */
  ignorePatterns: [".claude/skills/**"],
  options: { typeAware: true },
  overrides: [
    {
      files: ["src/cli/commands/**"],
      rules: { "eslint/no-console": "error" },
    },
  ],
});
