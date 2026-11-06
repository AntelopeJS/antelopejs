const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const PINNED_VERSION = process.argv[2] ?? "";
const REQUIRED_RANGE = ">=0.4.0 <0.5.0";

/** @param {string} root */
async function createProject(root) {
  const moduleFolder = path.join(root, "app");
  await fs.mkdir(moduleFolder, { recursive: true });
  await fs.writeFile(
    path.join(moduleFolder, "package.json"),
    JSON.stringify({ name: "app", version: "1.0.0", main: "index.js" }),
  );
  await fs.writeFile(
    path.join(moduleFolder, "index.js"),
    "exports.construct = () => {}; exports.start = () => {}; exports.stop = () => {}; exports.destroy = () => {};",
  );
  const config = {
    name: "pinned-interface-core",
    modules: {
      app: { source: { type: "local", path: "./app", main: "index.js" } },
    },
  };
  await fs.writeFile(
    path.join(root, "antelope.config.ts"),
    `export default ${JSON.stringify(config)};`,
  );
}

/** @param {unknown} error */
function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

async function main() {
  if (!PINNED_VERSION) {
    throw new Error("Pass the pinned interface-core version as an argument.");
  }
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-pinned-core-"));
  let manager;
  let message = "";
  try {
    await createProject(root);
    const launch = require("@antelopejs/core").default;
    manager = await launch(root);
  } catch (error) {
    message = describe(error);
  } finally {
    await manager?.stopAll();
    await manager?.destroyAll();
    await fs.rm(root, { recursive: true, force: true });
  }
  const expected = [
    PINNED_VERSION,
    REQUIRED_RANGE,
    "@antelopejs/interface-core",
  ];
  const missing = expected.filter((part) => !message.includes(part));
  if (missing.length > 0) {
    throw new Error(
      `Expected a start error naming ${missing.join(", ")}; received: ${message || "a successful launch"}`,
    );
  }
}

main().catch((/** @type {unknown} */ error) => {
  const detail = error instanceof Error ? (error.stack ?? error) : error;
  process.stderr.write(`${String(detail)}\n`);
  process.exitCode = 1;
});
