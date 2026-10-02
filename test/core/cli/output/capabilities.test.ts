import { expect } from "chai";

import {
  detectCapabilities,
  hasColorSupport,
  hasUnicodeSupport,
  isInteractiveSession,
  processCapabilityContext,
  selectSymbols,
  SYMBOL_SETS,
  type CapabilityContext,
} from "../../../../src/core/cli/output";
import { MemoryStream } from "../../../helpers/memory-ui";

const TERMINAL = new MemoryStream(true);
const PIPE = new MemoryStream(false);

function context(
  env: NodeJS.ProcessEnv,
  argv: string[] = [],
  platform: NodeJS.Platform = "linux",
): CapabilityContext {
  return {
    env,
    argv,
    platform,
    streams: { result: PIPE, feedback: TERMINAL },
  };
}

describe("output capabilities", () => {
  describe("colors", () => {
    it("colors a terminal and not a pipe", () => {
      expect(hasColorSupport(context({}), TERMINAL)).to.equal(true);
      expect(hasColorSupport(context({}), PIPE)).to.equal(false);
    });

    it("honors NO_COLOR and --no-color", () => {
      expect(hasColorSupport(context({ NO_COLOR: "1" }), TERMINAL)).to.equal(
        false,
      );
      expect(hasColorSupport(context({ NO_COLOR: "" }), TERMINAL)).to.equal(
        true,
      );
      expect(
        hasColorSupport(context({}, ["node", "ajs", "--no-color"]), TERMINAL),
      ).to.equal(false);
      expect(
        hasColorSupport(
          context({ FORCE_COLOR: "1" }, ["node", "ajs", "--no-color"]),
          TERMINAL,
        ),
      ).to.equal(false);
    });

    it("honors FORCE_COLOR in both directions", () => {
      expect(hasColorSupport(context({ FORCE_COLOR: "1" }), PIPE)).to.equal(
        true,
      );
      expect(
        hasColorSupport(context({ FORCE_COLOR: "1", CI: "true" }), PIPE),
      ).to.equal(true);
      expect(hasColorSupport(context({ FORCE_COLOR: "0" }), TERMINAL)).to.equal(
        false,
      );
      expect(
        hasColorSupport(context({ FORCE_COLOR: "false" }), TERMINAL),
      ).to.equal(false);
    });

    it("turns colors off on a dumb terminal and in CI", () => {
      expect(hasColorSupport(context({ TERM: "dumb" }), TERMINAL)).to.equal(
        false,
      );
      expect(hasColorSupport(context({ CI: "true" }), TERMINAL)).to.equal(
        false,
      );
      expect(hasColorSupport(context({ CI: "false" }), TERMINAL)).to.equal(
        true,
      );
    });
  });

  describe("unicode", () => {
    it("draws unicode on a UTF-8 terminal", () => {
      expect(hasUnicodeSupport({}, "linux")).to.equal(true);
      expect(hasUnicodeSupport({ LANG: "en_US.UTF-8" }, "darwin")).to.equal(
        true,
      );
      expect(hasUnicodeSupport({ LC_ALL: "C.utf8", LANG: "C" }, "linux")).to.equal(
        true,
      );
    });

    it("falls back to ASCII on a dumb terminal", () => {
      expect(hasUnicodeSupport({ TERM: "dumb" }, "linux")).to.equal(false);
      expect(
        hasUnicodeSupport({ TERM: "dumb", WT_SESSION: "1" }, "win32"),
      ).to.equal(false);
    });

    it("falls back to ASCII with a non UTF-8 locale or the Linux console", () => {
      expect(hasUnicodeSupport({ LANG: "C" }, "linux")).to.equal(false);
      expect(hasUnicodeSupport({ LC_CTYPE: "en_US.ISO-8859-1" }, "linux")).to.equal(
        false,
      );
      expect(hasUnicodeSupport({ TERM: "linux" }, "linux")).to.equal(false);
    });

    it("falls back to ASCII in the legacy Windows console only", () => {
      expect(hasUnicodeSupport({}, "win32")).to.equal(false);
      expect(hasUnicodeSupport({ TERM_PROGRAM: "cmd" }, "win32")).to.equal(
        false,
      );
      expect(hasUnicodeSupport({ WT_SESSION: "abc" }, "win32")).to.equal(true);
      expect(hasUnicodeSupport({ TERM_PROGRAM: "vscode" }, "win32")).to.equal(
        true,
      );
      expect(
        hasUnicodeSupport({ ConEmuTask: "{cmd::Cmder}" }, "win32"),
      ).to.equal(true);
    });

    it("selects the matching symbol set", () => {
      expect(selectSymbols(true)).to.equal(SYMBOL_SETS.unicode);
      expect(selectSymbols(false)).to.equal(SYMBOL_SETS.ascii);
    });

    it("keeps the ASCII set within 7-bit ASCII", () => {
      const { levels, bullet, rule, spinner } = SYMBOL_SETS.ascii;
      const glyphs = [...Object.values(levels), bullet, rule, ...spinner];

      expect(glyphs.join("")).to.match(/^[\x20-\x7e]+$/);
    });
  });

  it("detects every capability per stream", () => {
    expect(detectCapabilities(context({ LANG: "C" }))).to.deep.equal({
      hasUnicode: false,
      colors: { result: false, feedback: true },
      terminals: { result: false, feedback: true },
    });
  });

  it("reads the process environment", () => {
    const processContext = processCapabilityContext();

    expect(processContext.env).to.equal(process.env);
    expect(processContext.argv).to.equal(process.argv);
    expect(processContext.streams.result).to.equal(process.stdout);
    expect(processContext.streams.feedback).to.equal(process.stderr);
  });
});

describe("isInteractiveSession", () => {
  const terminal = TERMINAL;
  const pipe = PIPE;

  it("can ask when stdin and the prompt output are terminals", () => {
    expect(
      isInteractiveSession({ env: {}, input: terminal, output: terminal }),
    ).to.equal(true);
  });

  it("cannot ask when stdin or the prompt output is not a terminal", () => {
    expect(
      isInteractiveSession({ env: {}, input: {}, output: terminal }),
    ).to.equal(false);
    expect(
      isInteractiveSession({ env: {}, input: terminal, output: pipe }),
    ).to.equal(false);
  });

  it("never asks in CI", () => {
    expect(
      isInteractiveSession({
        env: { CI: "true" },
        input: terminal,
        output: terminal,
      }),
    ).to.equal(false);
    expect(
      isInteractiveSession({
        env: { CI: "false" },
        input: terminal,
        output: terminal,
      }),
    ).to.equal(true);
  });
});
