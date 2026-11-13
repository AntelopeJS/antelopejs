import process from "node:process";
import { createRequire } from "node:module";

const [coreEntry, projectFolder] = process.argv.slice(2);
const port = process.env.VERIFY_FIXTURE_PORT;
const observations = {};

/**
 * @param {unknown} body
 * @returns {body is { message: unknown }}
 */
function hasMessage(body) {
  return body instanceof Object && Object.hasOwn(body, "message");
}

async function fixtureMessage() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    /** @type {unknown} */
    const body = await response.json();
    if (body === null) {
      return null;
    }
    return hasMessage(body) ? body.message : undefined;
  } catch {
    return null;
  }
}

/**
 * @typedef {object} LaunchedManager
 * @property {() => Promise<void>} stopAll
 * @property {() => Promise<void>} destroyAll
 */

/**
 * @typedef {object} CoreEntry
 * @property {(projectFolder: string) => Promise<LaunchedManager>} launch
 * @property {(projectFolder: string) => Promise<void>} build
 * @property {(projectFolder: string) => Promise<LaunchedManager>} launchFromBuild
 * @property {unknown} [default]
 */

/**
 * @param {unknown} value
 * @returns {value is CoreEntry}
 */
function isCoreEntry(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "launch") &&
    value.launch instanceof Function &&
    Object.hasOwn(value, "build") &&
    value.build instanceof Function &&
    Object.hasOwn(value, "launchFromBuild") &&
    value.launchFromBuild instanceof Function
  );
}

/** @param {LaunchedManager} manager */
async function stopManager(manager) {
  await manager.stopAll();
  await manager.destroyAll();
}

/** @type {unknown} */
const core = createRequire(import.meta.url)(coreEntry);
if (!isCoreEntry(core)) {
  throw new Error(`${coreEntry} does not export launch, build and launchFromBuild`);
}
const launched = await core.launch(projectFolder);
observations.launchIsDefault = core.default === core.launch;
observations.afterLaunch = await fixtureMessage();
await stopManager(launched);
observations.afterLaunchStop = await fixtureMessage();
await core.build(projectFolder);
const fromBuild = await core.launchFromBuild(projectFolder);
observations.afterLaunchFromBuild = await fixtureMessage();
await stopManager(fromBuild);
observations.afterBuildStop = await fixtureMessage();
process.stdout.write(`${JSON.stringify(observations)}\n`);
