import { expect } from "chai";
import sinon from "sinon";

import { handlers } from "../../../../../src/cli";
import { defined } from "../../../../helpers/defined";
describe("project modules behavior: git-handler", () => {
  afterEach(() => {
    sinon.restore();
    process.exitCode = undefined;
  });

  it("git handler validates url format", async () => {
    const handler = defined(handlers.get("git"));
    let caught: unknown;
    try {
      await handler("not-a-url", {
        mode: "git",
        project: "/tmp/project",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).to.be.instanceOf(Error);

    const [name, config] = await handler("https://example.com/repo.git", {
      mode: "git",
      project: "/tmp/project",
    });
    expect(name).to.equal("repo");
    expect(config).to.have.nested.property(
      "source.remote",
      "https://example.com/repo.git",
    );
  });
});
