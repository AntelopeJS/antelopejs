import type { AntelopeConfig } from "@antelopejs/interface-core/config";
import { expect } from "chai";
import { execFileSync } from "node:child_process";
import path from "node:path";

import { writeConfig } from "../../../src/cli";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

const CONFIG_PATH = "/project/antelope.config.ts";
const REPOSITORY = path.resolve(__dirname, "../../..");
const OXFMT = path.join(REPOSITORY, "node_modules/.bin/oxfmt");
const LONG = "x".repeat(70);
const OUTPUT_LIMIT = 256 * 1024 * 1024;
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
const BOUNDARY_PADS = [56, 57, 58];
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

/** `source` as oxfmt formats it with the house preset in `oxfmt.config.ts`. */
function oxfmt(source: string): string {
  const config = path.join(REPOSITORY, "oxfmt.config.ts");
  const args = ["-c", config, "--stdin-filepath", "antelope.config.ts"];
  return execFileSync(OXFMT, args, {
    input: source,
    encoding: "utf-8",
    maxBuffer: OUTPUT_LIMIT,
    stdio: ["pipe", "pipe", "ignore"],
  });
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

/** A module config holding `texts`, each padded so it ends near column 80. */
function boundaryProbes(texts: readonly string[]): Partial<AntelopeConfig> {
  const entries = texts.flatMap((text, index) =>
    BOUNDARY_PADS.map(
      (pad) =>
        [
          `k${index.toString(16).padStart(6, "0")}${pad}`,
          ["-".repeat(pad - 2) + text],
        ] as const,
    ),
  );
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
  "keys short in UTF-16 units but wide in columns, and the reverse": {
    name: "app",
    modules: {
      app: {
        config: { 日本語: "x".repeat(66), ["a\u0301bcd"]: "x".repeat(66) },
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
