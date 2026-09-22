import { expect } from "chai";

import { ConfigVarStore } from "../../../src/core/config/config-var-store";

describe("ConfigVarStore", () => {
  let store: ConfigVarStore;

  beforeEach(() => {
    store = new ConfigVarStore();
  });

  it("substitutes published values into a consumer configuration", () => {
    store.record("api", ["API_PORT"], { API_PORT: 5010 });

    const resolved = store.resolve("dms", {
      servers: [{ url: "http://127.0.0.1:${@api.API_PORT}" }],
      port: "${@api.API_PORT}",
    });

    expect(resolved).to.deep.equal({
      servers: [{ url: "http://127.0.0.1:5010" }],
      port: 5010,
    });
  });

  it("accepts a module that publishes nothing", () => {
    store.record("mailer", [], undefined);

    expect(store.resolve("mailer", { from: "root" })).to.deep.equal({
      from: "root",
    });
  });

  it("rejects a declared variable the provide callback did not return", () => {
    expect(() =>
      store.record("api", ["API_PORT", "API_HOST"], { API_PORT: 5010 }),
    ).to.throw(
      "Module 'api' declares the config variable(s) 'API_HOST' in antelopeJs.configVars but its provide callback did not return them.",
    );
  });

  it("rejects an unresolved reference instead of substituting an empty string", () => {
    expect(() => store.resolve("dms", { url: "${@api.API_PORT}" })).to.throw(
      "Module 'dms' references '${@api.API_PORT}', but its expected provider 'api' published no config variable 'API_PORT'.",
    );
  });

  it("forgets every published value once cleared", () => {
    store.record("api", ["API_PORT"], { API_PORT: 5010 });
    store.clear();

    expect(() => store.resolve("dms", "${@api.API_PORT}")).to.throw(
      "published no config variable",
    );
  });
});
