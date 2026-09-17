import { antelopeFmtPreset } from "@antelopejs/tooling-configs/oxc/fmt";

export default antelopeFmtPreset({
  // Drop once tooling-configs ships the shared ignore (AntelopeJS/tooling-configs#5):
  // these are Markdown templates with a .yml extension, which oxfmt cannot parse.
  // CHANGELOG.md is rewritten by release-it/changelogen on every release and
  // never passes through the formatter; keep Markdown out of the check.
  ignorePatterns: [".github/ISSUE_TEMPLATE/**", "**/*.md"],
});
