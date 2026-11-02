import { expect } from "chai";
import path from "node:path";

import { ModuleManager } from "../../src/core/modules";
import { ModuleState } from "../../src/types";
import {
  INCIDENT_INTERFACE,
  writeIncidentProject,
} from "../helpers/interface-range-incident";
import { cleanupTempDir } from "../helpers/temp";
import { createLocalManifest } from "./module-manager.fixtures";

describe("ModuleManager interface range conflicts", () => {
  const projects: string[] = [];

  afterEach(() => {
    projects.splice(0).forEach(cleanupTempDir);
  });

  async function loadModules(manager: ModuleManager, folder: string) {
    const names = ["alpha", "beta", "gamma"];
    const manifests = await Promise.all(
      names.map((name) =>
        createLocalManifest(path.join(folder, "modules", name)),
      ),
    );
    manager.addModules(manifests.slice(0, 2).map((manifest) => ({ manifest })));
    manager.registerStubbedInterfaces(
      names.slice(0, 2).map((moduleId) => ({
        moduleId,
        interfacePackage: INCIDENT_INTERFACE,
      })),
    );
    return manager.addModules([{ manifest: manifests[2] }]);
  }

  it("keeps naming the module of a stubbed shared copy after more modules are added, without constructing any", async () => {
    const folder = await writeIncidentProject([
      { name: "alpha", range: "^0.1.0", copy: "0.1.0", optional: true },
      { name: "beta", range: "^0.0.9", copy: "0.0.9", optional: true },
      { name: "gamma", range: "*", optional: true },
    ]);
    projects.push(folder);
    const manager = new ModuleManager();
    try {
      const [gamma] = await loadModules(manager, folder);

      const conflicts = manager.findInterfaceRangeConflicts();

      expect(
        conflicts.map(({ moduleId, provider, canonical }) => ({
          moduleId,
          provider,
          version: canonical.version,
        })),
      ).to.deep.equal([
        { moduleId: "beta", provider: "alpha", version: "0.1.0" },
      ]);
      expect(gamma.module.state).to.equal(ModuleState.Loaded);
    } finally {
      await manager.destroyAll();
    }
  });
});
