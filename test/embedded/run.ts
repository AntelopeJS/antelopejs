import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import {
  createEmbeddedFixture,
  type EmbeddedFixture,
  removeEmbeddedFixture,
} from "../helpers/embedded-fixture";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const CORE_ENTRY = path.join(REPO_ROOT, "dist", "index.js");
const HOST_SCRIPT = path.join(__dirname, "esm-host.mjs");
const EXIT_CODE_ERROR = 1;

async function markProjectAsEsm(fixture: EmbeddedFixture): Promise<void> {
  await fs.writeFile(
    path.join(fixture.projectFolder, "package.json"),
    JSON.stringify(
      { name: "esm-host-app", version: "1.0.0", type: "module", private: true },
      null,
      2,
    ),
  );
}

function runHost(projectFolder: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [HOST_SCRIPT, projectFolder, CORE_ENTRY],
      { stdio: "inherit", cwd: projectFolder },
    );
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? EXIT_CODE_ERROR));
  });
}

async function main(): Promise<void> {
  if (!(await fs.stat(CORE_ENTRY).catch(() => undefined))) {
    throw new Error(`Missing build output at ${CORE_ENTRY}. Run 'pnpm build'.`);
  }

  const fixture = await createEmbeddedFixture();
  try {
    await markProjectAsEsm(fixture);
    const code = await runHost(fixture.projectFolder);
    if (code !== 0) {
      throw new Error(`ESM host exited with code ${code}`);
    }
  } finally {
    await removeEmbeddedFixture(fixture);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(EXIT_CODE_ERROR);
});
