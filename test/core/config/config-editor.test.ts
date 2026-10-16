import { expect } from "chai";
import * as ts from "typescript";

import {
  ConfigEditError,
  removeModuleEntry,
  setModuleEntry,
} from "../../../src/core/config/config-editor";

const FILE = "antelope.config.ts";

const CONFIG = `import { defineConfig } from "@antelopejs/interface-core/config";

// Preferred port only.
const port = process.env.PORT ?? "5010";

export default defineConfig({
  name: "demo",
  modules: {
    api: {
      source: { type: "package", package: "@antelopejs/api", version: "^1.3.1" },
      // Keeps its own comment.
      config: { servers: [{ protocol: "http", port }] },
    },
  },
});
`;

const LANG_SOURCE = {
  type: "package",
  package: "@antelopejs/dms-lang",
  version: "^0.1.1",
};

describe("config editor", () => {
  it("adds an entry after the others, leaving the rest of the file as it was", () => {
    const edited = setModuleEntry(ts, FILE, CONFIG, "@antelopejs/dms-lang", {
      source: LANG_SOURCE,
      optional: true,
    });
    expect(edited).to.contain('const port = process.env.PORT ?? "5010";');
    expect(edited).to.contain("// Keeps its own comment.");
    expect(edited).to.contain(
      [
        '    "@antelopejs/dms-lang": {',
        "      source: {",
        '        type: "package",',
        '        package: "@antelopejs/dms-lang",',
        '        version: "^0.1.1",',
        "      },",
        "      optional: true,",
        "    },",
        "  },",
        "});",
      ].join("\n"),
    );
    const untouchedHead = CONFIG.slice(0, CONFIG.indexOf("    },\n  },"));
    expect(edited.startsWith(untouchedHead)).to.equal(true);
  });

  it("rewrites, adds and removes single fields of an existing entry", () => {
    const added = setModuleEntry(ts, FILE, CONFIG, "@antelopejs/dms-lang", {
      source: LANG_SOURCE,
    });
    const paused = setModuleEntry(ts, FILE, added, "@antelopejs/dms-lang", {
      source: { ...LANG_SOURCE, version: "^0.2.0" },
      disabled: true,
    });
    expect(paused).to.contain('version: "^0.2.0"');
    expect(paused).to.contain("      disabled: true,");
    const resumed = setModuleEntry(ts, FILE, paused, "@antelopejs/dms-lang", {
      disabled: undefined,
    });
    expect(resumed).not.to.contain("disabled");
    expect(resumed).to.contain('version: "^0.2.0"');
  });

  it("removes an entry and gives the original file back", () => {
    const added = setModuleEntry(ts, FILE, CONFIG, "@antelopejs/dms-lang", {
      source: LANG_SOURCE,
    });
    expect(removeModuleEntry(ts, FILE, added, "@antelopejs/dms-lang")).to.equal(
      CONFIG,
    );
    expect(removeModuleEntry(ts, FILE, CONFIG, "missing")).to.equal(CONFIG);
  });

  it("edits a field of an entry declared by a version string", () => {
    const shorthand = `export default {\n  name: "x",\n  modules: {\n    "@antelopejs/dms-lang": "^0.1.0",\n  },\n};\n`;
    const edited = setModuleEntry(ts, FILE, shorthand, "@antelopejs/dms-lang", {
      disabled: true,
    });
    expect(edited).to.contain('version: "^0.1.0"');
    expect(edited).to.contain("disabled: true");
  });

  it("adds the modules object when the file has none", () => {
    const edited = setModuleEntry(
      ts,
      FILE,
      `export default {\n  name: "x",\n};\n`,
      "m",
      { source: { type: "package", package: "m", version: "1.0.0" } },
    );
    expect(edited).to.contain("  modules: {\n    m: {\n");
  });

  it("refuses a configuration built by a function", () => {
    expect(() =>
      setModuleEntry(ts, FILE, "export default () => ({ name: 'x' });\n", "m", {
        disabled: true,
      }),
    ).to.throw(ConfigEditError);
  });
});
