import process from "node:process";
import { createRequire } from "node:module";

const [coreEntry, projectFolder] = process.argv.slice(2);
const port = process.env.VERIFY_FIXTURE_PORT;
const observations = {};

async function fixtureMessage() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    return (await response.json()).message;
  } catch {
    return null;
  }
}

async function stopManager(manager) {
  await manager.stopAll();
  await manager.destroyAll();
}

const core = createRequire(import.meta.url)(coreEntry);
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
