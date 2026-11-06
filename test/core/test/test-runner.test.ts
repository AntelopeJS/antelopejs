import { expect } from "chai";
import Mocha from "mocha";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sinon from "sinon";

import { TestContext, TestRunner } from "../../../src/core/test";

describe("TestRunner", () => {
  it("should run tests and call setup/cleanup", async () => {
    const calls: string[] = [];
    const context = new TestContext({
      setup: async () => {
        calls.push("setup");
      },
      cleanup: async () => {
        calls.push("cleanup");
      },
    });

    const addedFiles: string[] = [];
    const fakeMocha = sinon.createStubInstance(Mocha);
    fakeMocha.addFile.callsFake((file) => {
      addedFiles.push(file);
      return fakeMocha;
    });
    fakeMocha.run.callsFake((cb) => {
      cb?.(0);
      return sinon.createStubInstance(Mocha.Runner);
    });

    const runner = new TestRunner(context, () => fakeMocha);
    const failures = await runner.run(["a.test.js", "b.test.js"]);

    expect(failures).to.equal(0);
    expect(addedFiles).to.deep.equal(["a.test.js", "b.test.js"]);
    expect(calls).to.deep.equal(["setup", "cleanup"]);
  });

  it("loads mocha only once it runs tests, then reports their failures", async function () {
    this.timeout(CHILD_TIMEOUT_MS);
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), "test-runner-"));
    const testFile = path.join(folder, "failing.test.js");
    await fs.writeFile(
      testFile,
      'describe("child", () => { it("passes", () => {}); it("fails", () => { throw new Error("expected"); }); });\n',
    );

    try {
      const report = await runChild(testFile);

      expect(report).to.equal(
        "loaded on import: false, loaded after run: true, failures: 1",
      );
    } finally {
      await fs.rm(folder, { recursive: true, force: true });
    }
  });
});

const CHILD_TIMEOUT_MS = 60000;
const REPORT_PREFIX = "REPORT ";
const CHILD_SCRIPT = `
const mochaLoaded = () => Object.keys(require.cache).some((key) => /[\\\\/]mocha[\\\\/]lib[\\\\/]/.test(key));
require("./src");
const loadedOnImport = mochaLoaded();
const { TestRunner } = require("./src/core/test");
const context = { setup: async () => {}, cleanup: async () => {} };
new TestRunner(context).run([process.argv[1]]).then((failures) => {
  console.log("${REPORT_PREFIX}loaded on import: " + loadedOnImport + ", loaded after run: " + mochaLoaded() + ", failures: " + failures);
});
`;

function runChild(testFile: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      ["-r", "ts-node/register", "-e", CHILD_SCRIPT, testFile],
      {
        cwd: path.resolve(__dirname, "../../.."),
        env: { ...process.env, TS_NODE_TRANSPILE_ONLY: "true" },
      },
    );
    let output = "";
    child.stdout.on("data", (chunk) => (output += String(chunk)));
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("error", reject);
    child.on("close", () => {
      const line = output
        .split("\n")
        .find((entry) => entry.startsWith(REPORT_PREFIX));
      if (line === undefined) {
        reject(new Error(`The child printed no report:\n${output}`));
        return;
      }
      resolve(line.slice(REPORT_PREFIX.length));
    });
  });
}
