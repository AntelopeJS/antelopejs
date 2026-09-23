import { expect } from "chai";

import { clearPathResolutionCache } from "../../../src/core/resolution/package-resolution";
import {
  PathOwnerIndex,
  type PathOwnerRoot,
} from "../../../src/core/resolution/path-owner-index";

function createIndex(roots: PathOwnerRoot<string>[]) {
  let listCount = 0;
  const index = new PathOwnerIndex(() => {
    listCount += 1;
    return roots;
  });
  return { index, getListCount: () => listCount };
}

describe("PathOwnerIndex", () => {
  it("returns the owner of the longest containing root", () => {
    const { index } = createIndex([
      { root: "/modules", owner: "outer" },
      { root: "/modules/inner", owner: "inner" },
    ]);

    expect(index.findOwner("/modules/inner/index.js")).to.equal("inner");
    expect(index.findOwner("/modules/other/index.js")).to.equal("outer");
    expect(index.findOwner("/elsewhere/index.js")).to.equal(undefined);
  });

  it("keeps the first listed root when two roots have the same length", () => {
    const { index } = createIndex([
      { root: "/modules/a", owner: "first" },
      { root: "/modules/a", owner: "second" },
    ]);

    expect(index.findOwner("/modules/a/index.js")).to.equal("first");
  });

  it("respects path boundaries", () => {
    const { index } = createIndex([{ root: "/modules/mod-a", owner: "a" }]);

    expect(index.findOwner("/modules/mod-a2/index.js")).to.equal(undefined);
  });

  it("lists roots once and memoizes answers until invalidated", () => {
    const roots: PathOwnerRoot<string>[] = [{ root: "/modules", owner: "a" }];
    const { index, getListCount } = createIndex(roots);
    index.findOwner("/modules/one.js");
    index.findOwner("/modules/two.js");
    index.findOwner("/modules/one.js");
    expect(getListCount()).to.equal(1);

    roots.push({ root: "/modules/nested", owner: "b" });
    expect(index.findOwner("/modules/nested/one.js")).to.equal("a");

    index.invalidate();
    expect(index.findOwner("/modules/nested/one.js")).to.equal("b");
    expect(getListCount()).to.equal(2);
  });

  it("drops its answers when the realpath cache is cleared", () => {
    const { index, getListCount } = createIndex([
      { root: "/modules", owner: "a" },
    ]);
    index.findOwner("/modules/one.js");

    clearPathResolutionCache();
    index.findOwner("/modules/one.js");

    expect(getListCount()).to.equal(2);
  });
});
