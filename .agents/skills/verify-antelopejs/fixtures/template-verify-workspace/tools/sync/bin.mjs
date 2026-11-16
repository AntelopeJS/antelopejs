#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MANAGED_FILES = {
  ".agents/setup": "#!/bin/sh\n# managed by antelopejs-sync\n",
  ".agents/skills/guardrails/SKILL.md": "# Guardrails\n\nManaged by antelopejs-sync.\n",
};
const SKILL_LINK = /\.agents\/skills\/([\w-]+)\/SKILL\.md/;

const root = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    console.error("antelopejs-sync needs a git repository");
    process.exit(1);
  }
})();

function agentsText() {
  const file = path.join(root, "AGENTS.md");
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  return text
    .split("\n")
    .filter((line) => {
      const link = SKILL_LINK.exec(line);
      return link === null || existsSync(path.join(root, ".agents", "skills", link[1]));
    })
    .join("\n");
}

function expected() {
  return { ...MANAGED_FILES, "AGENTS.md": agentsText() };
}

/**
 * @param {string} name
 * @returns {string | undefined}
 */
function current(name) {
  const file = path.join(root, name);
  return existsSync(file) ? readFileSync(file, "utf8") : undefined;
}

const drift = Object.entries(expected()).filter(([name, content]) => current(name) !== content);

if (process.argv.includes("--check")) {
  for (const [name] of drift) {
    console.log(`Drift: ${name}; run antelopejs-sync`);
  }
  console.log(drift.length === 0 ? "Guardrails are in sync." : `${drift.length} managed file(s) drifted.`);
  process.exit(drift.length === 0 ? 0 : 1);
}

for (const [name, content] of drift) {
  mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  writeFileSync(path.join(root, name), content);
}
console.log("Guardrails are in sync.");
