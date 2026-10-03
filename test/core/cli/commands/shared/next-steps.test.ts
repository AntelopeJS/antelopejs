import path from "node:path";
import { expect } from "chai";

import { scopedCommand } from "../../../../../src/core/cli/commands/shared/next-steps";

describe("scopedCommand", () => {
  it("adds no flag for the current project and the default environment", () => {
    expect(
      scopedCommand("ajs project start", { project: process.cwd() }),
    ).to.equal("ajs project start");
    expect(
      scopedCommand("ajs project start", {
        project: process.cwd(),
        env: "default",
      }),
    ).to.equal("ajs project start");
  });

  it("names another project relative to the working directory", () => {
    const project = path.join(process.cwd(), "apps", "shop");

    expect(
      scopedCommand("ajs project start", { project, env: "production" }),
    ).to.equal(
      `ajs project start --project .${path.sep}${path.join("apps", "shop")} --env production`,
    );
  });

  it("quotes a project path that contains spaces", () => {
    expect(
      scopedCommand("ajs project dev", { project: "/tmp/my shop" }),
    ).to.equal('ajs project dev --project "/tmp/my shop"');
  });
});
