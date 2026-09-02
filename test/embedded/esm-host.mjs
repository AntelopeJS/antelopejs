import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const [projectFolder, corePath] = process.argv.slice(2);

const failures = [];

function check(label, actual, expected) {
  if (actual !== expected) {
    failures.push(`${label}: expected ${expected}, got ${actual}`);
    return;
  }
  console.log(`ok - ${label}`);
}

const sigintBefore = process.listenerCount("SIGINT");
const sigtermBefore = process.listenerCount("SIGTERM");

const { createRuntime } = await import(pathToFileURL(corePath).href);
check(
  "named import of createRuntime from an ESM host",
  typeof createRuntime,
  "function",
);

const runtime = createRuntime({
  projectFolder,
  modules: {
    "provider-mod": { path: "./provider-mod", config: { prefix: "Hello" } },
  },
  uses: ["iface-pkg"],
});

await runtime.start();

const greeter = runtime.use("iface-pkg");
check(
  "use() returns the interface object",
  typeof greeter.Greeter.greet,
  "function",
);

const greeting = await Promise.race([
  greeter.Greeter.greet("esm"),
  new Promise((_, reject) => setTimeout(() => reject(new Error("HANG")), 5000)),
]);
check(
  "interface call routes to the module implementation",
  greeting,
  "Hello esm",
);

check(
  "host did not surrender SIGINT",
  process.listenerCount("SIGINT"),
  sigintBefore,
);
check(
  "host did not surrender SIGTERM",
  process.listenerCount("SIGTERM"),
  sigtermBefore,
);

const cacheFolder = path.join(projectFolder, ".antelope", "embedded-cache");
const cacheExists = await fs.stat(cacheFolder).then(
  () => true,
  () => false,
);
check("no module cache was created", cacheExists, false);

await runtime.stop();
check("runtime reports stopped", runtime.isRunning, false);

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed:`);
  for (const failure of failures) {
    console.error(`  - ${failure}`);
  }
  process.exit(1);
}

console.log("\nESM host verification passed.");
