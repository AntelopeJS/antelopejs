import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  // Drop once tooling-configs ships the shared ignore (AntelopeJS/tooling-configs#5):
  // these are Markdown templates with a .yml extension, which oxfmt cannot parse.
  ignorePatterns: [".github/ISSUE_TEMPLATE/**"],
});
