import sinon from "sinon";
import { expect } from "chai";

import * as loggingUtils from "../../../src/core/cli/logging-utils";
import {
  formatDate,
  formatLogMessageWithRightAlignedDate,
  getColoredText,
  getLevelInfo,
  isTerminalOutput,
  serializeLogValue,
  stringVisualWidth,
  stripAnsi,
  stripAnsiCodes,
} from "../../../src/core/cli/logging-utils";

function setTTY(stdout: boolean, stderr: boolean, columns?: number) {
  const stdoutIsTTY = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
  const stderrIsTTY = Object.getOwnPropertyDescriptor(process.stderr, "isTTY");
  const stdoutColumns = Object.getOwnPropertyDescriptor(
    process.stdout,
    "columns",
  );

  Object.defineProperty(process.stdout, "isTTY", {
    value: stdout,
    configurable: true,
  });
  Object.defineProperty(process.stderr, "isTTY", {
    value: stderr,
    configurable: true,
  });
  if (columns !== undefined) {
    Object.defineProperty(process.stdout, "columns", {
      value: columns,
      configurable: true,
    });
  }

  return () => {
    if (stdoutIsTTY) {
      Object.defineProperty(process.stdout, "isTTY", stdoutIsTTY);
    } else {
      delete (process.stdout as any).isTTY;
    }
    if (stderrIsTTY) {
      Object.defineProperty(process.stderr, "isTTY", stderrIsTTY);
    } else {
      delete (process.stderr as any).isTTY;
    }
    if (stdoutColumns) {
      Object.defineProperty(process.stdout, "columns", stdoutColumns);
    } else if (columns !== undefined) {
      delete (process.stdout as any).columns;
    }
  };
}

describe("Logging Utils", () => {
  describe("stripAnsiCodes", () => {
    it("should remove ANSI color codes", () => {
      const colored = "\u001b[31mred\u001b[0m";
      expect(stripAnsiCodes(colored)).to.equal("red");
    });
  });

  describe("stringVisualWidth", () => {
    it("should calculate width correctly", () => {
      expect(stringVisualWidth("hello")).to.equal(5);
    });

    it("should handle wide characters", () => {
      expect(stringVisualWidth("你好")).to.equal(4);
    });

    it("should treat single wide symbols as width 2", () => {
      expect(stringVisualWidth("✓")).to.equal(2);
    });
  });

  describe("getLevelInfo", () => {
    it("returns known levels and a fallback", () => {
      expect(getLevelInfo(40).name).to.equal("ERROR");
      expect(getLevelInfo(999).name).to.equal("LOG");
    });
  });

  describe("getColoredText", () => {
    it("returns text unchanged for unknown color", () => {
      expect(getColoredText("hello", "unknown")).to.equal("hello");
    });

    it("applies color when known", () => {
      expect(stripAnsiCodes(getColoredText("hello", "red"))).to.equal("hello");
    });
  });

  describe("isTerminalOutput", () => {
    it("reflects stdout and stderr tty flags", () => {
      const restoreTrue = setTTY(true, true);
      try {
        expect(isTerminalOutput()).to.equal(true);
      } finally {
        restoreTrue();
      }

      const restoreFalse = setTTY(true, false);
      try {
        expect(isTerminalOutput()).to.equal(false);
      } finally {
        restoreFalse();
      }
    });
  });

  describe("stripAnsi", () => {
    it("removes mixed terminal sequences", () => {
      const text = "\u001b[31mred\u001b[0m\u001b]0;title\u0007";
      expect(stripAnsi(text)).to.equal("red");
    });
  });

  describe("formatDate", () => {
    it("should format date with pattern", () => {
      const date = new Date("2024-01-15T10:30:45Z");
      expect(formatDate(date, "yyyy-MM-dd")).to.equal("2024-01-15");
    });

    it("should fallback to ISO when format is empty", () => {
      const date = new Date("2024-01-15T10:30:45Z");
      expect(formatDate(date, "")).to.equal(date.toISOString());
    });
  });

  describe("serializeLogValue", () => {
    it("should serialize null", () => {
      expect(serializeLogValue(null)).to.equal("null");
    });

    it("should serialize objects", () => {
      expect(serializeLogValue({ a: 1 })).to.include('"a"');
    });

    it("should serialize errors and dates", () => {
      const err = new Error("boom");
      const result = serializeLogValue(err);
      expect(result).to.include("Error: boom");
      expect(result).to.include("at ");
      const date = new Date("2024-01-15T10:30:45Z");
      expect(serializeLogValue(date)).to.equal(date.toISOString());
    });

    it("should serialize errors without a stack", () => {
      const err = new Error("no-stack");
      err.stack = undefined;
      expect(serializeLogValue(err)).to.equal("no-stack");
    });

    it("should serialize the errors an AggregateError carries", () => {
      const result = serializeLogValue(
        new AggregateError(
          [new Error("inner-a"), "inner-b"],
          "Failed to activate replacement module dms",
        ),
      );

      expect(result).to.match(
        /^AggregateError: Failed to activate replacement module dms\n/,
      );
      expect(result).to.include("\n  - Error: inner-a\n        at ");
      expect(result).to.include("\n  - inner-b");
    });

    it("should serialize nested AggregateErrors one level deeper each", () => {
      const rootCause = new Error("root cause");
      rootCause.stack = undefined;
      const inner = new AggregateError([rootCause], "inner");
      inner.stack = undefined;
      const outer = new AggregateError([inner], "outer");
      outer.stack = undefined;

      expect(serializeLogValue(outer)).to.equal(
        ["outer", "  - inner", "      - root cause"].join("\n"),
      );
    });

    it("should stop at an AggregateError that carries itself", () => {
      const aggregate = new AggregateError([], "loop");
      aggregate.stack = undefined;
      aggregate.errors.push(aggregate);

      expect(serializeLogValue(aggregate)).to.equal(
        ["loop", "  - [Circular]"].join("\n"),
      );
    });

    it("should serialize an error's cause one level deeper", () => {
      const cause = new Error("connect ECONNREFUSED 127.0.0.1:59999");
      cause.stack = undefined;
      const error = new TypeError("fetch failed", { cause });
      error.stack = undefined;

      expect(serializeLogValue(error)).to.equal(
        [
          "fetch failed",
          "  Caused by: connect ECONNREFUSED 127.0.0.1:59999",
        ].join("\n"),
      );
    });

    it("should serialize a cause that is not an error", () => {
      const error = new Error("lookup failed", {
        cause: { code: "ENOTFOUND" },
      });
      error.stack = undefined;

      expect(serializeLogValue(error)).to.equal(
        [
          "lookup failed",
          "  Caused by: {",
          '      "code": "ENOTFOUND"',
          "    }",
        ].join("\n"),
      );
    });

    it("should serialize a cause chain one level deeper each", () => {
      const root = new Error("ENOENT");
      root.stack = undefined;
      const middle = new Error("read config", { cause: root });
      middle.stack = undefined;
      const outer = new Error("Failed to load module config", {
        cause: middle,
      });
      outer.stack = undefined;

      expect(serializeLogValue(outer)).to.equal(
        [
          "Failed to load module config",
          "  Caused by: read config",
          "      Caused by: ENOENT",
        ].join("\n"),
      );
    });

    it("should stop at a cause chain that loops", () => {
      const first = new Error("first");
      first.stack = undefined;
      const second = new Error("second", { cause: first });
      second.stack = undefined;
      first.cause = second;

      expect(serializeLogValue(first)).to.equal(
        ["first", "  Caused by: second", "      Caused by: [Circular]"].join(
          "\n",
        ),
      );
    });

    it("should serialize the cause of an error an AggregateError carries", () => {
      const reason = new Error("socket hang up");
      reason.stack = undefined;
      const inner = new Error("fetch failed", { cause: reason });
      inner.stack = undefined;
      const aggregate = new AggregateError([inner], "reload failed");
      aggregate.stack = undefined;

      expect(serializeLogValue(aggregate)).to.equal(
        [
          "reload failed",
          "  - fetch failed",
          "      Caused by: socket hang up",
        ].join("\n"),
      );
    });

    it("should handle circular references", () => {
      const value: any = {};
      value.self = value;
      expect(serializeLogValue(value)).to.equal("[object Object]");
    });
  });

  describe("formatLogMessageWithRightAlignedDate", () => {
    afterEach(() => {
      sinon.restore();
    });

    it("formats with date prefix for non-terminal output", () => {
      const restore = setTTY(false, false);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = formatLogMessageWithRightAlignedDate(
          {
            dateFormat: "yyyy-MM-dd",
            moduleTracking: { enabled: true },
          } as any,
          { levelId: 20, args: ["hello"], time: date.getTime() },
          "modA",
        );

        const plain = stripAnsi(output);
        const expectedDate = formatDate(date, "yyyy-MM-dd");
        expect(plain).to.include(`[${expectedDate}]`);
        expect(plain).to.include("(modA)");
        expect(plain).to.include("hello");
      } finally {
        restore();
      }
    });

    it("right aligns date on the last line for terminal output", () => {
      const restore = setTTY(true, true, 40);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = formatLogMessageWithRightAlignedDate(
          { moduleTracking: { enabled: true } } as any,
          { levelId: -1, args: ["first\\nsecond"], time: date.getTime() },
          "modA",
        );

        const plain = stripAnsi(output);
        const lines = plain.split("\\n");
        const expectedDate = formatDate(date, "yyyy-MM-dd HH:mm:ss");

        expect(lines[0]).to.equal("(modA) first");
        expect(lines[1]).to.include("second");
        expect(lines[1]).to.include(`[${expectedDate}]`);
      } finally {
        restore();
      }
    });

    it("keeps intermediate lines unchanged for terminal output", () => {
      const restore = setTTY(true, true, 30);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = formatLogMessageWithRightAlignedDate(
          { moduleTracking: { enabled: false } } as any,
          {
            levelId: 20,
            args: ["first\\nmiddle\\nlast"],
            time: date.getTime(),
          },
        );

        const plain = stripAnsi(output);
        const lines = plain.split("\\n");
        const expectedDate = formatDate(date, "yyyy-MM-dd HH:mm:ss");

        expect(lines).to.have.length(3);
        expect(lines[0]).to.include("first");
        expect(lines[0]).to.not.include(`[${expectedDate}]`);
        expect(lines[1]).to.equal("middle");
        expect(lines[2]).to.include(`[${expectedDate}]`);
      } finally {
        restore();
      }
    });

    it("handles multi-line output when terminal detection is stubbed", () => {
      const stub = sinon.stub(loggingUtils, "isTerminalOutput").returns(true);
      try {
        const date = new Date(2024, 0, 15, 10, 30, 0);
        const output = loggingUtils.formatLogMessageWithRightAlignedDate(
          { moduleTracking: { enabled: false } } as any,
          { levelId: 20, args: ["alpha\\nbeta\\ngamma"], time: date.getTime() },
        );

        const lines = stripAnsi(output).split("\\n");
        expect(lines).to.have.length(3);
        expect(lines[1]).to.equal("beta");
      } finally {
        stub.restore();
      }
    });
  });
});
