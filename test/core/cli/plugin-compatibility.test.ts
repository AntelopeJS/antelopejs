import { expect } from "chai";

import { delegateToPlugin } from "../../../src/core/cli/plugin";
import {
  createGlobalRootResolver,
  createOutput,
  createPackageReader,
  createProcessRunner,
} from "../../helpers/cli-plugins";
import {
  createInstalledReader,
  createShimReader,
  DMS_EXECUTABLE,
  GLOBAL_ROOT,
  installedDependencies,
} from "../../helpers/official-plugin";

describe("Official plugin compatibility", () => {
  it("delegates when the peer range is satisfied", async () => {
    const { runner, calls } = createProcessRunner([0]);

    const result = await delegateToPlugin(
      ["dms", "status"],
      installedDependencies({
        packageLookup: {
          reader: createInstalledReader({ peerRange: "^1.5.0" }),
        },
        processOptions: { processRunner: runner },
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(calls).to.have.length(1);
    expect(calls[0].args).to.deep.equal(["status"]);
  });

  it("accepts a prerelease core inside the declared range", async () => {
    const { runner, calls } = createProcessRunner([0]);
    const output = createOutput();

    const result = await delegateToPlugin(
      ["dms"],
      installedDependencies({
        coreVersion: "1.6.0-beta.2",
        packageLookup: {
          reader: createInstalledReader({ peerRange: ">=1.5.0" }),
        },
        processOptions: { processRunner: runner },
        output,
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(calls).to.have.length(1);
    expect(output.errors).to.deep.equal([]);
  });

  it("rejects a prerelease core outside the declared range", async () => {
    const { runner, calls } = createProcessRunner();
    const output = createOutput();

    const result = await delegateToPlugin(
      ["dms"],
      installedDependencies({
        coreVersion: "2.0.0-rc.1",
        packageLookup: {
          reader: createInstalledReader({ peerRange: "^1.5.0" }),
        },
        processOptions: { processRunner: runner },
        output,
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
    expect(calls).to.deep.equal([]);
    expect(output.errors[1]).to.contain("@antelopejs/core@2.0.0-rc.1");
  });

  it("fails when the peer range excludes the running core", async () => {
    const output = createOutput();
    const { runner, calls } = createProcessRunner();

    const result = await delegateToPlugin(
      ["dms"],
      installedDependencies({
        packageLookup: {
          reader: createInstalledReader({ peerRange: ">=2.0.0" }),
        },
        processOptions: { processRunner: runner },
        output,
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
    expect(calls).to.deep.equal([]);
    expect(output.errors[0]).to.equal(
      "The DMS plugin is not compatible with this CLI.",
    );
    expect(output.errors[1]).to.contain("@antelopejs/dms-frontend@1.2.3");
    expect(output.errors[1]).to.contain("@antelopejs/core@>=2.0.0");
    expect(output.errors[1]).to.contain("@antelopejs/core@1.5.1");
    expect(output.errors[2]).to.contain("ajs update");
  });

  it("skips the check when the plugin declares no peer range", async () => {
    const output = createOutput();
    const { runner, calls } = createProcessRunner([0]);

    const result = await delegateToPlugin(
      ["dms"],
      installedDependencies({
        processOptions: { processRunner: runner },
        output,
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(calls).to.have.length(1);
    expect(output.errors).to.deep.equal([]);
  });
});

describe("Official plugin package discovery", () => {
  it("reads the package.json from the global root behind a shim", async () => {
    const output = createOutput();
    const { runner, calls } = createProcessRunner();

    const result = await delegateToPlugin(
      ["dms"],
      installedDependencies({
        packageLookup: {
          reader: createShimReader({ peerRange: ">=2.0.0" }),
          packageManager: "pnpm",
          resolveGlobalRoot: createGlobalRootResolver(GLOBAL_ROOT),
        },
        processOptions: { processRunner: runner },
        output,
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 1 });
    expect(calls).to.deep.equal([]);
    expect(output.errors[0]).to.equal(
      "The DMS plugin is not compatible with this CLI.",
    );
  });

  it("warns but still delegates when no plugin package.json is found", async () => {
    const output = createOutput();
    const { runner, calls } = createProcessRunner([0]);

    const result = await delegateToPlugin(
      ["dms"],
      installedDependencies({
        packageLookup: {
          reader: createPackageReader({}),
          resolveGlobalRoot: createGlobalRootResolver(),
        },
        processOptions: { processRunner: runner },
        output,
      }),
    );

    expect(result).to.deep.equal({ isDelegated: true, exitCode: 0 });
    expect(calls).to.have.length(1);
    expect(calls[0].executable).to.equal(DMS_EXECUTABLE);
    expect(output.errors).to.deep.equal([
      "Could not read the package.json of @antelopejs/dms-frontend; skipping the compatibility check.",
    ]);
  });
});
