import { expect } from "chai";

import { prepareEmbedded } from "../../src/core/embedded";

describe("prepareEmbedded dev option", () => {
  const prepare = async (dev?: boolean) =>
    (
      await prepareEmbedded({ modules: {}, dev }, process.cwd())(
        process.cwd(),
        "default",
      )
    ).dev;

  it("runs outside development when the option is unset", async () => {
    expect(await prepare()).to.equal(false);
  });

  it("runs in development when the option is true", async () => {
    expect(await prepare(true)).to.equal(true);
  });
});
