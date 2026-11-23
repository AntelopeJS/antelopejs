import { GetRuntimeInfo } from "@antelopejs/interface-core/runtime";
import { expect } from "chai";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createRuntime } from "../../src";
import { resetProxy } from "../helpers/interface-proxy";

describe("createRuntime dev option", () => {
  let projectFolder: string;

  beforeEach(async () => {
    projectFolder = await fs.mkdtemp(path.join(os.tmpdir(), "ajs-dev-opt-"));
  });

  afterEach(async () => {
    resetProxy(GetRuntimeInfo);
    await fs.rm(projectFolder, { recursive: true, force: true });
  });

  const reportedDev = async (dev?: boolean): Promise<boolean> => {
    const runtime = createRuntime({ projectFolder, modules: {}, dev });
    await runtime.start();
    try {
      return (await GetRuntimeInfo()).dev;
    } finally {
      await runtime.stop();
    }
  };

  it("runs outside development when the option is unset", async () => {
    expect(await reportedDev()).to.equal(false);
  });

  it("runs in development when the option is true", async () => {
    expect(await reportedDev(true)).to.equal(true);
  });
});
