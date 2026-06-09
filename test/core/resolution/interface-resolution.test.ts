import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect } from "chai";
import {
  findUnresolvedInterfaces,
  type InterfaceConsumer,
  type InterfaceProvider,
} from "../../../src/core/resolution/interface-resolution";
import { cleanupTempDir, makeTempDir } from "../../helpers/temp";

const CORE_INTERFACE_PKG = "@antelopejs/interface-core";
const CONSUMER_FOLDER = path.resolve(__dirname, "..", "..", "..");

describe("findUnresolvedInterfaces", () => {
  it("places missing required deps into unresolved", () => {
    const providers: InterfaceProvider[] = [];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: CONSUMER_FOLDER,
        dependencies: { [CORE_INTERFACE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers);

    expect(result.unresolved).to.have.lengthOf(1);
    expect(result.unresolved[0]).to.deep.equal({
      moduleId: "consumer",
      interfacePackage: CORE_INTERFACE_PKG,
    });
    expect(result.stubbed).to.have.lengthOf(0);
  });

  it("places missing optional deps into stubbed, not unresolved", () => {
    const providers: InterfaceProvider[] = [];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: CONSUMER_FOLDER,
        dependencies: {},
        optionalDependencies: { [CORE_INTERFACE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.have.lengthOf(1);
    expect(result.stubbed[0]).to.deep.equal({
      moduleId: "consumer",
      interfacePackage: CORE_INTERFACE_PKG,
      standalone: false,
    });
  });

  it("ignores deps that are not interface packages", () => {
    const providers: InterfaceProvider[] = [];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: CONSUMER_FOLDER,
        dependencies: { chai: "*" },
        optionalDependencies: { mocha: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.have.lengthOf(0);
  });

  it("skips deps that are implemented by a provider", () => {
    const providers: InterfaceProvider[] = [
      { implements: [CORE_INTERFACE_PKG] },
    ];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: CONSUMER_FOLDER,
        dependencies: { [CORE_INTERFACE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.have.lengthOf(0);
  });

  it("treats interface as missing when provider has disabled it", () => {
    const providers: InterfaceProvider[] = [
      {
        implements: [CORE_INTERFACE_PKG],
        disabledExports: new Set([CORE_INTERFACE_PKG]),
      },
    ];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: CONSUMER_FOLDER,
        dependencies: {},
        optionalDependencies: { [CORE_INTERFACE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.have.lengthOf(1);
  });

  it("honors knownResolved as already-implemented", () => {
    const providers: InterfaceProvider[] = [];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: CONSUMER_FOLDER,
        dependencies: { [CORE_INTERFACE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers, [
      CORE_INTERFACE_PKG,
    ]);

    expect(result.unresolved).to.have.lengthOf(0);
  });
});

describe("findUnresolvedInterfaces (standalone interfaces)", () => {
  const STANDALONE_PKG = "@antelopejs/interface-standalone-fixture";
  const PLAIN_PKG = "@antelopejs/interface-plain-fixture";
  let consumerFolder: string;

  function writeInterfacePackage(
    root: string,
    name: string,
    antelopeJs: Record<string, unknown>,
  ): void {
    const dir = path.join(root, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name, version: "1.0.0", main: "index.js", antelopeJs }),
    );
    writeFileSync(path.join(dir, "index.js"), "module.exports = {};");
  }

  beforeEach(() => {
    consumerFolder = makeTempDir("ajs-iface-standalone-");
    writeInterfacePackage(consumerFolder, STANDALONE_PKG, { standalone: true });
    writeInterfacePackage(consumerFolder, PLAIN_PKG, {});
  });

  afterEach(() => {
    cleanupTempDir(consumerFolder);
  });

  it("routes a missing standalone required dep into stubbed, not unresolved", () => {
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: consumerFolder,
        dependencies: { [STANDALONE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces([], consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.deep.equal([
      {
        moduleId: "consumer",
        interfacePackage: STANDALONE_PKG,
        standalone: true,
      },
    ]);
  });

  it("still errors (unresolved) for a missing non-standalone required dep", () => {
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: consumerFolder,
        dependencies: { [PLAIN_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces([], consumers);

    expect(result.stubbed).to.have.lengthOf(0);
    expect(result.unresolved).to.deep.equal([
      { moduleId: "consumer", interfacePackage: PLAIN_PKG },
    ]);
  });

  it("lets an implementing module win over standalone self-hosting", () => {
    const providers: InterfaceProvider[] = [{ implements: [STANDALONE_PKG] }];
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: consumerFolder,
        dependencies: { [STANDALONE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces(providers, consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.have.lengthOf(0);
  });

  it("marks a missing standalone optional dep as standalone in stubbed", () => {
    const consumers: InterfaceConsumer[] = [
      {
        id: "consumer",
        folder: consumerFolder,
        dependencies: {},
        optionalDependencies: { [STANDALONE_PKG]: "*" },
      },
    ];

    const result = findUnresolvedInterfaces([], consumers);

    expect(result.unresolved).to.have.lengthOf(0);
    expect(result.stubbed).to.deep.equal([
      {
        moduleId: "consumer",
        interfacePackage: STANDALONE_PKG,
        standalone: true,
      },
    ]);
  });
});
