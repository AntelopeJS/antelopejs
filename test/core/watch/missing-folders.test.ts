import { expect } from "chai";
import sinon from "sinon";

import {
  MissingFolders,
  WATCH_RETRY_DELAY_MS,
  WATCH_RETRY_LIMIT,
} from "../../../src/core/runtime";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

describe("MissingFolders with an ancestor watcher that always fails", () => {
  const { warn, error } = console;
  let clock: sinon.SinonFakeTimers;
  let warnings: unknown[][];

  beforeEach(() => {
    clock = sinon.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    warnings = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    console.error = () => {};
  });

  afterEach(() => {
    clock.restore();
    console.warn = warn;
    console.error = error;
  });

  const failingWatcherSetup = async () => {
    const fs = new InMemoryFileSystem();
    await fs.mkdir("/parent", { recursive: true });
    const watched: string[] = [];
    const watchDirectory = (dir: string) => {
      watched.push(dir);
      return {
        close: () => {},
        on: (_event: "error", listener: (error: Error) => void) => {
          queueMicrotask(() => listener(new Error("EIO")));
        },
      };
    };
    const folders: MissingFolders = new MissingFolders(
      fs,
      (folder) => void folders.follow(folder),
      watchDirectory,
    );
    return { folders, watched };
  };

  it("re-creates it a bounded number of times with a delay, then stops with one warning", async () => {
    const { folders, watched } = await failingWatcherSetup();
    await folders.follow("/parent/missing");
    await clock.tickAsync(0);
    expect(watched).to.have.length(1);

    await clock.tickAsync(WATCH_RETRY_DELAY_MS - 1);
    expect(watched).to.have.length(1);
    await clock.tickAsync(1);
    expect(watched).to.have.length(2);

    await clock.tickAsync(WATCH_RETRY_DELAY_MS * (WATCH_RETRY_LIMIT + 5));
    expect(watched).to.have.length(WATCH_RETRY_LIMIT + 1);
    expect(watched.every((dir) => dir === "/parent")).to.equal(true);
    expect(warnings).to.have.length(1);
    expect(String(warnings[0]?.[0])).to.include("/parent");
    expect(clock.countTimers()).to.equal(0);

    await folders.follow("/parent/missing");
    await clock.tickAsync(WATCH_RETRY_DELAY_MS * 2);
    expect(watched).to.have.length(WATCH_RETRY_LIMIT + 1);
    folders.close();
  });

  it("cancels a pending re-creation on close", async () => {
    const { folders, watched } = await failingWatcherSetup();
    await folders.follow("/parent/missing");
    await clock.tickAsync(0);
    folders.close();

    await clock.tickAsync(WATCH_RETRY_DELAY_MS * 2);
    expect(watched).to.have.length(1);
    expect(clock.countTimers()).to.equal(0);
  });
});
