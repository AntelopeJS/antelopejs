import { expect } from "chai";

import {
  declaredConfigVars,
  isConfigVarKey,
  scanConfigVars,
  substituteConfigVars,
} from "../../../src/core/config/config-vars";

const lookup = () => 5010;

describe("config vars", () => {
  describe("scanConfigVars", () => {
    it("collects references at any depth, including inside arrays", () => {
      const scan = scanConfigVars({
        servers: [{ url: "http://127.0.0.1:${@api.API_PORT}" }],
        nested: { deep: { host: "${@api.API_HOST}" } },
      });

      expect(scan.references).to.deep.equal([
        {
          token: "${@api.API_PORT}",
          module: "api",
          variable: "API_PORT",
        },
        {
          token: "${@api.API_HOST}",
          module: "api",
          variable: "API_HOST",
        },
      ]);
      expect(scan.malformed).to.deep.equal([]);
    });

    it("reads a module name that carries dots", () => {
      const scan = scanConfigVars("${@my.api.module.API_PORT}");

      expect(scan.references[0]).to.deep.include({
        module: "my.api.module",
        variable: "API_PORT",
      });
    });

    it("ignores the legacy template namespace", () => {
      const scan = scanConfigVars({
        url: "${host}:${modules.api.config.port}",
      });

      expect(scan.references).to.deep.equal([]);
      expect(scan.malformed).to.deep.equal([]);
    });

    it("reports a reserved token that is not a valid reference", () => {
      const scan = scanConfigVars({ url: "${@api}" });

      expect(scan.malformed).to.deep.equal(["${@api}"]);
    });
  });

  describe("substituteConfigVars", () => {
    it("keeps the value type when the whole string is a reference", () => {
      const result = substituteConfigVars({ port: "${@api.API_PORT}" }, lookup);

      expect(result).to.deep.equal({ port: 5010 });
    });

    it("interpolates a reference embedded in a larger string", () => {
      const result = substituteConfigVars(
        "http://127.0.0.1:${@api.API_PORT}/v1",
        lookup,
      );

      expect(result).to.equal("http://127.0.0.1:5010/v1");
    });

    it("substitutes inside arrays and leaves other values untouched", () => {
      const result = substituteConfigVars(
        {
          servers: [{ port: "${@api.API_PORT}" }, { port: 1234 }],
          flag: true,
          legacy: "${host}",
        },
        lookup,
      );

      expect(result).to.deep.equal({
        servers: [{ port: 5010 }, { port: 1234 }],
        flag: true,
        legacy: "${host}",
      });
    });
  });

  describe("substituteConfigVars, values it must not rebuild", () => {
    it("passes a RegExp through untouched", () => {
      const allowedOrigin = /^https:\/\/[^/]+\.example\.dev$/;
      const config = {
        cors: { allowedOrigins: [allowedOrigin, "http://localhost"] },
        port: "${@api.API_PORT}",
      };

      const result = substituteConfigVars(config, lookup) as typeof config;

      expect(result.cors.allowedOrigins[0]).to.equal(allowedOrigin);
      expect(result.cors.allowedOrigins[0]).to.be.instanceOf(RegExp);
      expect(
        (result.cors.allowedOrigins[0] as RegExp).test(
          "https://app.example.dev",
        ),
      ).to.equal(true);
      expect(result.port).to.equal(5010);
    });

    it("passes other non-plain values through by identity", () => {
      const date = new Date(0);
      const map = new Map([["key", "value"]]);
      const set = new Set([1, 2]);
      const buffer = Buffer.from("payload");
      class Credentials {
        constructor(public readonly token: string) {}
      }
      const credentials = new Credentials("secret");
      const nullPrototype = Object.assign(Object.create(null), { keep: true });
      const config = {
        date,
        map,
        set,
        buffer,
        credentials,
        nullPrototype,
        url: "http://127.0.0.1:${@api.API_PORT}",
      };

      const result = substituteConfigVars(config, lookup) as typeof config;

      expect(result.date).to.equal(date);
      expect(result.map).to.equal(map);
      expect(result.set).to.equal(set);
      expect(result.buffer).to.equal(buffer);
      expect(result.credentials).to.equal(credentials);
      expect(result.nullPrototype).to.equal(nullPrototype);
      expect(result.url).to.equal("http://127.0.0.1:5010");
    });

    it("returns a configuration holding no reference by identity", () => {
      const nested = { deep: [1, { flag: true }] };
      const config = { nested, legacy: "${host}", pattern: /abc/ };

      const result = substituteConfigVars(config, lookup);

      expect(result).to.equal(config);
      expect((result as typeof config).nested).to.equal(nested);
    });

    it("rebuilds only the branch that holds a reference", () => {
      const untouched = { host: "127.0.0.1" };
      const config = {
        untouched,
        touched: { port: "${@api.API_PORT}" },
      };

      const result = substituteConfigVars(config, lookup) as typeof config;

      expect(result).to.not.equal(config);
      expect(result.untouched).to.equal(untouched);
      expect(result.touched).to.not.equal(config.touched);
    });
  });

  describe("declaredConfigVars", () => {
    it("reads the names declared in the module manifest", () => {
      const declared = declaredConfigVars({
        manifest: { antelopeJs: { configVars: ["API_PORT"] } },
      });

      expect(declared).to.deep.equal(["API_PORT"]);
    });

    it("returns an empty list when the module declares nothing", () => {
      expect(declaredConfigVars(undefined)).to.deep.equal([]);
      expect(declaredConfigVars({})).to.deep.equal([]);
      expect(
        declaredConfigVars({ manifest: { antelopeJs: {} } }),
      ).to.deep.equal([]);
    });
  });

  describe("isConfigVarKey", () => {
    it("separates the reserved namespace from the legacy one", () => {
      expect(isConfigVarKey("@api.API_PORT")).to.equal(true);
      expect(isConfigVarKey("modules.api.config.port")).to.equal(false);
    });
  });
});
