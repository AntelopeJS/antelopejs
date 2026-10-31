import process from "node:process";
import { pathToFileURL } from "node:url";

const [coreEntry, hostFolder, providerFolder, fixtureFolder] = process.argv.slice(2);
const port = process.env.VERIFY_FIXTURE_PORT;
const observations = {};

async function fixtureMessage() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`);
    /** @type {unknown} */
    const body = await response.json();
    if (body === null) {
      return null;
    }
    return body instanceof Object && "message" in body ? body.message : undefined;
  } catch {
    return null;
  }
}

const { createRuntime } = await import(pathToFileURL(coreEntry).href);
const runtime = createRuntime({
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
