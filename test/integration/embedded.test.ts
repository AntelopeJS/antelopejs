import fs from "node:fs/promises";
import path from "node:path";
import { internal } from "@antelopejs/interface-core/internal";
import { expect } from "chai";
import { type AntelopeRuntime, createRuntime } from "../../src";
import { terminalDisplay } from "../../src/core/cli/terminal-display";
import { HOST_MODULE_ID } from "../../src/core/embedded/prepare-embedded";
import {
  createEmbeddedFixture,
  type EmbeddedFixture,
  HOST_INTERFACE_PACKAGE,
  INTERFACE_PACKAGE,
  INTERFACE_SUBPATH,
  PROVIDER_MODULE,
  removeEmbeddedFixture,
} from "../helpers/embedded-fixture";

const HANG_TIMEOUT_MS = 1000;

interface GreeterInterface {
  Greeter: { greet(name: string): Promise<string> };
}

interface ClockInterface {
  HostClock: { now(): Promise<string> };
}

function startEmbedded(
  fixture: EmbeddedFixture,
  overrides: Record<string, unknown> = {},
): AntelopeRuntime {
  return createRuntime({
    projectFolder: fixture.projectFolder,
    modules: {
      [PROVIDER_MODULE]: {
        path: `./${PROVIDER_MODULE}`,
        config: { prefix: "Hello" },
      },
    },
    uses: [INTERFACE_PACKAGE],
    ...overrides,
  });
}

function withHangGuard<T>(promise: Promise<T>): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("HANG")), HANG_TIMEOUT_MS),
    ),
  ]);
}

describe("Embedded runtime", () => {
  let fixture: EmbeddedFixture;
  let runtime: AntelopeRuntime | undefined;

  beforeEach(async () => {
    fixture = await createEmbeddedFixture();
  });

  afterEach(async () => {
    await runtime?.stop();
    runtime = undefined;
    await removeEmbeddedFixture(fixture);
  });

  it("routes a host interface call to a module implementation", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    const greeter = runtime.use<GreeterInterface>(INTERFACE_PACKAGE);

    expect(await withHangGuard(greeter.Greeter.greet("world"))).to.equal(
      "Hello world",
    );
  });

  it("routes a host call made through an interface package subpath", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    const greeter = runtime.use<GreeterInterface>(
      `${INTERFACE_PACKAGE}/${INTERFACE_SUBPATH}`,
    );

    expect(await withHangGuard(greeter.Greeter.greet("world"))).to.equal(
      "Hello world",
    );
  });

  it("rejects a subpath of an interface no loaded module provides", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    expect(() => runtime?.use("missing-pkg/sub")).to.throw(/not provided/);
  });

  it("rejects an interface no loaded module provides", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    expect(() => runtime?.use("missing-pkg")).to.throw(/not provided/);
  });

  it("refuses to hand out interfaces before start", () => {
    runtime = startEmbedded(fixture);
    expect(() => runtime?.use(INTERFACE_PACKAGE)).to.throw(/not been started/);
  });

  it("gives the host a module identity that survives an association rebuild", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    runtime.manager.refreshAssociations();

    const tracked = internal.moduleByFolder.filter(
      (entry) => entry.id === HOST_MODULE_ID,
    );
    expect(tracked).to.have.lengthOf(1);
    expect(internal.interfaceConnections[HOST_MODULE_ID]).to.have.property(
      INTERFACE_PACKAGE,
    );
  });

  it("keeps host calls working after an association rebuild", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    runtime.manager.refreshAssociations();
    const greeter = runtime.use<GreeterInterface>(INTERFACE_PACKAGE);

    expect(await withHangGuard(greeter.Greeter.greet("again"))).to.equal(
      "Hello again",
    );
  });

  it("leaves process signal handlers to the host", async () => {
    const before = {
      sigint: process.listenerCount("SIGINT"),
      sigterm: process.listenerCount("SIGTERM"),
      uncaught: process.listenerCount("uncaughtException"),
    };

    runtime = startEmbedded(fixture);
    await runtime.start();

    expect(process.listenerCount("SIGINT")).to.equal(before.sigint);
    expect(process.listenerCount("SIGTERM")).to.equal(before.sigterm);
    expect(process.listenerCount("uncaughtException")).to.equal(
      before.uncaught,
    );
  });

  it("never creates a module cache directory", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    const cacheFolder = path.join(
      fixture.projectFolder,
      ".antelope",
      "embedded-cache",
    );
    expect(
      await fs
        .stat(cacheFolder)
        .then(() => true)
        .catch(() => false),
    ).to.equal(false);
  });

  it("fails to start when a declared interface resolves to nothing", async () => {
    runtime = startEmbedded(fixture, {
      uses: [INTERFACE_PACKAGE, "not-installed-pkg"],
    });

    const error = await runtime.start().then(
      () => undefined,
      (reason: Error) => reason,
    );
    expect(error?.message).to.match(/not-installed-pkg/);
  });

  it("does not itself reject a prerelease interface package", async () => {
    await removeEmbeddedFixture(fixture);
    fixture = await createEmbeddedFixture({
      interfaceVersion: "1.0.0-beta.1",
      providerRange: "latest",
    });

    runtime = startEmbedded(fixture);
    await runtime.start();

    const greeter = runtime.use<GreeterInterface>(INTERFACE_PACKAGE);
    expect(await withHangGuard(greeter.Greeter.greet("beta"))).to.equal(
      "Hello beta",
    );
  });

  it("shares one launch between concurrent start calls", async () => {
    runtime = startEmbedded(fixture);

    await Promise.all([runtime.start(), runtime.start()]);

    expect(runtime.manager.listModules()).to.have.lengthOf(3);
  });

  it("waits for an in-flight start before shutting down", async () => {
    runtime = startEmbedded(fixture);

    const starting = runtime.start();
    await runtime.stop();
    await starting;

    expect(runtime.isRunning).to.equal(false);
  });

  it("restores spinner output after a failed launch", async () => {
    runtime = startEmbedded(fixture, { uses: ["not-installed-pkg"] });
    await runtime.start().catch(() => undefined);

    expect(terminalDisplay.isSilent()).to.equal(false);
  });

  it("refuses to provide an interface the host did not declare", async () => {
    runtime = startEmbedded(fixture);
    await runtime.start();

    expect(() =>
      runtime?.provide(INTERFACE_PACKAGE, { Greeter: { greet: () => "x" } }),
    ).to.throw(/not declared in 'provides'/);
  });

  it("attaches a host implementation and releases it on detach", async () => {
    runtime = startEmbedded(fixture, {
      uses: [INTERFACE_PACKAGE, HOST_INTERFACE_PACKAGE],
      provides: [HOST_INTERFACE_PACKAGE],
    });
    await runtime.start();

    const handle = runtime.provide(HOST_INTERFACE_PACKAGE, {
      HostClock: { now: () => "host-time" },
    });

    const clock = runtime.use<ClockInterface>(HOST_INTERFACE_PACKAGE);
    expect(await withHangGuard(clock.HostClock.now())).to.equal("host-time");

    handle.detach();

    const afterDetach = await withHangGuard(clock.HostClock.now()).then(
      () => "resolved",
      (error: Error) => error.message,
    );
    expect(afterDetach).to.equal("HANG");
  });
});
