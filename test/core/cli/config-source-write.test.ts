import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { readConfig, writeConfig } from "../../../src/cli";
import { CliError } from "../../../src/core/output";
import { isString } from "../../../src/utils";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";

const SOURCE = `import { resolve } from "node:path";
import { defineConfig } from "@antelopejs/interface-core/config";

const CLIENT_URL = process.env.CLIENT_URL ?? "http://localhost:3000";

export default defineConfig({
  name: "shop",
  modules: {
    api: { source: { type: "package", package: "api", version: "1.0.0" } },
    web: {
      source: { type: "local", path: "./web" },
      config: { port: Number(process.env.PORT ?? "5010"), clientUrl: CLIENT_URL },
    },
    storage: {
      source: { type: "local", path: "./storage" },
      config: { root: resolve(__dirname, ".antelope/file-storage") },
    },
  },
});
`;

function packageModule(config: AntelopeConfig, id: string) {
  const entry = config.modules?.[id];
  if (isString(entry) || entry?.source?.type !== "package") {
    throw new Error(`${id} is not a package module`);
  }
  return entry.source;
}

function useProject() {
  const project = { folder: "", configPath: "" };

  beforeEach(() => {
    project.folder = makeTempDir("antelopejs-config-write-");
    project.configPath = path.join(project.folder, "antelope.config.ts");
  });

  afterEach(() => {
    cleanupTempDir(project.folder);
  });

  return project;
}

async function writeSourceAndRead(
  project: ReturnType<typeof useProject>,
  source: string,
): Promise<AntelopeConfig> {
  writeFileSync(project.configPath, source);
  const config = await readConfig(project.folder);
  if (!config) {
    throw new Error("config not found");
  }
  return config;
}

describe("writeConfig keeps antelope.config.ts around the values it changes", () => {
  const project = useProject();

  it("changes only the version literal a module update bumps", async () => {
    const config = await writeSourceAndRead(project, SOURCE);
    packageModule(config, "api").version = "2.0.0";

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      SOURCE.replace('version: "1.0.0"', 'version: "2.0.0"'),
    );
  });

  it("keeps the quote style of the version it replaces", async () => {
    const source = SOURCE.replace('version: "1.0.0"', "version: '1.0.0'");
    const config = await writeSourceAndRead(project, source);
    packageModule(config, "api").version = "2.0.0";

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace("version: '1.0.0'", "version: '2.0.0'"),
    );
  });

  it("adds a module after the others and leaves the rest untouched", async () => {
    const config = await writeSourceAndRead(project, SOURCE);
    config.modules = {
      ...config.modules,
      mail: { source: { type: "package", package: "mail", version: "3.1.0" } },
    };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      SOURCE.replace(
        '".antelope/file-storage") },\n    },\n',
        '".antelope/file-storage") },\n    },\n' +
          "    mail: {\n" +
          "      source: {\n" +
          '        type: "package",\n' +
          '        package: "mail",\n' +
          '        version: "3.1.0",\n' +
          "      },\n" +
          "    },\n",
      ),
    );
  });

  it("removes a module and leaves the rest untouched", async () => {
    const config = await writeSourceAndRead(project, SOURCE);
    delete config.modules?.api;

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      SOURCE.replace(
        '    api: { source: { type: "package", package: "api", version: "1.0.0" } },\n',
        "",
      ),
    );
  });

  it("adds a logging section and leaves the rest untouched", async () => {
    const config = await writeSourceAndRead(project, SOURCE);
    config.logging = { enabled: true };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      SOURCE.replace(
        "  },\n});\n",
        "  },\n  logging: {\n    enabled: true,\n  },\n});\n",
      ),
    );
  });
});

describe("writeConfig on single-line objects and expressions", () => {
  const project = useProject();

  it("edits a plain object export in place", async () => {
    const config = await writeSourceAndRead(
      project,
      "export default { name: 'demo', cacheFolder: '.cache' };\n",
    );
    config.name = "updated";

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      "export default { name: 'updated', cacheFolder: '.cache' };\n",
    );
  });

  it("removes the last key of a single-line object", async () => {
    const config = await writeSourceAndRead(
      project,
      "export default { name: 'demo', cacheFolder: '.cache' };\n",
    );
    delete config.cacheFolder;

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      "export default { name: 'demo' };\n",
    );
  });

  it("refuses a version held by an expression and leaves the file unchanged", async () => {
    const source = SOURCE.replace(
      'version: "1.0.0"',
      "version: API_VERSION",
    ).replace(
      "const CLIENT_URL",
      'const API_VERSION = "1.0.0";\nconst CLIENT_URL',
    );
    const config = await writeSourceAndRead(project, source);
    packageModule(config, "api").version = "2.0.0";

    const failure = await writeConfig(project.folder, config).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.be.instanceOf(CliError);
    expect(failure).to.have.nested.property(
      "problem.title",
      "Cannot update modules.api.source.version in antelope.config.ts",
    );
    expect(failure)
      .to.have.nested.property("problem.fixes")
      .that.deep.equals([
        'Set modules.api.source.version to "2.0.0" in antelope.config.ts by hand',
      ]);
    expect(readText(project.configPath)).to.equal(source);
  });
});

describe("writeConfig around comments, line endings and spreads", () => {
  const project = useProject();

  it("removes a module with its own comments and keeps its neighbours' comments", async () => {
    const source = `export default {
  modules: {
    api: "1.0.0", // keep
    // database module
    db: "1.0.0", // pinned for #12
    web: "1.0.0",
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    delete config.modules?.db;

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace(
        '    // database module\n    db: "1.0.0", // pinned for #12\n',
        "",
      ),
    );
  });

  it("adds after a trailing comment and inside a commented empty object", async () => {
    const source = `export default {
  modules: {
    a: "1.0.0" // the a module
  },
  logging: {
    // set by ajs project logging set
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = { ...config.modules, b: "2.0.0" };
    config.logging = { enabled: true };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source
        .replace(
          '    a: "1.0.0" // the a module\n',
          '    a: "1.0.0", // the a module\n    b: "2.0.0"\n',
        )
        .replace(
          "    // set by ajs project logging set\n",
          "    // set by ajs project logging set\n    enabled: true\n",
        ),
    );
  });

  it("keeps CRLF line endings when it removes and adds", async () => {
    const source = [
      "export default {",
      "  modules: {",
      '    api: "1.0.0",',
      '    db: "1.0.0",',
      "  },",
      "};",
      "",
    ].join("\r\n");
    const config = await writeSourceAndRead(project, source);
    config.modules = { api: "1.0.0", web: "3.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace('    db: "1.0.0",\r\n', '    web: "3.0.0",\r\n'),
    );
  });

  it("ignores values that evaluate differently on each load", async () => {
    const source = `export default {
  name: "shop-" + Date.now(),
  modules: {
    auth: {
      version: "1.0.0",
      config: { secret: String(Math.random()), hooks: [() => 1], at: new Date() },
    },
    db: "1.0.0",
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    delete config.modules?.db;

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace('    db: "1.0.0",\n', ""),
    );
  });

  it("adds after a comma that follows a block comment holding a comma", async () => {
    const source = `export default {
  modules: {
    a: "1.0.0" /* pinned, do not bump */,
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = { ...config.modules, b: "2.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace("do not bump */,\n", 'do not bump */,\n    b: "2.0.0",\n'),
    );
  });

  it("writes a value inline into a single-line object", async () => {
    const source = `export default {
  environments: { prod: { modules: { a: "1.0.0" } } },
};
`;
    const config = await writeSourceAndRead(project, source);
    const prod = config.environments?.prod;
    if (!prod) throw new Error("prod is missing");
    prod.logging = { enabled: true };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace(
        '{ a: "1.0.0" } } },',
        '{ a: "1.0.0" }, logging: { enabled: true } } },',
      ),
    );
  });
});

describe("writeConfig refusals on values it cannot reach", () => {
  const project = useProject();

  it("refuses a value a later spread overrides", async () => {
    const source = `const extra = { modules: { a: "9.9.9" } };
export default { modules: { a: "1.0.0" }, ...extra };
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = { a: "2.0.0" };

    const failure = await writeConfig(project.folder, config).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.have.nested.property(
      "problem.title",
      "Cannot update modules.a in antelope.config.ts",
    );
    expect(readText(project.configPath)).to.equal(source);
  });

  it("names the whole value to write when it refuses an added module", async () => {
    const source = `const MODULES = { api: "1.0.0" };
export default { modules: MODULES };
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = {
      ...config.modules,
      x: { source: { type: "local", path: "./x" } },
    };

    const failure = await writeConfig(project.folder, config).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure)
      .to.have.nested.property("problem.fixes")
      .that.deep.equals([
        'Set modules.x to {"source":{"type":"local","path":"./x"}} in antelope.config.ts by hand',
      ]);
    expect(readText(project.configPath)).to.equal(source);
  });
});

describe("writeConfig next to closing braces and multi-line comments", () => {
  const project = useProject();

  async function removeApi(modules: string): Promise<string> {
    const source = `export default {\n  name: "shop",\n  modules: {\n${modules}\n  },\n};\n`;
    const config = await writeSourceAndRead(project, source);
    delete config.modules?.api;
    await writeConfig(project.folder, config);
    const written = readText(project.configPath);
    const reread = await readConfig(project.folder);
    expect(Object.keys(reread?.modules ?? {})).to.not.include("api");
    return written;
  }

  it("keeps a closing brace that shares the removed property's line", async () => {
    expect(
      await removeApi(
        '    web: "1.0.0", // the web\n    api: "1.0.0" },\n  x: {',
      ),
    ).to.include('    web: "1.0.0", // the web\n    },\n');
  });

  it("keeps a module that shares the removed property's line", async () => {
    expect(
      await removeApi(
        '    web: "1.0.0", // the web\n    api: "1.0.0", auth: "1.0.0",',
      ),
    ).to.include('    web: "1.0.0", // the web\n    auth: "1.0.0",\n');
  });

  it("keeps a multi-line comment that ends above the removed property", async () => {
    const comment =
      '    web: "1.0.0", /* the web,\n                     served on 80 */\n';
    expect(
      await removeApi(`${comment}    api: "1.0.0",\n    auth: "1.0.0",`),
    ).to.include(`${comment}    auth: "1.0.0",\n`);
  });

  it("keeps a multi-line comment on the property it follows when adding", async () => {
    const source = `export default {
  modules: {
    web: "1.0.0" /* the web,
                    served on 80 */
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = { ...config.modules, api: "2.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source
        .replace("served on 80 */\n", 'served on 80 */\n    api: "2.0.0"\n')
        .replace('web: "1.0.0" /*', 'web: "1.0.0", /*'),
    );
  });

  it("keeps a single-line array single-line when it replaces it", async () => {
    const source = `export default {
  name: "shop",
  logging: { enabled: true, moduleTracking: { includes: ["left-pad"] } },
};
`;
    const config = await writeSourceAndRead(project, source);
    config.logging?.moduleTracking?.includes?.push("other");

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace('["left-pad"]', '["left-pad", "other"]'),
    );
  });

  it("keeps the comment of an empty single-line object it adds to", async () => {
    const source = `export default {
  name: "shop",
  modules: { /* none yet */ },
};
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = { api: "1.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace("{ /* none yet */ }", '{ /* none yet */ api: "1.0.0" }'),
    );
  });
});

describe("writeConfig around spreads, getters and mixed layouts", () => {
  const project = useProject();

  it("adds after a multi-line comment in an empty object", async () => {
    const source = `export default {
  name: "shop",
  modules: { /* modules go here,
    one per line */ },
};
`;
    const config = await writeSourceAndRead(project, source);
    config.modules = { api: "1.0.0" };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace("one per line */ }", 'one per line */ api: "1.0.0" }'),
    );
  });

  it("refuses to remove a key from an object that holds a spread", async () => {
    const source = `const base = { a: "1.0.0" };
export default { name: "shop", modules: { ...base, a: "1.0.0", b: "1.0.0" } };
`;
    const config = await writeSourceAndRead(project, source);
    delete config.modules?.a;

    const failure = await writeConfig(project.folder, config).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.have.nested.property(
      "problem.title",
      "Cannot update modules.a in antelope.config.ts",
    );
    expect(readText(project.configPath)).to.equal(source);
  });

  it("keeps the previous line's comment when the removed key follows a comment", async () => {
    const source = `export default {
  name: "shop",
  modules: {
    a: "1.0.0", // keep a: pinned for the demo
    /* experimental */ b: "1.0.0",
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    delete config.modules?.b;

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace('    /* experimental */ b: "1.0.0",\n', ""),
    );
  });

  it("keeps each existing line ending in a file that mixes them", async () => {
    const source =
      'export default {\r\n  name: "shop",\n  modules: {\n    a: "1.0.0",\n  },\n};\n';
    const config = await writeSourceAndRead(project, source);
    config.modules = { ...config.modules, b: { version: "2.0.0" } };

    await writeConfig(project.folder, config);

    expect(readText(project.configPath)).to.equal(
      source.replace(
        '    a: "1.0.0",\n',
        '    a: "1.0.0",\n    b: {\n      version: "2.0.0",\n    },\n',
      ),
    );
  });

  it("refuses a change under a getter", async () => {
    const source = `const modules = {};
export default {
  name: "shop",
  get modules() {
    return modules;
  },
};
`;
    const config = await writeSourceAndRead(project, source);
    const modules = config.modules ?? {};
    modules.auth = "1.0.0";

    const failure = await writeConfig(project.folder, config).then(
      () => undefined,
      (error: unknown) => error,
    );

    expect(failure).to.have.nested.property(
      "problem.title",
      "Cannot update modules.auth in antelope.config.ts",
    );
    expect(readText(project.configPath)).to.equal(source);
  });
});
