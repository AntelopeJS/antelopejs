import { expect } from "chai";

import { ObservableMap } from "../../../src/core/resolution/observable-map";

describe("ObservableMap", () => {
  it("reports set, delete and clear as changes", () => {
    let changeCount = 0;
    const map = new ObservableMap<string, number>(() => {
      changeCount += 1;
    });

    map.set("a", 1).set("b", 2);
    map.delete("a");
    map.clear();

    expect(changeCount).to.equal(4);
    expect(map.size).to.equal(0);
  });

  it("does not report deleting a missing key", () => {
    let changeCount = 0;
    const map = new ObservableMap<string, number>(() => {
      changeCount += 1;
    });

    expect(map.delete("missing")).to.equal(false);
    expect(changeCount).to.equal(0);
  });
});
