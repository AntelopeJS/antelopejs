import path from "node:path";
import { expect } from "chai";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import * as interfaceCore from "@antelopejs/interface-core";
import * as interfaceModules from "@antelopejs/interface-core/modules";

import { Resolver } from "../../../src/core/modules/resolver";
import { PathMapper } from "../../../src/core/modules/path-mapper";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";
import { buildBindingGraph } from "../../../src/core/resolution/binding-graph";
import type {
  BindingGraph,
  BindingModule,
} from "../../../src/core/resolution/binding-graph-types";

interface TestGlobals {
  [STATE_KEY]?: InstanceState;
}
const testGlobals: typeof globalThis & TestGlobals = globalThis;

const STATE_KEY = "__resolverInterfaceContextState";
const INTERFACE = "@resolver/interface-context";
const PROVIDER_A = "provider-a";
const PROVIDER_B = "provider-b";
const INSTANCE_A = `${INTERFACE}@${PROVIDER_A}`;
const INSTANCE_B = `${INTERFACE}@${PROVIDER_B}`;
const INSTANCE_A_OWNER = `${INSTANCE_A}#instance`;

type Register = (id: string) => void;

interface LoadRecord {
  module?: string;
  owner?: string;
  kind?: string;
}

interface InstanceExports {
  Forward: interfaceCore.RegisteringProxy<Register>;
}

interface InstanceState {
  core: typeof interfaceCore;
  modules: typeof interfaceModules;
  loads: LoadRecord[];
  exports: InstanceExports[];
  probes: Array<() => Promise<string | undefined>>;
  own: interfaceCore.RegisteringProxy<Register>;
  forwardTarget: interfaceCore.RegisteringProxy<Register>;
}

interface ContextFixture {
  root: string;
  resolver: Resolver;
  state: InstanceState;
  ownEntries: Set<string>;
  forwarded: Set<string>;
}

const INTERFACE_SOURCE = `
const state = global[${JSON.stringify(STATE_KEY)}];
const context = state.modules.GetModuleContext();
state.loads.push({ module: context?.module, owner: context?.owner, kind: context?.kind });
state.own.register("own:" + state.loads.length);
exports.Forward = new state.core.RegisteringProxy();
exports.Forward.onHandlers(
  (id) => state.forwardTarget.register(id),
  (id) => state.forwardTarget.unregister(id),
);
let release;
const gate = new Promise((resolve) => { release = resolve; });
const probe = gate.then(() => state.modules.GetModuleContext()?.owner);
state.probes.push(() => { release(); return probe; });
state.exports.push(exports);
`;

function writeFile(file: string, content: string): void {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
}

function bindingModule(
  id: string,
  spec: Partial<Omit<BindingModule, "id">>,
): [string, BindingModule] {
  return [
    id,
    {
      id,
      implements: spec.implements ?? [],
      uses: spec.uses ?? [],
      connections: spec.connections ?? new Map(),
      exportPriority: new Map(),
    },
  ];
}

function consumerOf(id: string, provider: string): [string, BindingModule] {
  return bindingModule(id, {
    uses: [INTERFACE],
    connections: new Map([[INTERFACE, [{ source: provider }]]]),
  });
}

function graphFor(providers: string[]): BindingGraph {
  return buildBindingGraph({
    interfaces: new Map([[INTERFACE, { name: INTERFACE, dependencies: [] }]]),
    modules: new Map(
      providers.flatMap((provider) => [
        bindingModule(provider, { implements: [INTERFACE] }),
        consumerOf(`consumer-of-${provider}`, provider),
      ]),
    ),
  });
}

function inModule<T>(module: string, owner: string, callback: () => T): T {
  return interfaceModules.RunWithModuleContext({ module, owner }, callback);
}

function attachTarget(
  proxy: interfaceCore.RegisteringProxy<Register>,
): Set<string> {
  const entries = new Set<string>();
  inModule("target", "target#1", () =>
    proxy.onHandlers(
      (id) => entries.add(id),
      (id) => entries.delete(id),
    ),
  );
  return entries;
}

function createState(): InstanceState {
  return {
    core: interfaceCore,
    modules: interfaceModules,
    loads: [],
    exports: [],
    probes: [],
    own: new interfaceCore.RegisteringProxy<Register>(),
    forwardTarget: new interfaceCore.RegisteringProxy<Register>(),
  };
}

function createFixture(): ContextFixture {
  const root = makeTempDir("ajs-resolver-interface-context-");
  const packageRoot = path.join(root, "node_modules", ...INTERFACE.split("/"));
  writeFile(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ name: INTERFACE, version: "1.0.0", main: "index.js" }),
  );
  writeFile(path.join(packageRoot, "index.js"), INTERFACE_SOURCE);
  const resolver = new Resolver(new PathMapper(() => false));
  resolver.interfacePackages.set(INTERFACE, packageRoot);
  resolver.interfacePackageEntries.set(
    INTERFACE,
    path.join(packageRoot, "index.js"),
  );
  resolver.interfacePackageResolveFrom.set(INTERFACE, root);
  resolver.setBindings(graphFor([PROVIDER_A, PROVIDER_B]));
  const state = createState();
  testGlobals[STATE_KEY] = state;
  return {
    root,
    resolver,
    state,
    ownEntries: attachTarget(state.own),
    forwarded: attachTarget(state.forwardTarget),
  };
}

function outcomeOf<T>(promise: Promise<T>): Promise<T | Error> {
  return promise.then(
    (value) => value,
    (error) => {
      assert.ok(error instanceof Error);
      return error;
    },
  );
}

describe("Resolver interface contexts", () => {
  let fixture: ContextFixture;

  beforeEach(() => {
    fixture = createFixture();
  });

  afterEach(() => {
    fixture.resolver.releaseInstances();
    delete testGlobals[STATE_KEY];
    cleanupTempDir(fixture.root);
  });

  it("evaluates an instance in an interface context named after the package, owned by the instance", () => {
    fixture.resolver.loadInstance(INSTANCE_A);

    expect(fixture.state.loads).to.deep.equal([
      { module: INTERFACE, owner: INSTANCE_A_OWNER, kind: "interface" },
    ]);
    expect([...fixture.ownEntries]).to.deep.equal(["own:1"]);
  });

  it("forwards a module's registration through the instance as that module's", () => {
    fixture.resolver.loadInstance(INSTANCE_A);
    const [instance] = fixture.state.exports;

    inModule("consumer-of-provider-a", "consumer#1", () =>
      instance.Forward.register("from-consumer"),
    );
    expect([...fixture.forwarded]).to.deep.equal(["from-consumer"]);
    inModule("consumer-of-provider-a", "consumer#1", () =>
      interfaceModules.Events.ModuleDestroyed.emit("consumer-of-provider-a"),
    );

    expect([...fixture.forwarded]).to.deep.equal([]);
  });

  it("resolves an unowned file's interface request in the instance whose context runs it", () => {
    const elsewhere = { filename: path.join(fixture.root, "elsewhere.js") };

    const resolved = interfaceModules.RunWithModuleContext(
      {
        module: INTERFACE,
        owner: `${INSTANCE_B}#instance`,
        kind: "interface",
      },
      () => ({
        owns: fixture.resolver.ownsResolutionContext(INTERFACE, elsewhere),
        instance: fixture.resolver.resolve(INTERFACE, elsewhere)?.instance,
      }),
    );

    expect(resolved).to.deep.equal({ owns: true, instance: INSTANCE_B });
  });

  describe("an instance retired and bound again", () => {
    it("releases the first evaluation's own work, and leaves what modules forwarded through it", () => {
      fixture.resolver.loadInstance(INSTANCE_A);
      const [first] = fixture.state.exports;
      inModule("consumer-of-provider-a", "consumer#2", () =>
        first.Forward.register("from-consumer"),
      );

      fixture.resolver.setBindings(graphFor([PROVIDER_B]));

      expect([...fixture.ownEntries]).to.deep.equal([]);
      expect([...fixture.forwarded]).to.deep.equal(["from-consumer"]);
    });

    it("evaluates the instance afresh under the same owner, which attaches, registers and releases again", () => {
      fixture.resolver.loadInstance(INSTANCE_A);
      fixture.resolver.setBindings(graphFor([PROVIDER_B]));

      fixture.resolver.setBindings(graphFor([PROVIDER_A, PROVIDER_B]));
      fixture.resolver.loadInstance(INSTANCE_A);
      const [, second] = fixture.state.exports;
      inModule("consumer-of-provider-a", "consumer#3", () =>
        second.Forward.register("from-consumer"),
      );

      expect(fixture.state.loads.map(({ owner }) => owner)).to.deep.equal([
        INSTANCE_A_OWNER,
        INSTANCE_A_OWNER,
      ]);
      expect([...fixture.ownEntries]).to.deep.equal(["own:2"]);
      expect([...fixture.forwarded]).to.deep.equal(["from-consumer"]);

      fixture.resolver.setBindings(graphFor([PROVIDER_B]));

      expect([...fixture.ownEntries]).to.deep.equal([]);
      expect([...fixture.forwarded]).to.deep.equal(["from-consumer"]);
    });

    it("fences work left from the first evaluation once the instance is back, and keeps the second's alive", async () => {
      fixture.resolver.loadInstance(INSTANCE_A);
      fixture.resolver.setBindings(graphFor([PROVIDER_B]));
      fixture.resolver.setBindings(graphFor([PROVIDER_A, PROVIDER_B]));
      fixture.resolver.loadInstance(INSTANCE_A);
      const [firstProbe, secondProbe] = fixture.state.probes;

      expect(await outcomeOf(firstProbe())).to.be.instanceOf(
        interfaceCore.ModuleContextInvalidatedError,
      );
      expect(await secondProbe()).to.equal(INSTANCE_A_OWNER);
    });

    it("leaves a module holding the first evaluation's exports with a detached proxy", () => {
      fixture.resolver.loadInstance(INSTANCE_A);
      fixture.resolver.setBindings(graphFor([PROVIDER_B]));
      fixture.resolver.setBindings(graphFor([PROVIDER_A, PROVIDER_B]));
      fixture.resolver.loadInstance(INSTANCE_A);
      const [first] = fixture.state.exports;

      inModule("holder", "holder#1", () => first.Forward.register("stale"));

      expect([...fixture.forwarded]).to.deep.equal([]);
    });
  });
});
