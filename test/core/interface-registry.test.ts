import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { InterfaceRegistry } from "../../src/core/interface-registry";

describe("InterfaceRegistry", () => {
  beforeEach(() => {
    for (const key of Object.keys(internal.interfaceConnections)) {
      delete internal.interfaceConnections[key];
    }
  });

  it("should map interface connections for a module", () => {
    const registry = new InterfaceRegistry();

    const connections = new Map<
      string,
      Array<{ module: string; id?: string }>
    >();
    connections.set("core@beta", [
      { module: "modA" },
      { module: "modB", id: "x" },
    ]);

    registry.setConnections(
      "consumer",
      connections,
      new Map([["core@beta", "modA"]]),
    );

    expect(internal.interfaceConnections.consumer["core@beta"]).to.deep.equal([
      {
        path: "core@beta",
        provider: "modA",
        selected: true,
      },
      {
        path: "core@beta",
        id: "x",
        provider: "modB",
        selected: false,
      },
    ]);
  });
});
