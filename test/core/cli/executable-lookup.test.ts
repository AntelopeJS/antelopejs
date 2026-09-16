import { expect } from "chai";
import path, { delimiter } from "node:path";

import { findExecutable } from "../../../src/core/cli/executable-lookup";

const FIRST_DIRECTORY = path.join("/opt", "first");
const SECOND_DIRECTORY = path.join("/opt", "second");

function executablePredicate(known: string[]) {
  const visited: string[] = [];
  return {
    visited,
    isExecutable: async (target: string) => {
      visited.push(target);
      return known.includes(target);
    },
  };
}

describe("Executable lookup", () => {
  it("returns the first matching directory of PATH", async () => {
    const target = path.join(SECOND_DIRECTORY, "ajs-dms");
    const predicate = executablePredicate([target]);

    const found = await findExecutable("ajs-dms", {
      path: [FIRST_DIRECTORY, SECOND_DIRECTORY].join(delimiter),
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(target);
  });

  it("ignores empty PATH entries instead of searching the current directory", async () => {
    const predicate = executablePredicate([]);

    const found = await findExecutable("ajs-dms", {
      path: `${delimiter}${FIRST_DIRECTORY}${delimiter}${delimiter}`,
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(undefined);
    expect(predicate.visited).to.deep.equal([
      path.join(FIRST_DIRECTORY, "ajs-dms"),
    ]);
  });

  it("returns undefined for an empty PATH", async () => {
    const predicate = executablePredicate([]);

    const found = await findExecutable("ajs-dms", {
      path: "",
      platform: "linux",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(undefined);
    expect(predicate.visited).to.deep.equal([]);
  });

  it("tries Windows executable extensions", async () => {
    const target = path.join(FIRST_DIRECTORY, "ajs-dms.cmd");
    const predicate = executablePredicate([target]);

    const found = await findExecutable("ajs-dms", {
      path: FIRST_DIRECTORY,
      platform: "win32",
      isExecutable: predicate.isExecutable,
    });

    expect(found).to.equal(target);
    expect(predicate.visited).to.deep.equal([
      path.join(FIRST_DIRECTORY, "ajs-dms"),
      target,
    ]);
  });
});
