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

async function stopManager(manager) {
  await manager.stopAll();
  await manager.destroyAll();
}

// oxlint-disable-next-line typescript/no-unsafe-assignment -- a JS host fixture that requires the core under test by path; require is any
const core = createRequire(import.meta.url)(coreEntry);
// oxlint-disable-next-line typescript/no-unsafe-assignment -- a JS host fixture that requires the core under test by path; require is any
const launched = await core.launch(projectFolder);
observations.launchIsDefault = core.default === core.launch;
observations.afterLaunch = await fixtureMessage();
await stopManager(launched);
observations.afterLaunchStop = await fixtureMessage();
await core.build(projectFolder);
// oxlint-disable-next-line typescript/no-unsafe-assignment -- a JS host fixture that requires the core under test by path; require is any
const fromBuild = await core.launchFromBuild(projectFolder);
observations.afterLaunchFromBuild = await fixtureMessage();
await stopManager(fromBuild);
observations.afterBuildStop = await fixtureMessage();
process.stdout.write(`${JSON.stringify(observations)}\n`);
