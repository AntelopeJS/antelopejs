import process from "node:process";
import { pathToFileURL } from "node:url";

const [coreEntry, hostFolder, providerFolder, fixtureFolder] = process.argv.slice(2);
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
 * @typedef {object} HostRuntime
 * @property {boolean} isRunning
 * @property {() => Promise<void>} start
 * @property {() => Promise<void>} stop
 * @property {(request: string) => { Greeter: { greet: (name: string) => Promise<string> } }} use
 */

/**
 * @typedef {object} HostRuntimeOptions
 * @property {string} projectFolder
 * @property {Record<string, { path: string, config?: { prefix: string } }>} modules
 * @property {string[]} uses
 */

/**
 * @param {unknown} value
 * @returns {value is { createRuntime: (options: HostRuntimeOptions) => HostRuntime }}
 */
function exportsCreateRuntime(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, "createRuntime") &&
    value.createRuntime instanceof Function
  );
}

/** @type {unknown} */
const core = await import(pathToFileURL(coreEntry).href);
if (!exportsCreateRuntime(core)) {
  throw new Error(`${coreEntry} does not export createRuntime`);
}
const runtime = core.createRuntime({
  projectFolder: hostFolder,
  modules: {
    "greeter-provider": { path: providerFolder, config: { prefix: "Hello" } },
    "verify-http-fixture": { path: fixtureFolder },
  },
  uses: ["verify-greeter"],
});
const sigintListeners = process.listenerCount("SIGINT");
await runtime.start();
observations.runningAfterStart = runtime.isRunning;
observations.greeting = await runtime.use("verify-greeter").Greeter.greet("host");
observations.fixtureWhileRunning = await fixtureMessage();
observations.hostKeptSigint = process.listenerCount("SIGINT") === sigintListeners;
await runtime.stop();
observations.runningAfterStop = runtime.isRunning;
observations.fixtureAfterStop = await fixtureMessage();
process.stdout.write(`${JSON.stringify(observations)}\n`);
