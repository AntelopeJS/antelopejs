import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { type TestContext, test } from "node:test";

import type { FormalCheck } from "../../verify.config.ts";
import { behaviourChange } from "./behaviour.mts";

type Files = Record<string, string>;

const COVERS = ["src/a.ts", "src/b.ts"];
const FUNCTION = "export function add(a, b) {\n  return a + b;\n}\n";
const OUTPUT = {
  "src/output.ts": "export const FAILURE = 1;\nexport const SUCCESS = 0;\n",
};

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", ...args], { cwd: root, encoding: "utf8" }).trim();
}

function commit(root: string, files: Files): string {
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), content);
  }
  git(root, "add", ".");
  git(root, "commit", "-qm", "fixture");
  return git(root, "rev-parse", "HEAD");
}

function changed(t: TestContext, base: Files, head: Files): boolean {
  const root = mkdtempSync(path.join(tmpdir(), "verify-ajs-emit-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  git(root, "init", "-q");
  const baseSha = commit(root, base);
  const headSha = commit(root, head);
  const check: FormalCheck = { name: "formal-test", covers: COVERS, files: [], command: [], violation: null, passing: null, behaviour: { kind: "emit" } };
  return behaviourChange(check, { baseSha, headSha }, root).changed;
}

function importing(specifiers: string, module = "./output"): string {
  return `import { ${specifiers} } from "${module}";\nexport function code() {\n  return CANCELLED + FAILURE;\n}\n`;
}

await test("a function declaration moved verbatim to another covered file is unchanged", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": FUNCTION, "src/b.ts": "export const label = 'b';\n" },
      {
        "src/a.ts": 'export { add } from "./b";\n',
        "src/b.ts": `export const label = 'b';\n${FUNCTION}`,
      },
    ),
    false,
  );
});

await test("an import that moves with its use to another covered file is unchanged", (t) => {
  const use = importing("CANCELLED, FAILURE");
  assert.equal(
    changed(
      t,
      { ...OUTPUT, "src/a.ts": use, "src/b.ts": "export const label = 1;\n" },
      {
        ...OUTPUT,
        "src/a.ts": 'export { code } from "./b";\n',
        "src/b.ts": `export const label = 1;\n${use}`,
      },
    ),
    false,
  );
});

await test("a comment, a type annotation, parentheses and a reflow are unchanged", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": "const total = [1, 2].reduce((sum, n) => sum + n, 0);\n" },
      {
        "src/a.ts":
          "/** The total. */\nconst total: number = [1, 2].reduce(\n  (sum: number, n: number) => (sum + n),\n  0,\n);\n",
      },
    ),
    false,
  );
});

await test("single quotes against double quotes are unchanged", (t) => {
  assert.equal(
    changed(t, { "src/a.ts": "run('x');\n" }, { "src/a.ts": 'run("x");\n' }),
    false,
  );
});

await test("a body edit is changed", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": FUNCTION },
      { "src/a.ts": FUNCTION.replace("a + b", "a - b") },
    ),
    true,
  );
});

await test("swapping two top-level statements of a covered file is changed", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": "await first();\nawait second();\n" },
      { "src/a.ts": "await second();\nawait first();\n" },
    ),
    true,
  );
});

await test("moving a statement that is not a function declaration to another covered file is changed", (t) => {
  assert.equal(
    changed(
      t,
      {
        "src/a.ts": "const limit = 0;\nrun(limit);\n",
        "src/b.ts": "run(1);\n",
      },
      {
        "src/a.ts": "run(limit);\n",
        "src/b.ts": "const limit = 0;\nrun(1);\n",
      },
    ),
    true,
  );
});

await test("importing a name under an alias that points elsewhere is changed", (t) => {
  assert.equal(
    changed(
      t,
      { ...OUTPUT, "src/a.ts": importing("CANCELLED, FAILURE") },
      { ...OUTPUT, "src/a.ts": importing("FAILURE as CANCELLED, FAILURE") },
    ),
    true,
  );
});

await test("importing a binding from another module is changed", (t) => {
  assert.equal(
    changed(
      t,
      { ...OUTPUT, "src/a.ts": importing("CANCELLED, FAILURE") },
      { ...OUTPUT, "src/a.ts": importing("CANCELLED, FAILURE", "./other") },
    ),
    true,
  );
});

await test("retargeting a re-export is changed", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": 'export { add } from "./one";\n' },
      { "src/a.ts": 'export { add } from "./two";\n' },
    ),
    true,
  );
});

await test("removing a side-effect import is changed", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": 'import "./init";\nrun();\n' },
      { "src/a.ts": "run();\n" },
    ),
    true,
  );
});

await test("swapping two assignments to the same field is changed", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": "target.value = 1;\ntarget.value = 2;\n" },
      { "src/a.ts": "target.value = 2;\ntarget.value = 1;\n" },
    ),
    true,
  );
});

await test("swapping two registrations pushed to the same list is changed", (t) => {
  assert.equal(
    changed(
      t,
      { "src/a.ts": "handlers.push(first);\nhandlers.push(second);\n" },
      { "src/a.ts": "handlers.push(second);\nhandlers.push(first);\n" },
    ),
    true,
  );
});

await test("importing min instead of max under the same alias, both in covered files, is changed", (t) => {
  const use = (name: string) =>
    `import { ${name} as pick } from "./b";\nexport function best() {\n  return pick(1, 2);\n}\n`;
  const lib = {
    "src/b.ts":
      "export function max(a, b) {\n  return a > b ? a : b;\n}\nexport function min(a, b) {\n  return a < b ? a : b;\n}\n",
  };
  assert.equal(
    changed(t, { ...lib, "src/a.ts": use("max") }, { ...lib, "src/a.ts": use("min") }),
    true,
  );
});
