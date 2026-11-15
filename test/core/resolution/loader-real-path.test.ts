import { expect } from "chai";
import fs from "node:fs";
import path from "node:path";
import * as sinon from "sinon";

import {
  clearPathResolutionCache,
  normalizeExistingPath,
} from "../../../src/utils";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

describe("real paths of loaded files", () => {
  let folder = "";

  beforeEach(() => {
    folder = makeTempDir("ajs-loader-real-path-");
    fs.writeFileSync(path.join(folder, "entry.js"), "module.exports = {};");
    clearPathResolutionCache();
  });

  afterEach(() => {
    sinon.restore();
    clearPathResolutionCache();
    cleanupTempDir(folder);
  });

  it("names a file as the module loader does when the OS names its folder differently", () => {
    const entry = path.join(folder, "entry.js");
    const loaded = require.resolve(entry);
    sinon
      .stub(fs.realpathSync, "native")
      .callsFake((target) =>
        String(target).replace(folder, `${folder}-long-name`),
      );

    expect(normalizeExistingPath(entry)).to.equal(loaded);
  });
});
