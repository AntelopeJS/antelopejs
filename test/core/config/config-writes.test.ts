import { expect } from "chai";
import { createHash } from "node:crypto";

import {
  consumeOwnConfigWrite,
  recordOwnConfigWrite,
} from "../../../src/core/config";

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

describe("config writes", () => {
  let projects = 0;
  let configPath: string;

  beforeEach(() => {
    projects += 1;
    configPath = `/project-${projects}/antelope.config.ts`;
  });

  it("recognizes a write the runtime made on the content the watcher saw, once", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("b"))).to.equal(
      true,
    );
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("b"))).to.equal(
      false,
    );
  });

  it("treats content the runtime did not write as the user's edit", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("c"))).to.equal(
      false,
    );
  });

  it("forgets own writes once the watcher sees a user's edit", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("c"))).to.equal(
      false,
    );
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("b"))).to.equal(
      false,
    );
  });

  it("treats an own write over a user's edit the watcher missed as the user's edit", () => {
    recordOwnConfigWrite(configPath, "user edit", "user edit + own");
    expect(
      consumeOwnConfigWrite(configPath, hash("a"), hash("user edit + own")),
    ).to.equal(false);
  });

  it("recognizes several own writes the watcher sees as one change", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    recordOwnConfigWrite(configPath, "b", "c");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("c"))).to.equal(
      true,
    );
  });

  it("keeps an own write the watcher has not seen yet", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    recordOwnConfigWrite(configPath, "b", "c");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("b"))).to.equal(
      true,
    );
    expect(consumeOwnConfigWrite(configPath, hash("b"), hash("c"))).to.equal(
      true,
    );
  });

  it("treats a user's edit matching an own write the watcher never saw as the user's", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    recordOwnConfigWrite(configPath, "b", "a");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("b"))).to.equal(
      false,
    );
  });

  it("continues a run of own writes after writes that came back to the content", () => {
    recordOwnConfigWrite(configPath, "a", "b");
    recordOwnConfigWrite(configPath, "b", "a");
    recordOwnConfigWrite(configPath, "a", "c");
    expect(consumeOwnConfigWrite(configPath, hash("a"), hash("c"))).to.equal(
      true,
    );
  });

  it("treats the creation of a file that was absent as the user's edit", () => {
    recordOwnConfigWrite(configPath, "", "b");
    expect(consumeOwnConfigWrite(configPath, undefined, hash("b"))).to.equal(
      false,
    );
  });
});
