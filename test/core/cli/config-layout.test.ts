import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { readConfig, writeConfig } from "../../../src/cli";
import { cleanupTempDir, makeTempDir, readText } from "../../helpers/temp";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";
import { oxfmt as oxfmtFile } from "../../helpers/oxfmt";

const CONFIG_PATH = "/project/antelope.config.ts";
const LONG = "x".repeat(70);
const PLANES: readonly (readonly [
  first: number,
  last: number,
  step: number,
])[] = [
  [0x20, 0xd7ff, 1],
  [0xe000, 0x1ffff, 1],
  [0x20000, 0x3ffff, 64],
  [0x3fffd, 0x3ffff, 1],
  [0xe0000, 0xe01ef, 1],
];
const LAST_FITTING_PAD = 58;
const TOKENS = [
  "नमस्ते दुनिया",
  "क्षमा",
  "مرحبا",
  "السلام",
  "لا",
  "สวัสดี",
  "안녕하세요",
  "日本語",
  "ｶﾀｶﾅ",
  "café",
  "e\u0301",
  "👍🏽",
  "❤️",
  "❤",
  "⭐︎",
  "✔️",
  "👨‍👩‍👧",
  "🏳️‍🌈",
  "🇫🇷",
  "1️⃣",
  "🏴󠁧󠁢󠁳󠁣󠁴󠁿",
  "៘",
  "ភ្នំពេញ កម្ពុជា",
  "ភាសាខ្មែរ",
  "لَا",
  "إِلَّا",
  "ꓚꓹꓼ",
  "1⃣",
  "x 5⃣ y",
  "👩🏽‍💻",
  "\u05d0\u200d\u05dc",
  "\u1a15\u1a17\u200d\u1a10",
  "\u{10c32}\u200d\u{10c03}",
  "\u2d31\u2d7f\u2d31",
  "\u2d31\u200d\u2d31",
  "\u{16d63}\u{16d67}",
  "\u{16d63}\u{16d68}",
  "\u{16d69}\u{16d67}",
  "\u{16d63}\u{16d67}\u{16d67}",
  "🏴󠁧󠁢󠁷󠁬󠁳󠁿",
  "🏴\u{e0066}\u{e0072}\u{e0037}\u{e0035}\u{e007f}",
  "🇫\u200d🇷\u200d🇫",
  "\u201c\ufe01",
  "⌚\ufe0e",
  "👍\u200d🏽",
  "🇫🇷\u200d🇫🇷",
  "🇫🇷\u200d🇫🇷🇫",
  "🇫🇷🇫\u200d🇫🇷🇫🇷",
  "🏴󠁧󠁢󠁷󠁬󠁳󠁿\u200d😀",
  "🏴\u{e0066}\u{e0072}\u{e0037}\u{e0035}\u{e007f}\u200d😀",
  "❤️\u200d🔥",
  "\u1780\ufe01\u1780",
  "\u1780\ufe0e\u1780",
  "\u1780\u034f\u17d2\u1780",
  "\u05dc\ufe0e\u05d0",
  "é\ufe01",
  "é\ufe0e",
  "\u{16d63}\u{16d68}\u{16d68}",
];

async function writtenConfig(
  config: Partial<AntelopeConfig>,
  existing?: string,
): Promise<string> {
  const fs = new InMemoryFileSystem();
  if (existing !== undefined) {
    await fs.writeFile(CONFIG_PATH, existing);
  }
  await writeConfig("/project", config, fs);
  return fs.readFileString(CONFIG_PATH);
}

/** `source` as oxfmt formats it as an `antelope.config.ts`. */
function oxfmt(source: string): string {
  return oxfmtFile(source, "antelope.config.ts");
}

/** The first line where `written` and `formatted` differ, with its neighbour. */
function firstDifference(written: string, formatted: string): string {
  const writtenLines = written.split("\n");
  const formattedLines = formatted.split("\n");
  const index = writtenLines.findIndex(
    (line, position) => line !== formattedLines[position],
  );
  return index === -1
    ? ""
    : JSON.stringify(writtenLines.slice(index, index + 2)) +
        " !== " +
        JSON.stringify(formattedLines.slice(index, index + 2));
}

/**
 * A module config holding each of `texts` behind every dash padding that can
 * put its end at column 80, for any width up to three columns per code point.
 */
function boundaryProbes(texts: readonly string[]): Partial<AntelopeConfig> {
  const entries = texts.flatMap((text, index) => {
    const widest = 3 * Array.from(text).length;
    return Array.from({ length: widest + 1 }, (_, offset) => {
      const pad = Math.max(LAST_FITTING_PAD - widest + offset, 2);
      const key = `k${index.toString(16).padStart(6, "0")}${pad}`;
      return [key, ["-".repeat(pad - 2) + text]] as const;
    });
  });
  return {
    name: "app",
    modules: { app: { config: Object.fromEntries(entries) } },
  };
}

function printableCodePoints(): string[] {
  return PLANES.flatMap(([first, last, step]) =>
    Array.from({ length: Math.floor((last - first) / step) + 1 }, (_, index) =>
      String.fromCodePoint(first + index * step),
    ),
  );
}

const PIECES = ["a", "b", "-", " ", "'", '"', "\\", "日", "é", "/", "@", "1"];
const SCALARS = [true, false, null, undefined, NaN, Infinity, 1e21, -0];

type GeneratedValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | GeneratedValue[]
  | { [key: string]: GeneratedValue };

/** A seeded pseudo-random source, so a failure reproduces on every run. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
    return state / 2 ** 31;
  };
}

/** A config value of mixed shape whose strings and keys land near column 80. */
function generatedValue(random: () => number, depth: number): GeneratedValue {
  const below = (limit: number) => Math.floor(random() * limit);
  const text = (max: number) =>
    Array.from(
      { length: 1 + below(max) },
      () => PIECES[below(PIECES.length)],
    ).join("");
  const roll = random();
  if (depth > 3 || roll < 0.45) {
    const scalars = [
      () => text(70),
      () => text(4),
      () => below(10 ** below(12)),
      () => -below(1000),
      () => random() * 100,
      () => SCALARS[below(SCALARS.length)],
      () => (random() < 0.5 ? {} : []),
    ];
    return scalars[below(scalars.length)]();
  }
  const size = below(6);
  if (roll < 0.6) {
    return Array.from({ length: size + 10 }, () => below(10 ** below(6)));
  }
  if (roll < 0.75) {
    return Array.from({ length: size }, () =>
      generatedValue(random, depth + 1),
    );
  }
  return Object.fromEntries(
    Array.from({ length: size }, () => [
      text(random() < 0.3 ? 70 : 6),
      generatedValue(random, depth + 1),
    ]),
  );
}

function generatedConfig(seed: number, count: number): Partial<AntelopeConfig> {
  const random = seeded(seed);
  const modules = Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `module-${index}`,
      { config: generatedValue(random, 0) },
    ]),
  );
  return { name: "app", modules };
}

function nested(depth: number): GeneratedValue {
  return depth === 0 ? { empty: {}, list: [] } : { level: nested(depth - 1) };
}

function localModule(watchDir: string[]): Partial<AntelopeConfig> {
  return {
    name: "app",
    modules: {
      app: {
        source: {
          type: "local",
          path: ".",
          watchDir,
          installCommand: ["npx tsc"],
        },
      },
    },
  };
}

/** The module entry `ajs project init` adds for a template's local module, a new object per call. */
const initModule = (): Partial<AntelopeConfig> => ({
  name: "app",
  modules: {
    app: {
      source: {
        type: "local",
        path: ".",
        watchDir: ["src"],
        installCommand: ["npx tsc"],
        reloadCommand: ["npx tsc"],
      },
    },
  },
});

const CASES = {
  "a new project": { name: "my-project", modules: {} },
  "a template's local module": localModule(["src"]),
  "an array too wide for its line": localModule([LONG, "lib"]),
  "a string too wide for its key's line": {
    name: "app",
    modules: { "@scope/module-with-a-long-name": `npm:${LONG}` },
  },
  "keys and strings that need quotes": {
    name: 'say "hi"',
    modules: { 'it\'s "quoted"': "it's", 日本語: "한국어", "1": "one" },
  },
  "numbers, rows of numbers and non-finite values": {
    name: "app",
    modules: {
      app: {
        config: {
          ports: Array.from({ length: 30 }, (_, index) => 3000 + index * 7),
          grid: [
            [1, 2],
            [3, 4],
          ],
          ratios: [0.5, -1, 1e21],
          [`${"k".repeat(70)}`]: Infinity,
          [`${"n".repeat(74)}`]: 12_345,
          nothing: null,
          empty: [{}, []],
          wide: ["日".repeat(36)],
        },
      },
    },
  },
  "rows of one item and empty containers past column 78": {
    name: "app",
    modules: { app: { config: { rows: [[1], [2]], deep: nested(38) } } },
  },
  "short keys counted in code points, or in columns when quoted": {
    name: "app",
    modules: {
      app: {
        config: {
          日本語: "x".repeat(66),
          ["a\u0301bcd"]: "x".repeat(66),
          𠮷野家店: "x".repeat(66),
          "🇫🇷": "x".repeat(66),
          "1月": "x".repeat(66),
        },
      },
    },
  },
} satisfies Record<string, Partial<AntelopeConfig>>;

describe("antelope.config.ts written by the CLI", () => {
  for (const [name, config] of Object.entries(CASES)) {
    it(`is already oxfmt-formatted for ${name}`, async () => {
      const source = await writtenConfig(config);
      expect(source).to.equal(oxfmt(source));
    });
  }

  it("lays out generated configs of every shape the way oxfmt does", async () => {
    const source = await writtenConfig(generatedConfig(7, 400));
    expect(firstDifference(source, oxfmt(source))).to.equal("");
  });

  it("measures printable code points the way oxfmt does", async function () {
    this.timeout(120_000);
    const source = await writtenConfig(boundaryProbes(printableCodePoints()));
    expect(firstDifference(source, oxfmt(source))).to.equal("");
  });

  it("measures emoji sequences, flags and joined scripts the way oxfmt does", async () => {
    const source = await writtenConfig(boundaryProbes(TOKENS));
    expect(firstDifference(source, oxfmt(source))).to.equal("");
  });

  it("adds the first module to the empty modules object init writes the way oxfmt lays it out", async () => {
    const project = makeTempDir("ajs-config-layout-");
    try {
      await writeConfig(project, { name: "app", modules: {} });
      await writeConfig(project, initModule());
      const source = readText(path.join(project, "antelope.config.ts"));
      expect(firstDifference(source, oxfmt(source))).to.equal("");
    } finally {
      cleanupTempDir(project);
    }
  });

  it("adds a module to a modules object whose closing brace has its own line the way oxfmt lays it out", async () => {
    const project = makeTempDir("ajs-config-layout-");
    try {
      await writeConfig(project, { name: "app", modules: {} });
      const configPath = path.join(project, "antelope.config.ts");
      writeFileSync(
        configPath,
        readText(configPath).replace("modules: {},", "modules: {\n  },"),
      );
      await writeConfig(project, initModule());
      const source = readText(configPath);
      expect(firstDifference(source, oxfmt(source))).to.equal("");
    } finally {
      cleanupTempDir(project);
    }
  });

  for (const [layout, modules] of [
    ["on its own lines", "  modules: {\n  }"],
    ["before a comment", "  modules: {} // none yet"],
    ["with a satisfies cast", "  modules: {} satisfies Record<string, string>"],
    ["with a non-null assertion", "  modules: {}!"],
  ]) {
    it(`adds to an empty object ${layout} without a comma in a file that ends its entries without one`, async () => {
      const project = makeTempDir("ajs-config-layout-");
      try {
        const configPath = path.join(project, "antelope.config.ts");
        writeFileSync(
          configPath,
          `export default {\n  name: "app",\n${modules}\n};\n`,
        );
        const config = await readConfig(project);
        await writeConfig(project, { ...config, modules: { a: "1.0.0" } });
        expect(readText(configPath)).to.match(/\n {4}a: "1\.0\.0"\n {2}\}/);
      } finally {
        cleanupTempDir(project);
      }
    });
  }

  it("writes the template config init writes on one line per short array", async () => {
    const source = await writtenConfig(localModule(["src"]));
    expect(source).to.equal(
      [
        'import { defineConfig } from "@antelopejs/interface-core/config";',
        "",
        "export default defineConfig({",
        '  name: "app",',
        "  modules: {",
        "    app: {",
        "      source: {",
        '        type: "local",',
        '        path: ".",',
        '        watchDir: ["src"],',
        '        installCommand: ["npx tsc"],',
        "      },",
        "    },",
        "  },",
        "});",
        "",
      ].join("\n"),
    );
  });
});
