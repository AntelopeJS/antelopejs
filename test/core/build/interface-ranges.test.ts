import { expect } from "chai";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";

import { build, interfaceRangesModule } from "../../../src/core/build";
import { readBuildArtifact } from "../../../src/core/modules";
import { InterfaceResolutionError } from "../../../src/core/output";
import {
  INCIDENT_INTERFACE,
  INCIDENT_MODULES,
  sharedCopyRoot,
  writeIncidentProject,
} from "../../helpers/interface-range-incident";
import { cleanupTempDir } from "../../helpers/temp";

const { findProjectInterfaceRangeConflicts } = interfaceRangesModule;

function buildArtifactPath(projectFolder: string): string {
  return path.join(projectFolder, ".antelope", "build", "build.json");
}

async function rejectionOf(call: Promise<void>): Promise<Error | undefined> {
  try {
    await call;
  } catch (error) {
    assert.ok(error instanceof Error);
    return error;
  }
  return undefined;
}

describe("interface range check before startup", function () {
  this.timeout(30000);
  const projects: string[] = [];

  async function project(...args: Parameters<typeof writeIncidentProject>) {
    const folder = await writeIncidentProject(...args);
    projects.push(folder);
    return folder;
  }

  afterEach(() => {
    projects.splice(0).forEach(cleanupTempDir);
  });

  it("build fails with the conflict and writes no build artifact", async () => {
    const folder = await project();

    const error = await rejectionOf(build(folder, "default"));

    assert.ok(error instanceof InterfaceResolutionError);
    expect(
      error.conflicts.rangeConflicts.map((conflict) => ({
        moduleId: conflict.moduleId,
        range: conflict.range,
        version: conflict.canonical.version,
        provider: conflict.provider,
        consumerVersion: conflict.consumerCopy?.version,
      })),
    ).to.deep.equal([
      {
        moduleId: "backend",
        range: ">=0.0.7 <0.1.0",
        version: "0.1.0",
        provider: "auth-jwt",
        consumerVersion: "0.0.9",
      },
    ]);
    expect(error.conflicts.preloadedCopies).to.deep.equal([]);
    expect(existsSync(buildArtifactPath(folder))).to.equal(false);
  });

  it("build writes the artifact when every range includes the shared copy", async () => {
    const folder = await project([
      INCIDENT_MODULES[0],
      { ...INCIDENT_MODULES[1], range: ">=0.0.7 <0.2.0" },
    ]);

    await build(folder, "default");

    expect(existsSync(buildArtifactPath(folder))).to.equal(true);
  });

  it("finds the conflict from the copy the implementing module resolves", async () => {
    const folder = await project();

    const conflicts = await findProjectInterfaceRangeConflicts(
      folder,
      "default",
    );

    expect(conflicts).to.have.length(1);
    expect(conflicts[0]).to.deep.include({
      moduleId: "backend",
      packageName: INCIDENT_INTERFACE,
      range: ">=0.0.7 <0.1.0",
      provider: "auth-jwt",
    });
    expect(conflicts[0].canonical.root).to.equal(
      sharedCopyRoot(folder, "auth-jwt"),
    );
  });

  it("names the consumer whose copy is shared when nothing implements an optional interface", async () => {
    const folder = await project([
      { name: "alpha", range: "^0.1.0", copy: "0.1.0", optional: true },
      { name: "beta", range: "^0.0.9", copy: "0.0.9", optional: true },
    ]);

    const conflicts = await findProjectInterfaceRangeConflicts(
      folder,
      "default",
    );

    expect(
      conflicts.map(({ moduleId, provider, canonical }) => ({
        moduleId,
        provider,
        version: canonical.version,
      })),
    ).to.deep.equal([
      { moduleId: "beta", provider: "alpha", version: "0.1.0" },
    ]);
  });

  it("reports no range conflict and fails the build while a required interface is unimplemented", async () => {
    const folder = await project([
      { name: "alpha", range: "^0.1.0", copy: "0.1.0" },
    ]);

    const conflicts = await findProjectInterfaceRangeConflicts(
      folder,
      "default",
    );
    const buildError = await rejectionOf(build(folder, "default"));

    expect(conflicts).to.deep.equal([]);
    expect(buildError?.message).to.include("Unresolved interface dependencies");
  });
});

describe("interface range check with modules marked optional in the config", function () {
  this.timeout(30000);
  const projects: string[] = [];

  async function project(...args: Parameters<typeof writeIncidentProject>) {
    const folder = await writeIncidentProject(...args);
    projects.push(folder);
    return folder;
  }

  afterEach(() => {
    projects.splice(0).forEach(cleanupTempDir);
  });

  const optionalBackend = { ...INCIDENT_MODULES[1], configOptional: true };

  it("builds, as a launch runs without the optional module that conflicts", async () => {
    const folder = await project([INCIDENT_MODULES[0], optionalBackend]);

    await build(folder, "default");

    expect(existsSync(buildArtifactPath(folder))).to.equal(true);
    expect(
      await findProjectInterfaceRangeConflicts(folder, "default"),
    ).to.deep.equal([]);
  });

  it("keeps the optional module in the build artifact", async () => {
    const folder = await project([INCIDENT_MODULES[0], optionalBackend]);

    await build(folder, "default");

    const artifact = await readBuildArtifact(folder);
    expect(Object.keys(artifact.modules)).to.have.members([
      "auth-jwt",
      "backend",
    ]);
  });

  it("fails when a required module conflicts with the shared copy the required modules provide", async () => {
    const folder = await project([
      { ...INCIDENT_MODULES[0], name: "z-impl", copy: "0.1.0" },
      {
        ...INCIDENT_MODULES[0],
        name: "a-impl",
        copy: "0.0.9",
        configOptional: true,
      },
      { ...INCIDENT_MODULES[1], name: "consumer" },
    ]);

    const error = await rejectionOf(build(folder, "default"));
    const conflicts = await findProjectInterfaceRangeConflicts(
      folder,
      "default",
    );

    assert.ok(error instanceof InterfaceResolutionError);
    expect(
      error.conflicts.rangeConflicts.map(({ moduleId, provider }) => ({
        moduleId,
        provider,
      })),
    ).to.deep.equal([{ moduleId: "consumer", provider: "z-impl" }]);
    expect(conflicts.map(({ moduleId }) => moduleId)).to.deep.equal([
      "consumer",
    ]);
    expect(existsSync(buildArtifactPath(folder))).to.equal(false);
  });
});
