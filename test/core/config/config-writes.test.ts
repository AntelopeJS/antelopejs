import { expect } from "chai";

import {
  consumeOwnConfigWrite,
  recordOwnConfigWrite,
} from "../../../src/core/config";

describe("config writes", () => {
  it("recognizes the content the runtime wrote, once", () => {
    recordOwnConfigWrite("/project/antelope.config.ts", "a");
    expect(consumeOwnConfigWrite("/project/antelope.config.ts", "a")).to.equal(
      true,
    );
    expect(consumeOwnConfigWrite("/project/antelope.config.ts", "a")).to.equal(
      false,
    );
  });

  it("treats any other content as the user's edit", () => {
    recordOwnConfigWrite("/project/antelope.config.ts", "a");
    expect(consumeOwnConfigWrite("/project/antelope.config.ts", "b")).to.equal(
      false,
    );
  });
});
