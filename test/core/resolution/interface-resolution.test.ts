import path from "node:path";
import { expect } from "chai";
import {
  findUnresolvedInterfaces,
  type InterfaceConsumer,
  type InterfaceProvider,
} from "../../../src/core/resolution/interface-resolution";

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
