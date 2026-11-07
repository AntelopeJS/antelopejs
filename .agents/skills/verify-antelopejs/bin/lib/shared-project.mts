import { constants, cpSync, existsSync, lstatSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { exists, equal, exitIs } from "./checks.mts";
import { withLock } from "./file-lock.mts";
import { runJourney, type Journey, type JourneyContext, type JourneyResult } from "./journey.mts";
import { FIXTURE_MODULE, initProject, listModules, useOfflineManifest } from "./project.mts";
import type { RunState } from "./run.mts";

/** The evidence feature and journey of the one real `ajs project init` that other journeys copy. */
export const SHARED_INIT = { feature: "shared", journey: "project-init" } as const;

const PROJECT_NAME = "app";
const FAILURE_EVIDENCE = `evidence/${SHARED_INIT.feature}/${SHARED_INIT.journey}/result.json`;

const sharedInit: Journey = {
  id: SHARED_INIT.journey,
  title: "the one real project init every other journey copies",
  entryPoint: "ajs project init app --template verify-http --pm pnpm --no-git-init",
  async run(context) {
    await initProject(context, PROJECT_NAME);
  },
};

/**
 * Runs `attempt` once per run directory, however many processes ask. It writes `shared-project.ready` when the
 * attempt passes and `shared-project.failed` when it does not. A failed attempt stays failed: later callers
 * throw at once without running `attempt`, so the evidence the failure names is never replaced. A crashed
 * attempt leaves neither marker and the next caller runs it again. A second process waits for the first.
 */
export async function settleOnce(dir: string, attempt: () => Promise<Pick<JourneyResult, "status">>): Promise<void> {
  const ready = path.join(dir, "shared-project.ready");
  const failed = path.join(dir, "shared-project.failed");
  const failure = () => new Error(`The shared project init failed and stays failed for this run, see ${FAILURE_EVIDENCE}`);
  const settled = (): boolean => {
    if (existsSync(failed)) {
      throw failure();
    }
    return existsSync(ready);
  };
  if (settled()) {
    return;
  }
  await withLock(path.join(dir, "shared-project.lock"), async () => {
    if (settled()) {
      return;
    }
    const result = await attempt();
    if (result.status === "PASS") {
      writeFileSync(ready, "");
      return;
    }
    writeFileSync(failed, "");
    throw failure();
  });
}

/**
 * Runs the one real `ajs project init` of a run, as the journey `shared/project-init`
 * with its own HOME and evidence, unless an earlier journey already did. Returns the
 * project folder. A second `verify-ajs journey` process waits for the first. If the
 * init fails, it stays failed for the run and every journey that needs it fails at once.
 */
export async function sharedProject(state: RunState): Promise<string> {
  await settleOnce(state.dir, () => runJourney(state, SHARED_INIT.feature, sharedInit));
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
