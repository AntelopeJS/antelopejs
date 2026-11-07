import { constants, cpSync, existsSync, lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { exists, equal, exitIs } from "./checks.mts";
import { runJourney, type Journey, type JourneyContext } from "./journey.mts";
import { alive } from "./lifecycle.mts";
import { FIXTURE_MODULE, initProject, listModules, useOfflineManifest } from "./project.mts";
import type { RunState } from "./run.mts";

/** The evidence feature and journey of the one real `ajs project init` that other journeys copy. */
export const SHARED_INIT = { feature: "shared", journey: "project-init" } as const;

const PROJECT_NAME = "app";
const LOCK_WAIT_MS = 300_000;
const LOCK_POLL_MS = 250;

const sharedInit: Journey = {
  id: SHARED_INIT.journey,
  title: "the one real project init every other journey copies",
  entryPoint: "ajs project init app --template verify-http --pm pnpm --no-git-init",
  async run(context) {
    await initProject(context, PROJECT_NAME);
  },
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ownerIsGone(lock: string): boolean {
  try {
    return !alive(Number(readFileSync(lock, "utf8")));
  } catch {
    return false;
  }
}

async function withLock(lock: string, work: () => Promise<void>): Promise<void> {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      writeFileSync(lock, String(process.pid), { flag: "wx" });
      break;
    } catch (failure) {
      if (!(failure instanceof Error && "code" in failure && failure.code === "EEXIST")) {
        throw failure;
      }
      if (ownerIsGone(lock)) {
        rmSync(lock, { force: true });
      } else if (Date.now() > deadline) {
        throw new Error(`Another process held ${lock} for ${LOCK_WAIT_MS} ms: remove it if no verify-ajs journey is running.`);
      } else {
        await sleep(LOCK_POLL_MS);
      }
    }
  }
  try {
    await work();
  } finally {
    rmSync(lock, { force: true });
  }
}

/**
 * Runs the one real `ajs project init` of a run, as the journey `shared/project-init`
 * with its own HOME and evidence, unless an earlier journey already did. Returns the
 * project folder. A second `verify-ajs journey` process waits for the first.
 */
export async function sharedProject(state: RunState): Promise<string> {
  const ready = path.join(state.dir, "shared-project.ready");
  if (!existsSync(ready)) {
    await withLock(path.join(state.dir, "shared-project.lock"), async () => {
      if (existsSync(ready)) {
        return;
      }
      const result = await runJourney(state, SHARED_INIT.feature, sharedInit);
      if (result.status !== "PASS") {
        throw new Error(`The shared project init failed, see evidence/${result.folder}/result.json`);
      }
      writeFileSync(ready, `${result.folder}\n`);
    });
  }
  return path.join(state.work, SHARED_INIT.feature, SHARED_INIT.journey, PROJECT_NAME);
}

/**
 * Copies a project folder so that the copy stands alone: relative links stay relative,
 * timestamps stay (a built `dist` stays newer than its `src`), and the package-manager
 * shims in `node_modules/.bin`, which hold the source's absolute path, point at the copy.
 */
export function copyProject(source: string, target: string): void {
  cpSync(source, target, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, mode: constants.COPYFILE_FICLONE });
  const bin = path.join(target, "node_modules", ".bin");
  if (!existsSync(bin)) {
    return;
  }
  for (const name of readdirSync(bin)) {
    const shim = path.join(bin, name);
    if (lstatSync(shim).isFile()) {
      writeFileSync(shim, readFileSync(shim, "utf8").replaceAll(source, target));
    }
  }
}

/**
 * Gives a journey the fixture project that `initProject` would create, from the run's
 * shared init: the journey's HOME gets the offline manifest, the project is copied into
 * its work folder, and a module list reads the project back. A step names the evidence
 * of the init the copy comes from. Journeys that test `ajs project init` use `initProject`.
 */
export async function useProject(context: JourneyContext): Promise<string> {
  const source = await sharedProject(context.state);
  await useOfflineManifest(context);
  const project = path.join(context.work, PROJECT_NAME);
  copyProject(source, project);
  const note = context.note(
    "project copied from the shared init",
    `copied ${source}\nto ${project}\nthe real ajs project init ran once for this run: evidence/${SHARED_INIT.feature}/${SHARED_INIT.journey}/`,
  );
  context.expect(note, [exists(path.join(project, "antelope.config.ts")), exists(path.join(project, "dist", "index.js"))], { critical: true });
  context.tree("tree after copy", project);
  const listed = await listModules(context, project);
  context.expect(listed.folder, [exitIs(listed, 0), equal("modules read back", listed.names, [FIXTURE_MODULE])], { critical: true });
  return project;
}
