import type { ModuleSourcePackage } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import path from "node:path";
import { inc } from "semver";

import {
  ModuleManager,
  ModuleManifest,
  raiseRangeFloor,
} from "../../src/core/modules";
import { planInterfacePackages } from "../../src/core/runtime";
import { resolvePackage } from "../../src/utils";
import {
  INCIDENT_INTERFACE,
  writeIncidentProject,
} from "../helpers/interface-range-incident";
import { cleanupTempDir } from "../helpers/temp";
import { createLocalManifest } from "./module-manager.fixtures";

type IncidentModules = Parameters<typeof writeIncidentProject>[0];

function npmSource(name: string): ModuleSourcePackage {
  return { type: "package", package: `@test-scope/${name}`, version: "1.0.0" };
}

const projects: string[] = [];

function cleanupProjects() {
  afterEach(() => {
    projects.splice(0).forEach(cleanupTempDir);
  });
}

/**
 * Loads every module of an incident project in the order given, as local
 * folders, except the ones named in `fromNpm`, which keep an npm source.
 */
async function plan(
  modules: IncidentModules,
  fromNpm: string[],
  interfaceName = INCIDENT_INTERFACE,
) {
  const folder = await writeIncidentProject(modules, interfaceName);
  projects.push(folder);
  const manager = new ModuleManager();
  const manifests = await Promise.all(
    (modules ?? []).map(({ name }) => {
      const moduleFolder = path.join(folder, "modules", name);
      return fromNpm.includes(name)
        ? ModuleManifest.create(moduleFolder, npmSource(name), name)
        : createLocalManifest(moduleFolder);
    }),
  );
  manager.addModules(manifests.map((manifest) => ({ manifest })));
  planInterfacePackages(manager);
  try {
    return {
      folder,
      conflicts: manager.findInterfaceRangeConflicts(),
      bumps: manager.findInterfaceBumps(),
      sharedRoot: manager.resolver.interfacePackages.get(INCIDENT_INTERFACE),
    };
  } finally {
    await manager.destroyAll();
  }
}

describe("ModuleManager interface bumps of a stubbed interface", () => {
  cleanupProjects();

  const cmsDemo = (projectModule: string): IncidentModules => [
    { name: projectModule, range: "^0.1.8", copy: "0.1.8", optional: true },
    { name: "cms", range: ">=0.1.9 <1.0.0", copy: "0.1.9", optional: true },
  ];

  for (const projectModule of ["app", "zz-app"]) {
    it(`shares the highest copy every range accepts when nothing implements the interface (project module ${projectModule})`, async () => {
      const { folder, conflicts, bumps } = await plan(cmsDemo(projectModule), [
        "cms",
      ]);

      expect(conflicts).to.deep.equal([]);
      expect(bumps).to.deep.equal([
        {
          kind: "range",
          moduleId: projectModule,
          packageName: INCIDENT_INTERFACE,
          current: "0.1.8",
          target: "0.1.9",
          requiredBy: ["cms@1.0.0"],
          required: false,
          folder: path.join(folder, "modules", projectModule),
          field: "optionalDependencies",
          from: "^0.1.8",
          to: "^0.1.9",
        },
      ]);
    });
  }
});

describe("ModuleManager interface bumps of an interface named like an Object.prototype member", () => {
  cleanupProjects();

  it("names optionalDependencies as the field of a range bump on an optional-only interface", async () => {
    const { bumps } = await plan(
      [
        { name: "app", range: "^0.1.8", copy: "0.1.8", optional: true },
        { name: "cms", range: ">=0.1.9 <1.0.0", copy: "0.1.9", optional: true },
      ],
      ["cms"],
      "constructor",
    );

    expect(
      bumps.map((bump) => bump.kind === "range" && bump.field),
    ).to.deep.equal(["optionalDependencies"]);
  });

  it("names optionalDependencies as the field when the module also declares unrelated dependencies", async () => {
    const { bumps } = await plan(
      [
        {
          name: "app",
          range: "^0.1.8",
          copy: "0.1.8",
          optional: true,
          unrelatedDependency: true,
        },
        { name: "cms", range: ">=0.1.9 <1.0.0", copy: "0.1.9", optional: true },
      ],
      ["cms"],
      "constructor",
    );

    expect(
      bumps.map((bump) => bump.kind === "range" && bump.field),
    ).to.deep.equal(["optionalDependencies"]);
  });
});

describe("ModuleManager interface bumps of a stubbed preview", () => {
  cleanupProjects();

  it("shares the highest copy every range admits when it is a preview", async () => {
    const { folder, conflicts, bumps, sharedRoot } = await plan(
      [
        { name: "app", range: ">=0.5.1 <0.6.0", copy: "0.5.1", optional: true },
        {
          name: "cms",
          range: ">=0.5.1 <0.6.0",
          copy: "0.5.2-next.113.g5abe1f0",
          optional: true,
        },
      ],
      ["cms"],
    );

    expect(sharedRoot).to.equal(
      path.join(folder, "modules", "cms", "node_modules", INCIDENT_INTERFACE),
    );
    expect(conflicts).to.deep.equal([]);
    expect(bumps).to.deep.equal([
      {
        kind: "range",
        moduleId: "app",
        packageName: INCIDENT_INTERFACE,
        current: "0.5.1",
        target: "0.5.2-next.113.g5abe1f0",
        requiredBy: [],
        required: false,
        folder: path.join(folder, "modules", "app"),
        field: "optionalDependencies",
        from: ">=0.5.1 <0.6.0",
        to: "0.5.2-next.113.g5abe1f0",
      },
    ]);
  });
});

describe("ModuleManager interface bumps of @antelopejs/interface-core", () => {
  cleanupProjects();

  const INTERFACE_CORE = "@antelopejs/interface-core";
  const coreCopy = resolvePackage(INTERFACE_CORE, __dirname)?.version ?? "";

  it("never raises a module past the copy the running core implements", async () => {
    const { bumps } = await plan(
      [
        {
          name: "app",
          range: `>=${coreCopy} <1.0.0`,
          copy: coreCopy,
          optional: true,
        },
        {
          name: "cms",
          range: `>=${coreCopy} <1.0.0`,
          copy: `${inc(coreCopy, "patch")}-next.121.g0d40689`,
          optional: true,
        },
      ],
      ["cms"],
      INTERFACE_CORE,
    );

    expect(bumps).to.deep.equal([]);
  });

  it("raises a module older than the core's copy to that copy", async () => {
    const older = "0.0.1";
    const { bumps } = await plan(
      [
        {
          name: "app",
          range: `>=${older} <1.0.0`,
          copy: older,
          optional: true,
        },
        {
          name: "cms",
          range: `>=${older} <1.0.0`,
          copy: `${inc(coreCopy, "patch")}-next.121.g0d40689`,
          optional: true,
        },
      ],
      ["cms"],
      INTERFACE_CORE,
    );

    expect(bumps.map((bump) => [bump.moduleId, bump.target])).to.deep.equal([
      ["app", coreCopy],
    ]);
  });
});

describe("ModuleManager interface bumps of an implemented interface", () => {
  cleanupProjects();

  it("resolves the npm implementation again when its recorded copy is older than a project floor", async () => {
    const { conflicts, bumps } = await plan(
      [
        { name: "app", range: ">=0.3.1 <1.0.0", copy: "0.3.1" },
        {
          name: "mongodb",
          range: ">=0.3.0 <0.4.0",
          copy: "0.3.0",
          implementsInterface: true,
        },
      ],
      ["mongodb"],
    );

    expect(conflicts.map(({ moduleId }) => moduleId)).to.deep.equal(["app"]);
    expect(bumps).to.deep.equal([
      {
        kind: "relock",
        moduleId: "mongodb",
        packageName: INCIDENT_INTERFACE,
        current: "0.3.0",
        target: "0.3.1",
        requiredBy: ["app@1.0.0"],
        required: true,
        source: npmSource("mongodb"),
      },
    ]);
  });

  it("raises the range of a local implementation whose copy is older than a project floor", async () => {
    const { bumps } = await plan(
      [
        { name: "app", range: ">=0.3.1 <1.0.0", copy: "0.3.1" },
        {
          name: "mongodb",
          range: ">=0.3.0 <0.4.0",
          copy: "0.3.0",
          implementsInterface: true,
        },
      ],
      [],
    );

    expect(
      bumps.map((bump) =>
        bump.kind === "range"
          ? [bump.moduleId, bump.from, bump.to, bump.required]
          : [bump.kind],
      ),
    ).to.deep.equal([["mongodb", ">=0.3.0 <0.4.0", ">=0.3.1 <0.4.0", true]]);
  });

  it("lists no bump when no installed copy satisfies every range", async () => {
    const { conflicts, bumps } = await plan(
      [
        { name: "app", range: ">=0.4.0 <1.0.0", copy: "0.4.0" },
        {
          name: "mongodb",
          range: ">=0.3.0 <0.4.0",
          copy: "0.3.0",
          implementsInterface: true,
        },
      ],
      ["mongodb"],
    );

    expect(conflicts.map(({ moduleId }) => moduleId)).to.deep.equal(["app"]);
    expect(bumps).to.deep.equal([]);
  });

  it("leaves a local module whose spec has no floor to raise, such as an npm alias", async () => {
    const { bumps } = await plan(
      [
        {
          name: "app",
          range: "npm:@test-scope/interface-auth-fork@^0.1.8",
          copy: "0.1.8",
          optional: true,
        },
        { name: "cms", range: ">=0.1.9 <1.0.0", copy: "0.1.9", optional: true },
      ],
      ["cms"],
    );

    expect(bumps).to.deep.equal([]);
  });

  it("leaves an npm module that is not the provider on its own copy", async () => {
    const { bumps } = await plan(
      [
        { name: "app", range: "^0.1.9", copy: "0.1.9", optional: true },
        { name: "cms", range: ">=0.1.8 <1.0.0", copy: "0.1.8", optional: true },
      ],
      ["cms"],
    );

    expect(bumps).to.deep.equal([]);
  });
});

describe("raiseRangeFloor", () => {
  const cases: Array<[string, string, string | undefined]> = [
    [">=0.3.0 <0.4.0", "0.3.1", ">=0.3.1 <0.4.0"],
    [">=0.1.8", "0.1.9", ">=0.1.9"],
    ["^0.1.8", "0.1.9", "^0.1.9"],
    ["~1.2.0", "1.2.3", "~1.2.3"],
    ["0.1.8", "0.1.9", "0.1.9"],
    ["^0.4.3", "0.4.4-next.121.g5d83533", "0.4.4-next.121.g5d83533"],
    ["~0.4.3", "0.4.4-next.1", "0.4.4-next.1"],
    [">=0.4.3 <0.5.0", "0.4.4-next.1", "0.4.4-next.1"],
    ["0.4.4-next.1", "0.4.4-next.2", "0.4.4-next.2"],
    ["workspace:^0.4.3", "0.4.4-next.1", undefined],
    ["0.1.x || 0.2.x", "0.2.1", undefined],
    ["npm:@other-scope/auth-fork@^0.1.8", "0.1.9", undefined],
    ["workspace:*", "0.1.9", undefined],
    ["file:../interface", "0.1.9", undefined],
    ["latest", "0.1.9", undefined],
    [">=next", "0.1.9", undefined],
  ];

  for (const [range, version, expected] of cases) {
    it(`raises ${range} to ${expected ?? "nothing"} for ${version}`, () => {
      expect(raiseRangeFloor(range, version)).to.equal(expected);
    });
  }
});
