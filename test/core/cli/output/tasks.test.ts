import { expect } from "chai";
import * as sinon from "sinon";

import {
  getProcessTasks,
  getProcessUi,
  runTask,
  TaskList,
  type OutputCapabilities,
} from "../../../../src/core/cli/output";
import { MemoryStream } from "../../../helpers/memory-ui";

const ERASE_ONE_LINE = "\x1b[1A\r\x1b[J";
const ERASE_TWO_LINES = "\x1b[2A\r\x1b[J";
const FRAME_INTERVAL_MS = 80;

const CAPABILITIES: OutputCapabilities = {
  hasUnicode: true,
  colors: { result: false, feedback: false },
  terminals: { result: true, feedback: true },
};

interface TaskListFixture {
  tasks: TaskList;
  result: MemoryStream;
  feedback: MemoryStream;
  clock: Clock;
}

interface Clock {
  now: number;
}

function createTasks(isLive = false): TaskListFixture {
  const result = new MemoryStream(isLive);
  const feedback = new MemoryStream(isLive);
  const clock: Clock = { now: 0 };
  const tasks = new TaskList({
    streams: { result, feedback },
    capabilities: CAPABILITIES,
    isLive,
    now: () => clock.now,
  });
  return { tasks, result, feedback, clock };
}

describe("output task list (append-only)", () => {
  it("prints only the final line of each task", () => {
    const { tasks, feedback } = createTasks();

    const build = tasks.start("Building");
    const install = tasks.start("Installing");
    const skipped = tasks.start("Checking");
    const warned = tasks.start("Fetching");
    const hidden = tasks.start("Hidden");
    install.fail("Install failed");
    build.succeed("Built");
    skipped.skip();
    warned.warn("Fetched from cache");
    hidden.dismiss();

    expect(feedback.text).to.equal(
      "✖ Install failed\n✔ Built\n– Checking\n▲ Fetched from cache\n",
    );
  });

  it("counts only the first call that finishes a task", () => {
    const { tasks, feedback } = createTasks();

    const task = tasks.start("Building");
    task.succeed("Built");
    task.fail("Failed");
    task.dismiss();

    expect(feedback.text).to.equal("✔ Built\n");
    expect(tasks.hasRunningTasks()).to.equal(false);
  });

  it("adds the duration of tasks that took a second or more", () => {
    const { tasks, feedback, clock } = createTasks();

    const quick = tasks.start("Quick");
    const slow = tasks.start("Slow");
    clock.now = 999;
    quick.succeed();
    clock.now = 2100;
    slow.succeed("Slow done");

    expect(feedback.text).to.equal("✔ Quick\n✔ Slow done 2.1s\n");
  });

  it("writes messages and raw lines straight through", () => {
    const { tasks, result, feedback } = createTasks();

    tasks.start("Working");
    tasks.write(result, "log line\n");
    tasks.message("info", "Note", { details: ["first", "second"] });

    expect(result.text).to.equal("log line\n");
    expect(feedback.text).to.equal("ℹ Note\n  first\n  second\n");
  });

  it("prints nothing while silent but keeps writing raw lines", () => {
    const { tasks, result, feedback } = createTasks();

    tasks.setSilent(true);
    const task = tasks.start("Working");
    task.update("Still working");
    task.succeed("Done");
    task.warn();
    task.skip();
    task.fail();
    task.dismiss();
    tasks.message("error", "Hidden");
    tasks.write(result, "log line\n");

    expect(tasks.isSilent()).to.equal(true);
    expect(tasks.hasRunningTasks()).to.equal(false);
    expect(feedback.text).to.equal("");
    expect(result.text).to.equal("log line\n");
  });

  it("drops running tasks without a line when it turns silent", () => {
    const { tasks, feedback } = createTasks();

    const task = tasks.start("Working");
    tasks.setSilent(true);
    tasks.setSilent(false);
    task.succeed();

    expect(feedback.text).to.equal("");
  });
});

describe("output task list run", () => {
  it("prints the done label and resolves with the result", async () => {
    const { tasks, feedback } = createTasks();

    const fixed = await tasks.run("Loading", async () => 2, {
      done: "Loaded",
    });
    const computed = await tasks.run("Counting", async () => 3, {
      done: (count) => `Counted ${count}`,
    });

    expect(fixed).to.equal(2);
    expect(computed).to.equal(3);
    expect(feedback.text).to.equal("✔ Loaded\n✔ Counted 3\n");
  });

  it("prints the failed label and rethrows", async () => {
    const { tasks, feedback } = createTasks();
    const failure = new Error("boom");

    const error = await tasks
      .run("Loading", () => Promise.reject(failure), {
        done: "Loaded",
        failed: "Could not load",
      })
      .catch((err: unknown) => err);

    expect(error).to.equal(failure);
    expect(feedback.text).to.equal("✖ Could not load\n");
  });

  it("leaves a failure without failed label to whoever catches it", async () => {
    const { tasks, feedback } = createTasks();

    const error = await tasks
      .run("Loading", () => Promise.reject(new Error("boom")), {
        done: "Loaded",
      })
      .catch((err: unknown) => err);

    expect(error).to.be.instanceOf(Error);
    expect(feedback.text).to.equal("");
  });

  it("keeps the line the work printed itself", async () => {
    const { tasks, feedback } = createTasks();

    await tasks.run(
      "Fetching",
      async (task) => {
        task.warn("Using cached copy");
      },
      { done: "Fetched" },
    );

    expect(feedback.text).to.equal("▲ Using cached copy\n");
  });
});

describe("output task list (live)", () => {
  afterEach(() => {
    sinon.restore();
  });

  it("draws one line per running task, in start order", () => {
    const { tasks, feedback } = createTasks(true);

    const first = tasks.start("Installing module-a");
    tasks.start("Installing module-b");
    first.succeed("Installed module-a");

    expect(feedback.text).to.equal(
      [
        "⠋ Installing module-a\n",
        ERASE_ONE_LINE,
        "⠋ Installing module-a\n⠋ Installing module-b\n",
        ERASE_TWO_LINES,
        "✔ Installed module-a\n",
        "⠋ Installing module-b\n",
      ].join(""),
    );
  });

  it("erases the list once the last task is finished", () => {
    const { tasks, feedback } = createTasks(true);

    tasks.start("Working").dismiss();

    expect(feedback.text).to.equal(`⠋ Working\n${ERASE_ONE_LINE}`);
    expect(tasks.hasRunningTasks()).to.equal(false);
  });

  it("writes log lines above the list", () => {
    const { tasks, result, feedback } = createTasks(true);

    tasks.start("Working");
    tasks.write(result, "log line\n");

    expect(result.text).to.equal("log line\n");
    expect(feedback.text).to.equal(
      `⠋ Working\n${ERASE_ONE_LINE}⠋ Working\n`,
    );
  });

  it("waits for the end of an open line before drawing again", () => {
    const { tasks, feedback } = createTasks(true);

    tasks.start("Working");
    tasks.write(feedback, "partial");
    tasks.write(feedback, " line\n");

    expect(feedback.text).to.equal(
      `⠋ Working\n${ERASE_ONE_LINE}partial line\n⠋ Working\n`,
    );
  });

  it("routes direct writes to the streams above the list while it is drawn", () => {
    const { tasks, result, feedback } = createTasks(true);

    const task = tasks.start("Working");
    result.write("console line\n");
    task.succeed("Done");
    result.write("after\n");

    expect(result.text).to.equal("console line\nafter\n");
    expect(feedback.text).to.equal(
      `⠋ Working\n${ERASE_ONE_LINE}⠋ Working\n${ERASE_ONE_LINE}✔ Done\n`,
    );
    expect(Object.hasOwn(result, "write")).to.equal(false);
  });

  it("puts back a write function the stream owned itself", () => {
    const chunks: string[] = [];
    const write = (chunk: string): boolean => chunks.push(chunk) > 0;
    const result = { write };
    const tasks = new TaskList({
      streams: { result, feedback: new MemoryStream(true) },
      capabilities: CAPABILITIES,
      isLive: true,
    });

    const task = tasks.start("Working");
    result.write("line\n");
    task.dismiss();

    expect(result.write).to.equal(write);
    expect(chunks).to.deep.equal(["line\n"]);
  });

  it("captures a stream used for both channels once", () => {
    const stream = new MemoryStream(true);
    const tasks = new TaskList({
      streams: { result: stream, feedback: stream },
      capabilities: CAPABILITIES,
      isLive: true,
    });

    const task = tasks.start("Working");
    stream.write("line\n");
    task.dismiss();

    expect(stream.text).to.equal(
      `⠋ Working\n${ERASE_ONE_LINE}line\n⠋ Working\n${ERASE_ONE_LINE}`,
    );
  });

  it("animates the running tasks and relabels them", () => {
    const clock = sinon.useFakeTimers();
    const { tasks, feedback } = createTasks(true);

    const task = tasks.start("Working");
    clock.tick(FRAME_INTERVAL_MS);
    task.update("Still working");
    task.dismiss();
    clock.tick(FRAME_INTERVAL_MS);

    expect(feedback.text).to.equal(
      [
        "⠋ Working\n",
        ERASE_ONE_LINE,
        "⠙ Working\n",
        ERASE_ONE_LINE,
        "⠙ Still working\n",
        ERASE_ONE_LINE,
      ].join(""),
    );
  });

  it("truncates labels to the terminal width", () => {
    const { tasks, feedback } = createTasks(true);
    feedback.columns = 12;

    tasks.start("Installing dependencies");

    expect(feedback.text).to.equal("⠋ Installi…\n");
  });

  it("truncates labels with the ASCII ellipsis", () => {
    const feedback = new MemoryStream(true);
    feedback.columns = 12;
    const tasks = new TaskList({
      streams: { result: new MemoryStream(true), feedback },
      capabilities: { ...CAPABILITIES, hasUnicode: false },
      isLive: true,
    });

    tasks.start("Installing dependencies");

    expect(feedback.text).to.equal("- Instal...\n");
  });

  it("erases the list on demand until the next frame", () => {
    const { tasks, feedback } = createTasks(true);

    tasks.start("Working");
    tasks.clearLiveLines();
    tasks.clearLiveLines();

    expect(feedback.text).to.equal(`⠋ Working\n${ERASE_ONE_LINE}`);
  });

  it("writes ui messages above the list", () => {
    const { tasks, feedback } = createTasks(true);

    tasks.start("Working");
    tasks.ui.message("warn", "Careful");

    expect(feedback.text).to.equal(
      `⠋ Working\n${ERASE_ONE_LINE}▲ Careful\n⠋ Working\n`,
    );
  });
});

describe("output process task list", () => {
  it("is created once and backs the process ui", async () => {
    const tasks = getProcessTasks();
    const runStub = sinon.stub(tasks, "run").resolves("done");

    const result = await runTask("Working", async () => "ignored", {
      done: "Done",
    });

    runStub.restore();
    expect(getProcessTasks()).to.equal(tasks);
    expect(getProcessUi()).to.equal(tasks.ui);
    expect(result).to.equal("done");
  });
});
