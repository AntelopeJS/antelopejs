import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  ignorePatterns: [
    ".github/ISSUE_TEMPLATE/**",
    "**/*.md",
    "!src/core/build/**",
    "!src/core/output/**",
  ],
});
