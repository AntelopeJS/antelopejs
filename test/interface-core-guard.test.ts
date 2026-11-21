import { expect } from "chai";

import {
  assertInterfaceCoreCopy,
  type InterfaceCoreCopy,
} from "../src/interface-core-guard";
import { CliError } from "../src/core/output";

const REQUIRED_RANGE = ">=0.5.1 <0.6.0";

function copyAt(version: string | undefined): InterfaceCoreCopy {
  return {
    coreVersion: "1.21.1",
    requiredRange: REQUIRED_RANGE,
    installed: version
      ? {
          name: "@antelopejs/interface-core",
          version,
          root: "/project/node_modules/@antelopejs/interface-core",
          realRoot: "/project/node_modules/@antelopejs/interface-core",
          entry: "/project/node_modules/@antelopejs/interface-core/index.js",
          resolveFrom: "/project/node_modules/@antelopejs/interface-core",
        }
      : undefined,
  };
}

function thrownBy(copy: InterfaceCoreCopy): CliError {
  try {
    assertInterfaceCoreCopy(copy);
  } catch (error) {
    if (error instanceof CliError) {
      return error;
    }
    throw error;
  }
  throw new Error("assertInterfaceCoreCopy did not throw");
}

describe("assertInterfaceCoreCopy", () => {
  it("accepts the copy the core resolves when it is in range", () => {
    expect(() => assertInterfaceCoreCopy()).not.to.throw();
  });

  it("accepts a prerelease of the required minor", () => {
    expect(() =>
      assertInterfaceCoreCopy(copyAt("0.5.2-beta.0")),
    ).not.to.throw();
  });

  it("refuses a prerelease of the minor the range caps", () => {
    const { problem } = thrownBy(copyAt("0.6.0-next.1"));

    expect(problem.title).to.include("0.6.0-next.1");
  });

  it("refuses a prerelease below the floor of a 0.x caret range", () => {
    const { problem } = thrownBy({
      ...copyAt("0.5.1-next.1"),
      requiredRange: "^0.5.1",
    });

    expect(problem.title).to.include("0.5.1-next.1");
  });

  it("names the pinned version, the required range and the copy's folder", () => {
    const { problem } = thrownBy(copyAt("0.0.11"));

    expect(problem.title).to.include("0.0.11").and.include(REQUIRED_RANGE);
    expect(problem.reason).to.include(
      "/project/node_modules/@antelopejs/interface-core",
    );
    expect(problem.fixes?.join(" ")).to.include("overrides");
  });

  it("rejects the next minor the core does not implement", () => {
    expect(thrownBy(copyAt("0.6.0")).problem.title).to.include("0.6.0");
  });

  describe("under a preview's exact pin", () => {
    const PIN = "0.5.2-next.117.gae930be";
    const pinnedAt = (version: string): InterfaceCoreCopy => ({
      ...copyAt(version),
      coreVersion: "1.22.0-next.40.gabcdef0",
      requiredRange: PIN,
    });

    it("accepts a newer preview of the pinned line", () => {
      expect(() =>
        assertInterfaceCoreCopy(pinnedAt("0.5.2-next.118.g51a2e95")),
      ).not.to.throw();
    });

    it("accepts the pinned preview itself", () => {
      expect(() => assertInterfaceCoreCopy(pinnedAt(PIN))).not.to.throw();
    });

    for (const version of [
      "0.5.2-next.116.g0000000",
      "0.5.3-next.1.g0000000",
      "0.6.0-next.1.g0000000",
      "0.5.2-rc.1",
      "0.5.2",
    ]) {
      it(`refuses ${version}, outside the pinned line or older`, () => {
        expect(thrownBy(pinnedAt(version)).problem.title).to.include(PIN);
      });
    }
  });

  it("keeps an exact stable pin exact", () => {
    const { problem } = thrownBy({
      ...copyAt("0.5.2"),
      requiredRange: "0.5.1",
    });

    expect(problem.title).to.include("0.5.2");
  });

  it("rejects a copy whose version it cannot find", () => {
    expect(thrownBy(copyAt(undefined)).problem.title).to.include(
      "an unknown version",
    );
  });
});
