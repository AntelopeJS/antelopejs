import { expect } from "chai";
import { satisfies } from "semver";

import packageJson from "../package.json";

/**
 * Node versions where `require("@clack/prompts")` loads (unflagged `require(esm)`) and
 * `process.getBuiltinModule` exists, measured with the reproduction in antelopejs#336.
 */
const LOADS = [
  "20.19.0",
  "20.20.0",
  "22.12.0",
  "22.22.0",
  "23.0.0",
  "24.22.2",
  "25.0.0",
];

/** Node versions where `require("@clack/prompts")` throws `ERR_REQUIRE_ESM`, or `getBuiltinModule` is missing. */
const FAILS = [
  "18.20.0",
  "20.0.0",
  "20.18.0",
  "21.0.0",
  "21.7.3",
  "22.0.0",
  "22.2.0",
  "22.11.0",
];

describe("package.json engines.node", () => {
  const range = packageJson.engines.node;

  for (const version of LOADS) {
    it(`admits Node ${version}, where the CLI prompt layer loads`, () => {
      expect(satisfies(version, range)).to.equal(true);
    });
  }

  for (const version of FAILS) {
    it(`refuses Node ${version}, where the CLI prompt layer cannot load`, () => {
      expect(satisfies(version, range)).to.equal(false);
    });
  }
});
