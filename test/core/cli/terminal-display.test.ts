import { expect } from "chai";

import {
  TaskList,
  TerminalDisplay,
  type OutputCapabilities,
} from "../../../src/core/cli/output";
import { MemoryStream } from "../../helpers/memory-ui";

const ERASE_ONE_LINE = "\x1b[1A\r\x1b[J";

const CAPABILITIES: OutputCapabilities = {
  hasUnicode: true,
  colors: { result: false, feedback: false },
  terminals: { result: false, feedback: false },
};

interface DisplayFixture {
  display: TerminalDisplay;
  result: MemoryStream;
  feedback: MemoryStream;
}

function createDisplay(isLive = false): DisplayFixture {
  const result = new MemoryStream(isLive);
  const feedback = new MemoryStream(isLive);
  const tasks = new TaskList({
    streams: { result, feedback },
    capabilities: CAPABILITIES,
    isLive,
  });
  return { display: new TerminalDisplay(() => tasks), result, feedback };
}

describe("TerminalDisplay", () => {
  it("finishes the most recently started spinner first", async () => {
    const { display, feedback } = createDisplay();

    await display.startSpinner("Outer");
    await display.startSpinner("Inner");
    await display.stopSpinner("Inner done");
    await display.stopSpinner("Outer done");

    expect(feedback.text).to.equal("✔ Inner done\n✔ Outer done\n");
  });

  it("tracks whether a spinner is active", async () => {
    const { display } = createDisplay();

    expect(display.isSpinnerActive()).to.equal(false);
    await display.startSpinner("Working");
    expect(display.isSpinnerActive()).to.equal(true);
    await display.stopSpinner();
    expect(display.isSpinnerActive()).to.equal(false);
  });

  it("stops a spinner without a line when no text is given", async () => {
    const { display, feedback } = createDisplay();

    await display.startSpinner("Outer");
    await display.startSpinner("Inner");
    await display.stopSpinner();
    await display.stopSpinner("Outer done");

    expect(feedback.text).to.equal("✔ Outer done\n");
  });

  it("fails a spinner with the given text or its own label", async () => {
    const { display, feedback } = createDisplay();

    await display.startSpinner("Outer");
    await display.startSpinner("Inner");
    await display.failSpinner("boom");
    await display.failSpinner();

    expect(feedback.text).to.equal("✖ boom\n✖ Outer\n");
  });

  it("ignores stop and fail when no spinner is active", async () => {
    const { display, feedback } = createDisplay();

    await display.stopSpinner("done");
    await display.failSpinner("boom");

    expect(feedback.text).to.equal("");
  });

  it("logs to the requested stream, with or without a spinner", async () => {
    const { display, feedback } = createDisplay();
    const stdout = new MemoryStream();

    display.log("idle", stdout);
    await display.startSpinner("Working");
    display.log("failure", feedback);

    expect(stdout.text).to.equal("idle\n");
    expect(feedback.text).to.equal("failure\n");
  });

  it("logs above the live spinner line", async () => {
    const { display, result, feedback } = createDisplay(true);

    await display.startSpinner("Working");
    display.log("hello", result);

    expect(result.text).to.equal("hello\n");
    expect(feedback.text).to.equal(`⠋ Working\n${ERASE_ONE_LINE}⠋ Working\n`);
    await display.cleanSpinner();
  });

  it("cleans every spinner without a line", async () => {
    const { display, feedback } = createDisplay();

    await display.startSpinner("Outer");
    await display.startSpinner("Inner");
    await display.cleanSpinner();
    await display.cleanSpinner();

    expect(display.isSpinnerActive()).to.equal(false);
    expect(feedback.text).to.equal("");
  });

  it("starts no spinner while silent", async () => {
    const { display, feedback } = createDisplay();

    await display.startSpinner("Before");
    display.setSilent(true);
    await display.startSpinner("Ignored");

    expect(display.isSilent()).to.equal(true);
    expect(display.isSpinnerActive()).to.equal(false);
    display.setSilent(false);
    expect(display.isSilent()).to.equal(false);
    expect(feedback.text).to.equal("");
  });

  it("clears the live spinner line on demand", async () => {
    const { display, feedback } = createDisplay(true);

    await display.startSpinner("Working");
    await display.clearSpinnerLine();

    expect(feedback.text).to.equal(`⠋ Working\n${ERASE_ONE_LINE}`);
    await display.cleanSpinner();
  });
});
