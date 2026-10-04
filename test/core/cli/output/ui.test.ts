import { expect } from "chai";
import * as sinon from "sinon";

import {
  createUi,
  getProcessUi,
  writeData,
  type MessageLevel,
  type Ui,
} from "../../../../src/core/cli/output";
import { captureOutput } from "../../../helpers/capture-output";
import { createMemoryUi, MemoryStream } from "../../../helpers/memory-ui";

const LEVELS: MessageLevel[] = [
  "success",
  "info",
  "warn",
  "error",
  "skip",
  "hint",
];

interface PackageRow {
  name: string;
  version: string;
}

const PACKAGES: PackageRow[] = [
  { name: "auth", version: "1.2.0" },
  { name: "inventory-core", version: "10.0.1" },
];

const PACKAGE_COLUMNS = [
  { header: "Name", value: (row: PackageRow) => row.name },
  { header: "Version", value: (row: PackageRow) => row.version },
];

function writeEveryLevel(hasUnicode: boolean, hasColor = false): string {
  const { ui, feedback } = createMemoryUi({ hasUnicode, hasColor });
  LEVELS.forEach((level) => ui.message(level, `${level} message`));
  return feedback.text;
}

describe("output ui messages", () => {
  it("prints every level with its unicode symbol on the feedback stream", () => {
    expect(writeEveryLevel(true)).to.equal(
      [
        "✔ success message",
        "ℹ info message",
        "▲ warn message",
        "✖ error message",
        "– skip message",
        "→ hint message",
        "",
      ].join("\n"),
    );
  });

  it("falls back to ASCII symbols", () => {
    expect(writeEveryLevel(false)).to.equal(
      [
        "v success message",
        "i info message",
        "! warn message",
        "x error message",
        "- skip message",
        "> hint message",
        "",
      ].join("\n"),
    );
  });

  it("colors only the symbol of each level", () => {
    expect(writeEveryLevel(true, true)).to.equal(
      [
        "\x1b[32m✔\x1b[39m success message",
        "\x1b[34mℹ\x1b[39m info message",
        "\x1b[33m▲\x1b[39m warn message",
        "\x1b[31m✖\x1b[39m error message",
        "\x1b[2m–\x1b[22m skip message",
        "\x1b[36m→\x1b[39m hint message",
        "",
      ].join("\n"),
    );
  });

  it("prints a dim detail under the message", () => {
    const { ui, feedback } = createMemoryUi({ hasColor: true });

    ui.message("warn", "Lockfile is outdated", { detail: "pnpm-lock.yaml" });

    expect(feedback.text).to.equal(
      "\x1b[33m▲\x1b[39m Lockfile is outdated\n  \x1b[2mpnpm-lock.yaml\x1b[22m\n",
    );
  });

  it("writes a message on the result stream when asked to", () => {
    const { ui, result, feedback } = createMemoryUi();

    ui.message("success", "Removed billing", { channel: "result" });

    expect(result.text).to.equal("✔ Removed billing\n");
    expect(feedback.text).to.equal("");
  });
});

describe("output ui problems", () => {
  it("prints what failed, why and the details, then how to fix it", () => {
    const { ui, result, feedback } = createMemoryUi({ hasColor: true });

    ui.problem({
      title: "Could not install 'auth'",
      reason: "The package does not exist on the registry",
      fixes: ["Check the name with ajs project modules list"],
      details: ["npm ERR! 404 Not Found"],
    });

    expect(feedback.text).to.equal(
      [
        "\x1b[31m✖\x1b[39m Could not install 'auth'",
        "  \x1b[2mThe package does not exist on the registry\x1b[22m",
        "  \x1b[2mnpm ERR! 404 Not Found\x1b[22m",
        "  \x1b[36m→\x1b[39m Check the name with ajs project modules list",
        "",
      ].join("\n"),
    );
    expect(result.text).to.equal("");
  });

  it("uses the ASCII symbols without color", () => {
    const { ui, feedback } = createMemoryUi({ hasUnicode: false });

    ui.problem({ title: "Failed", fixes: ["Retry"] });

    expect(feedback.text).to.equal("x Failed\n  > Retry\n");
  });

  it("prints the fixes last, after the reason and every detail, in ASCII", () => {
    const { ui, feedback } = createMemoryUi({ hasUnicode: false });

    ui.problem({
      title: "Renderer 2.0.0 is out of range",
      reason: "The modules below need ^1.4.0:",
      details: ["@acme/blog ^1.4.0", "@acme/shop ^1.5.0"],
      fixes: ["Pin the renderer: ajs project modules add renderer@1"],
    });

    expect(feedback.text).to.equal(
      [
        "x Renderer 2.0.0 is out of range",
        "  The modules below need ^1.4.0:",
        "  @acme/blog ^1.4.0",
        "  @acme/shop ^1.5.0",
        "  > Pin the renderer: ajs project modules add renderer@1",
        "",
      ].join("\n"),
    );
  });
});

describe("output ui blocks", () => {
  it("underlines a heading without a leading blank line", () => {
    const { ui, result } = createMemoryUi();

    ui.heading("Plugins");

    expect(result.text).to.equal("Plugins\n───────\n");
  });

  it("styles a heading and falls back to an ASCII rule", () => {
    const { ui, result } = createMemoryUi({
      hasColor: true,
      hasUnicode: false,
    });

    ui.heading("Tips");

    expect(result.text).to.equal(
      "\x1b[1mTips\x1b[22m\n\x1b[2m----\x1b[22m\n",
    );
  });

  it("aligns details on the longest label", () => {
    const { ui, result } = createMemoryUi();

    ui.details([
      { label: "Name", value: "acme-shop" },
      { label: "Environment", value: "production" },
    ]);

    expect(result.text).to.equal(
      "Name         acme-shop\nEnvironment  production\n",
    );
  });

  it("dims the labels of details when colors are on", () => {
    const { ui, result } = createMemoryUi({ hasColor: true });

    ui.details([{ label: "Name", value: "acme" }]);

    expect(result.text).to.equal("\x1b[2mName\x1b[22m  acme\n");
  });

  it("writes details on the feedback channel when asked", () => {
    const { ui, result, feedback } = createMemoryUi();

    ui.message("success", "Found project");
    ui.details([{ label: "Environment", value: "default" }], "feedback");

    expect(result.text).to.equal("");
    expect(feedback.text).to.equal(
      "✔ Found project\n\nEnvironment  default\n",
    );
  });

  it("exposes the colors of each channel", () => {
    const ui = createUi({
      streams: { result: new MemoryStream(), feedback: new MemoryStream() },
      capabilities: {
        hasUnicode: true,
        colors: { result: false, feedback: true },
        terminals: { result: false, feedback: true },
      },
    });

    expect(ui.palette().bold("name")).to.equal("\x1b[1mname\x1b[22m");
    expect(ui.palette("result").bold("name")).to.equal("name");
  });

  it("prints a bulleted list", () => {
    const unicode = createMemoryUi();
    const ascii = createMemoryUi({ hasUnicode: false });

    unicode.ui.list(["auth", "billing"]);
    ascii.ui.list(["auth"]);

    expect(unicode.result.text).to.equal("• auth\n• billing\n");
    expect(ascii.result.text).to.equal("- auth\n");
  });

  it("prints nothing for empty details and lists", () => {
    const { ui, result } = createMemoryUi();

    ui.details([]);
    ui.list([]);

    expect(result.text).to.equal("");
  });

  it("separates blocks with exactly one blank line", () => {
    const { ui, result } = createMemoryUi();

    ui.heading("Modules");
    ui.list(["auth"]);
    ui.heading("Environments");
    ui.details([{ label: "default", value: "base" }]);
    ui.list(["production"]);

    expect(result.text).to.equal(
      [
        "Modules",
        "───────",
        "• auth",
        "",
        "Environments",
        "────────────",
        "default  base",
        "",
        "• production",
        "",
      ].join("\n"),
    );
  });
});

describe("output ui summaries", () => {
  it("prints the headline, artifact, duration and aligned next steps", () => {
    const { ui, result, feedback } = createMemoryUi();

    ui.summary({
      headline: "Built 2 modules",
      durationMs: 2100,
      artifact: "./.antelope/build/build.json",
      nextSteps: [
        { command: "ajs project start", description: "start the build" },
        { command: "ajs project dev --watch" },
      ],
    });

    expect(result.text).to.equal("");
    expect(feedback.text).to.equal(
      [
        "Built 2 modules → ./.antelope/build/build.json · 2.1s",
        "",
        "Next steps",
        "  ajs project start        start the build",
        "  ajs project dev --watch",
        "",
      ].join("\n"),
    );
  });

  it("prints a bare headline when nothing else is given", () => {
    const { ui, feedback } = createMemoryUi({ hasUnicode: false });

    ui.summary({ headline: "Nothing to do", nextSteps: [] });
    ui.summary({ headline: "Wrote it", artifact: "out.json" });

    expect(feedback.text).to.equal("Nothing to do\nWrote it > out.json\n");
  });

  it("joins the duration with the ASCII separator", () => {
    const { ui, feedback } = createMemoryUi({ hasUnicode: false });

    ui.summary({
      headline: "Built 2 modules",
      durationMs: 2100,
      artifact: "./.antelope/build/build.json",
      nextSteps: [{ command: "ajs project start", description: "start it" }],
    });

    expect(feedback.text).to.equal(
      [
        "Built 2 modules > ./.antelope/build/build.json - 2.1s",
        "",
        "Next steps",
        "  ajs project start  start it",
        "",
      ].join("\n"),
    );
  });

  it("colors commands cyan and dims the rest", () => {
    const { ui, feedback } = createMemoryUi({ hasColor: true });

    ui.summary({
      headline: "Done",
      durationMs: 5,
      nextSteps: [{ command: "ajs project start", description: "start" }],
    });

    expect(feedback.text).to.contain("\x1b[2m · 5ms\x1b[22m");
    expect(feedback.text).to.contain("\x1b[36majs project start\x1b[39m");
    expect(feedback.text).to.contain("\x1b[1mNext steps\x1b[22m");
  });

  it("writes every detail line under a message", () => {
    const { ui, feedback } = createMemoryUi();

    ui.message("warn", "2 unresolved imports:", {
      detail: "in default",
      details: ["a (required by x)", "b (required by y)"],
    });

    expect(feedback.text).to.equal(
      "▲ 2 unresolved imports:\n  in default\n  a (required by x)\n  b (required by y)\n",
    );
  });
});

describe("output ui tables", () => {
  it("aligns columns under dim uppercase headers on a terminal", () => {
    const { ui, result } = createMemoryUi({
      hasColor: true,
      isTerminal: true,
    });

    ui.table(PACKAGES, PACKAGE_COLUMNS);

    expect(result.text).to.equal(
      [
        "\x1b[2mNAME            VERSION\x1b[22m",
        "auth            1.2.0",
        "inventory-core  10.0.1",
        "",
      ].join("\n"),
    );
  });

  it("prints tab-separated rows without headers when piped", () => {
    const { ui, result } = createMemoryUi();

    ui.table(PACKAGES, PACKAGE_COLUMNS);

    expect(result.text).to.equal("auth\t1.2.0\ninventory-core\t10.0.1\n");
  });
});

describe("output ui data", () => {
  it("prints a bare value on the result stream, even with colors", () => {
    const { ui, result, feedback } = createMemoryUi({
      hasColor: true,
      isTerminal: true,
    });

    ui.value("https://example.com/interfaces.git");

    expect(result.text).to.equal("https://example.com/interfaces.git\n");
    expect(feedback.text).to.equal("");
  });

  it("prints one indented JSON document on the result stream", () => {
    const { ui, result, feedback } = createMemoryUi({
      hasColor: true,
      isTerminal: true,
    });

    ui.json({ name: "auth", tags: ["api"] });

    expect(result.text).to.equal(
      '{\n  "name": "auth",\n  "tags": [\n    "api"\n  ]\n}\n',
    );
    expect(feedback.text).to.equal("");
  });

  it("writes the data as JSON or renders it with writeData", () => {
    const render = sinon.spy((target: Ui) => target.value("rendered"));
    const json = createMemoryUi();
    const human = createMemoryUi();

    writeData(json.ui, { data: [1, 2], isJson: true, render });
    writeData(human.ui, { data: [1, 2], render });

    expect(JSON.parse(json.result.text)).to.deep.equal([1, 2]);
    expect(human.result.text).to.equal("rendered\n");
    expect(render.calledOnceWithExactly(human.ui)).to.equal(true);
  });
});

describe("output ui process ui", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("is created once and writes to the process streams", () => {
    const output = captureOutput(() => {
      getProcessUi().message("info", "Note");
      getProcessUi().message("success", "Done", { channel: "result" });
    });

    expect(getProcessUi()).to.equal(getProcessUi());
    expect(output.stderr).to.contain("Note");
    expect(output.stdout).to.contain("Done");
  });

  it("detects the capabilities of the streams it is given", () => {
    const { result, feedback } = createMemoryUi();

    const ui = createUi({ streams: { result, feedback } });
    ui.message("info", "Piped");

    expect(feedback.text).to.match(/^. Piped\n$/u);
  });
});
