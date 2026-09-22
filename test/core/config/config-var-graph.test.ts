import { expect } from "chai";

import { buildConfigVarPlan } from "../../../src/core/config/config-var-graph";

describe("buildConfigVarPlan", () => {
  it("stages providers only, never their consumers", () => {
    const plan = buildConfigVarPlan([
      { id: "api", declared: ["API_PORT"], config: {} },
      { id: "mailer", declared: [], config: { from: "root@localhost" } },
      {
        id: "dms",
        declared: [],
        config: { apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}" },
      },
    ]);

    expect(plan.stages).to.deep.equal([["api"]]);
    expect([...(plan.dependencies.get("dms") ?? [])]).to.deep.equal(["api"]);
    expect([...(plan.dependencies.get("mailer") ?? [])]).to.deep.equal([]);
  });

  it("stages a chain of providers and leaves the consumer out", () => {
    const plan = buildConfigVarPlan([
      { id: "a", declared: ["A"], config: {} },
      { id: "b", declared: ["B"], config: { value: "${@a.A}" } },
      { id: "c", declared: [], config: { value: "${@b.B}" } },
    ]);

    expect(plan.stages).to.deep.equal([["a"], ["b"]]);
  });

  it("stages providers that read no variable together", () => {
    const plan = buildConfigVarPlan([
      { id: "api", declared: ["API_PORT"], config: {} },
      { id: "auth", declared: ["AUTH_SECRET"], config: {} },
    ]);

    expect(plan.stages).to.deep.equal([["api", "auth"]]);
  });

  it("rejects a reference to a module that is not loaded", () => {
    expect(() =>
      buildConfigVarPlan([
        { id: "dms", declared: [], config: { url: "${@api.API_PORT}" } },
      ]),
    ).to.throw(
      "Module 'dms' references '${@api.API_PORT}', but its expected provider 'api' is not a loaded module.",
    );
  });

  it("rejects a reference to a variable the provider never declares", () => {
    expect(() =>
      buildConfigVarPlan([
        { id: "api", declared: ["API_HOST"], config: {} },
        { id: "dms", declared: [], config: { url: "${@api.API_PORT}" } },
      ]),
    ).to.throw(
      "Module 'dms' references '${@api.API_PORT}', but its expected provider 'api' does not declare the config variable 'API_PORT' in antelopeJs.configVars.",
    );
  });

  it("rejects a malformed reserved token", () => {
    expect(() =>
      buildConfigVarPlan([{ id: "dms", declared: [], config: "${@api}" }]),
    ).to.throw("which is not a valid config variable reference");
  });

  it("reports the full cycle", () => {
    expect(() =>
      buildConfigVarPlan([
        {
          id: "api",
          declared: ["API_PORT"],
          config: { url: "${@dms.DMS_URL}" },
        },
        {
          id: "dms",
          declared: ["DMS_URL"],
          config: { url: "${@api.API_PORT}" },
        },
      ]),
    ).to.throw("Config variable cycle detected: api -> dms -> api");
  });

  it("reports a module referencing its own variable as a cycle", () => {
    expect(() =>
      buildConfigVarPlan([
        {
          id: "api",
          declared: ["API_PORT"],
          config: { url: "${@api.API_PORT}" },
        },
      ]),
    ).to.throw("Config variable cycle detected: api -> api");
  });
});
