import type {
  AntelopeModuleConfig,
  ModuleSourcePackage,
} from "@antelopejs/interface-core/config";
import { expect } from "chai";

import { ConfigParser, type ProjectConfig } from "../../../src/core/config";

const ALLOWED_ORIGIN = /^https:\/\/[^/]+\.example\.dev$/;

function projectConfig(): ProjectConfig {
  const source: ModuleSourcePackage = {
    type: "package",
    package: "api",
    version: "1.0.0",
  };
  return {
    name: "app",
    modules: {
      api: {
        source,
        config: {
          cors: { allowedOrigins: [ALLOWED_ORIGIN] },
          database: { host: "localhost" },
          api: { key: "default" },
          auth: { key: "default" },
        },
        importOverrides: [],
        disabledExports: [],
      },
    },
  };
}

{
  let registerConfigParser: (this: Mocha.Suite) => void;

  let parser: ConfigParser;

  let registerProcessTemplates: (this: Mocha.Suite) => void;
  {
    const checkShouldReplaceSimpleTemplateVariables: (
      this: Mocha.Suite,
    ) => void = function () {
      it("should replace simple template variables", () => {
        const config = {
          name: "my-project",
          path: "${name}/data",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property("path", "my-project/data");
      });

      it("should handle nested templates", () => {
        const config = {
          base: "/home",
          name: "project",
          fullPath: "${base}/${name}/src",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property("fullPath", "/home/project/src");
      });

      it("should process nested objects", () => {
        const config = {
          name: "test",
          nested: {
            value: "${name}-nested",
          },
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property("nested.value", "test-nested");
      });

      it("should process arrays and mixed values", () => {
        const config = {
          name: "demo",
          items: ["${name}", 2, true, { path: "${name}/dir" }],
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.deep.nested.property("items", [
          "demo",
          2,
          true,
          { path: "demo/dir" },
        ]);
      });

      it("should keep unresolved pure templates as-is", () => {
        const config = {
          a: 2,
          b: 3,
          sum: "${Number(a) + Number(b)}",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property(
          "sum",
          "${Number(a) + Number(b)}",
        );
      });

      it("does not execute expressions in pure templates", () => {
        const config = {
          value: "${globalThis.process?.env?.PATH}",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property(
          "value",
          "${globalThis.process?.env?.PATH}",
        );
      });

      it("should parse JSON when pure template matches JSON value", () => {
        const config = {
          payload: '{"enabled":true,"count":2}',
          parsed: "${payload}",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.deep.nested.property("parsed", {
          enabled: true,
          count: 2,
        });
      });

      it("returns original string when expression evaluation fails", () => {
        const config = {
          value: "${invalid+}",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property("value", "${invalid+}");
      });

      it("replaces missing inline template values with empty string", () => {
        const config = {
          value: "hello ${missing}",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property("value", "hello ");
      });

      it("keeps values it cannot rebuild, RegExp included", () => {
        const allowedOrigin = /^https:\/\/[^/]+\.example\.dev$/;
        const createdAt = new Date(0);
        const config = {
          name: "demo",
          cors: { allowedOrigins: [allowedOrigin] },
          createdAt,
          label: "${name}",
        };

        const result = parser.processTemplates(config);

        expect(result).to.have.nested.property(
          "cors.allowedOrigins[0]",
          allowedOrigin,
        );
        expect(result).to.have.nested.property("createdAt", createdAt);
        expect(result).to.have.nested.property("label", "demo");
      });
    };

    const checkLeavesAConfigVariableReference: (this: Mocha.Suite) => void =
      function () {
        it("leaves a config variable reference verbatim", () => {
          const config = {
            port: 3000,
            apiBaseUrl: "http://127.0.0.1:${@api.API_PORT}",
            rawPort: "${@api.API_PORT}",
            servers: [{ url: "http://${host}:${@api.API_PORT}" }],
            host: "127.0.0.1",
          };

          const result = parser.processTemplates(config);

          expect(result).to.have.nested.property(
            "apiBaseUrl",
            "http://127.0.0.1:${@api.API_PORT}",
          );
          expect(result).to.have.nested.property("rawPort", "${@api.API_PORT}");
          expect(result).to.have.nested.property(
            "servers[0].url",
            "http://127.0.0.1:${@api.API_PORT}",
          );
        });

        it("leaves a reserved token verbatim even when it is malformed", () => {
          const config = {
            value: "${@api}",
          };

          const result = parser.processTemplates(config);

          expect(result).to.have.nested.property("value", "${@api}");
        });
      };

    registerProcessTemplates = () => {
      describe("should replace simple template variables", function () {
        checkShouldReplaceSimpleTemplateVariables.call(this);
      });

      describe("leaves a config variable reference verbatim", function () {
        checkLeavesAConfigVariableReference.call(this);
      });
    };
  }

  let registerApplyEnvOverrides: (this: Mocha.Suite) => void;
  {
    registerApplyEnvOverrides = () => {
      it("keeps values it cannot rebuild while cloning", () => {
        const config = projectConfig();

        const result = parser.applyEnvOverrides(config, {});

        expect(result).to.have.nested.property(
          "modules.api.config.cors.allowedOrigins[0]",
          ALLOWED_ORIGIN,
        );
      });

      it("should override config values from env vars", () => {
        const config = projectConfig();
        const overrides = { DB_HOST: "modules.api.config.database.host" };

        process.env.DB_HOST = "production-db.example.com";

        try {
          const result = parser.applyEnvOverrides(config, overrides);
          expect(result).to.have.nested.property(
            "modules.api.config.database.host",
            "production-db.example.com",
          );
        } finally {
          delete process.env.DB_HOST;
        }
      });

      it("should handle array of paths", () => {
        const config = projectConfig();
        const overrides = {
          API_KEY: [
            "modules.api.config.api.key",
            "modules.api.config.auth.key",
          ],
        };

        process.env.API_KEY = "secret-key";

        try {
          const result = parser.applyEnvOverrides(config, overrides);
          expect(result).to.have.nested.property(
            "modules.api.config.api.key",
            "secret-key",
          );
          expect(result).to.have.nested.property(
            "modules.api.config.auth.key",
            "secret-key",
          );
        } finally {
          delete process.env.API_KEY;
        }
      });

      it("should ignore overrides when env var is missing", () => {
        const config = projectConfig();
        const overrides = { API_KEY: "modules.api.config.api.key" };

        const result = parser.applyEnvOverrides(config, overrides);

        expect(result).to.have.nested.property(
          "modules.api.config.api.key",
          "default",
        );
        expect(result).to.not.equal(config);
      });
    };
  }

  let registerExpandModuleShorthand: (this: Mocha.Suite) => void;
  {
    registerExpandModuleShorthand = () => {
      it("should expand version string to full source", () => {
        const modules = {
          "my-module": "1.0.0",
        };

        const result = parser.expandModuleShorthand(modules);

        expect(result["my-module"]).to.deep.equal({
          source: { type: "package", package: "my-module", version: "1.0.0" },
          config: {},
          importOverrides: [],
          disabledExports: [],
        });
      });

      it("should expand object shorthand with version and overrides", () => {
        const modules = {
          mod: {
            version: "2.0.0",
            config: { enabled: true },
            importOverrides: { "core.logging": "github:repo/core" },
            disabledExports: ["legacy"],
          },
        } satisfies Record<string, AntelopeModuleConfig>;

        const result = parser.expandModuleShorthand(modules);

        expect(result).to.have.deep.nested.property("mod", {
          source: { type: "package", package: "mod", version: "2.0.0" },
          config: { enabled: true },
          importOverrides: [
            { interface: "core.logging", source: "github:repo/core" },
          ],
          disabledExports: ["legacy"],
        });
      });

      it("should keep importOverrides array as-is", () => {
        const modules = {
          mod: {
            source: { type: "git", remote: "git://example.com/mod.git" },
            importOverrides: [{ interface: "core", source: "local" }],
          },
        } satisfies Record<string, AntelopeModuleConfig>;

        const result = parser.expandModuleShorthand(modules);

        expect(result).to.have.deep.nested.property("mod.importOverrides", [
          { interface: "core", source: "local" },
        ]);
        expect(result).to.have.deep.nested.property("mod.disabledExports", []);
      });

      it("keeps an import override without a source, the declared connection to a self-hosted interface", () => {
        const result = parser.expandModuleShorthand({
          mod: {
            version: "1.0.0",
            importOverrides: [{ interface: "data-api", id: "client" }],
          },
        });

        expect(result).to.have.deep.nested.property("mod.importOverrides", [
          { interface: "data-api", id: "client" },
        ]);
      });

      it("reads a module's export priorities", () => {
        const result = parser.expandModuleShorthand({
          mongodb: { version: "1.0.0", exportPriority: { database: 1 } },
        });

        expect(result).to.have.deep.nested.property("mongodb.exportPriority", {
          database: 1,
        });
      });

      it("rejects an export priority that is not an integer", () => {
        expect(() =>
          parser.expandModuleShorthand({
            mongodb: { version: "1.0.0", exportPriority: { database: 0.5 } },
          }),
        ).to.throw(
          "Module 'mongodb' gives 'database' the export priority 0.5; priorities are integers.",
        );
      });
    };
  }

  registerConfigParser = () => {
    beforeEach(() => {
      parser = new ConfigParser();
    });
    describe("processTemplates", function () {
      registerProcessTemplates.call(this);
    });
    describe("applyEnvOverrides", function () {
      registerApplyEnvOverrides.call(this);
    });
    describe("expandModuleShorthand", function () {
      registerExpandModuleShorthand.call(this);
    });
  };

  describe("ConfigParser", function () {
    registerConfigParser.call(this);
  });
}

describe("ConfigParser templates named like Object.prototype members", () => {
  const parser = new ConfigParser();

  it("treats a template named like an Object.prototype member as missing", () => {
    const config = {
      pure: "${constructor}",
      inline: "a ${toString} b",
      proto: "${__proto__}",
    };

    const result = parser.processTemplates(config);

    expect(result).to.deep.equal({
      pure: "${constructor}",
      inline: "a  b",
      proto: "${__proto__}",
    });
  });

  it("resolves a template whose key is named like an Object.prototype member", () => {
    const config = {
      constructor: "mine",
      toString: '{"ok":true}',
      a: "${constructor}",
      b: "x ${toString}",
      c: "${toString}",
      ["__proto__"]: "own",
      d: "${__proto__}",
    };

    const result = parser.processTemplates(config);

    expect(result).to.have.nested.property("a", "mine");
    expect(result).to.have.nested.property("b", 'x {"ok":true}');
    expect(result).to.have.deep.nested.property("c", { ok: true });
    expect(result).to.have.nested.property("d", "own");
  });

  it("keeps an own __proto__ key of a parsed module file as an own key", () => {
    const parsed: unknown = JSON.parse(
      '{"__proto__":{"label":"${name}"},"name":"shop"}',
    );

    const templated = parser.processTemplates(parsed);
    const project = projectConfig();
    project.modules.api.config = parsed;
    const cloned = parser.applyEnvOverrides(project, {});

    expect(
      Object.getOwnPropertyDescriptor(templated, "__proto__")?.value,
    ).to.deep.equal({ label: "shop" });
    expect(Object.getPrototypeOf(templated)).to.equal(Object.prototype);
    expect(cloned).to.have.deep.nested.property("modules.api.config", parsed);
    expect(cloned).to.have.nested.property("modules.api.config.name", "shop");
  });
});
