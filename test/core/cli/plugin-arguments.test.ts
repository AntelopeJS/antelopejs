import { expect } from "chai";

import { parsePluginInvocation } from "../../../src/core/cli/plugin-arguments";

describe("Plugin invocation", () => {
  it("keeps a command line without global options as is", () => {
    expect(parsePluginInvocation(["dms", "dev"])).to.deep.equal({
      args: ["dms", "dev"],
      environment: {},
    });
  });

  it("turns --no-color before the plugin name into NO_COLOR", () => {
    expect(parsePluginInvocation(["--no-color", "dms", "dev"])).to.deep.equal({
      args: ["dms", "dev"],
      environment: { NO_COLOR: "1" },
    });
  });

  it("turns --verbose before the plugin name into every channel", () => {
    expect(parsePluginInvocation(["--verbose", "dms", "dev"])).to.deep.equal({
      args: ["dms", "dev"],
      environment: { ANTELOPEJS_VERBOSE: "*" },
    });
  });

  for (const flag of ["-q", "--quiet"]) {
    it(`turns ${flag} before the plugin name into ANTELOPEJS_QUIET`, () => {
      expect(parsePluginInvocation([flag, "dms", "dev"])).to.deep.equal({
        args: ["dms", "dev"],
        environment: { ANTELOPEJS_QUIET: "1" },
      });
    });
  }

  it("keeps the channel list of --verbose=<channels>", () => {
    expect(
      parsePluginInvocation(["--verbose=cli,api", "dms", "dev"]),
    ).to.deep.equal({
      args: ["dms", "dev"],
      environment: { ANTELOPEJS_VERBOSE: "cli,api" },
    });
  });

  it("treats an empty channel list as every channel", () => {
    expect(
      parsePluginInvocation(["--verbose=", "dms"]).environment,
    ).to.deep.equal({ ANTELOPEJS_VERBOSE: "*" });
  });

  it("combines global options in any order", () => {
    expect(
      parsePluginInvocation(["--verbose", "--no-color", "dms", "build"]),
    ).to.deep.equal({
      args: ["dms", "build"],
      environment: { NO_COLOR: "1", ANTELOPEJS_VERBOSE: "*" },
    });
  });

  it("leaves the options after the plugin name to the plugin", () => {
    expect(
      parsePluginInvocation(["dms", "dev", "--no-color", "--verbose"]),
    ).to.deep.equal({
      args: ["dms", "dev", "--no-color", "--verbose"],
      environment: {},
    });
  });

  it("stops at the first argument that is not a global option", () => {
    expect(
      parsePluginInvocation(["--no-color", "--help", "--verbose"]),
    ).to.deep.equal({
      args: ["--help", "--verbose"],
      environment: { NO_COLOR: "1" },
    });
  });

  it("returns no command when only global options are given", () => {
    expect(parsePluginInvocation(["--no-color", "--verbose"])).to.deep.equal({
      args: [],
      environment: { NO_COLOR: "1", ANTELOPEJS_VERBOSE: "*" },
    });
  });
});
