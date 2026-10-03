import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sinon from "sinon";
import { expect } from "chai";

import * as cliUi from "../../../src/core/cli/cli-ui";
import {
  UpdateCheck,
  UpdateCheckContext,
  UpdateCheckDependencies,
  reportAvailableUpdate,
  shouldCheckForUpdates,
  startUpdateCheck,
} from "../../../src/core/cli/version-check";

const NOW = Date.UTC(2026, 0, 2);
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const FETCH_TIMEOUT_MS = 1000;
const REGISTRY_LATEST_URL =
  "https://registry.npmjs.org/@antelopejs/core/latest";

const INTERACTIVE_CONTEXT: UpdateCheckContext = {
  args: ["project", "modules", "list"],
  env: {},
  isStderrTerminal: true,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function pendingFetch(): typeof fetch {
  return (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () =>
        reject(init.signal?.reason),
      );
    });
}

let cacheDirectory: string;
let cachePath: string;

function dependencies(
  fetchManifest: typeof fetch,
  now: number = NOW,
): UpdateCheckDependencies {
  return { fetch: fetchManifest, cachePath, now: () => now };
}

function writeCache(content: unknown): void {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(content));
}

function readCache(): unknown {
  return JSON.parse(fs.readFileSync(cachePath, "utf8"));
}

function useTemporaryCache(): void {
  beforeEach(() => {
    cacheDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ajs-update-"));
    cachePath = path.join(cacheDirectory, ".antelopejs", "update-check.json");
  });

  afterEach(() => {
    sinon.restore();
    fs.rmSync(cacheDirectory, { recursive: true, force: true });
  });
}

describe("shouldCheckForUpdates", () => {
  useTemporaryCache();

  const skippedInvocations: Record<string, Partial<UpdateCheckContext>> = {
    "--version": { args: ["--version"] },
    "-v": { args: ["-v"] },
    "--help": { args: ["project", "--help"] },
    "-h": { args: ["module", "-h"] },
    "the help command": { args: ["help", "project"] },
    "no arguments": { args: [] },
    "--json": { args: ["project", "logging", "show", "--json"] },
    "-j": { args: ["project", "logging", "show", "-j"] },
    "CI=true": { env: { CI: "true" } },
    CI: { env: { CI: "1" } },
    "AJS_NO_UPDATE_CHECK=1": { env: { AJS_NO_UPDATE_CHECK: "1" } },
    "non-TTY stderr": { isStderrTerminal: false },
  };

  for (const [name, override] of Object.entries(skippedInvocations)) {
    it(`skips the check for ${name}`, () => {
      expect(
        shouldCheckForUpdates({ ...INTERACTIVE_CONTEXT, ...override }),
      ).to.equal(false);
    });
  }

  it("checks interactive commands", () => {
    expect(shouldCheckForUpdates(INTERACTIVE_CONTEXT)).to.equal(true);
  });

  it("treats disabled flag values as unset", () => {
    const context = {
      ...INTERACTIVE_CONTEXT,
      env: { CI: "false", AJS_NO_UPDATE_CHECK: "0" },
    };

    expect(shouldCheckForUpdates(context)).to.equal(true);
  });
});

describe("startUpdateCheck", () => {
  useTemporaryCache();

  it("does not start a check when skipped", () => {
    const fetchStub = sinon.stub();

    const check = startUpdateCheck(
      { ...INTERACTIVE_CONTEXT, isStderrTerminal: false },
      dependencies(fetchStub),
    );

    expect(check).to.equal(undefined);
    expect(fetchStub.called).to.equal(false);
  });

  it("reads the process context by default", () => {
    sinon.stub(process, "env").value({ AJS_NO_UPDATE_CHECK: "1" });

    expect(startUpdateCheck()).to.equal(undefined);
  });

  it("caches under the home directory by default", async () => {
    sinon.stub(os, "homedir").returns(cacheDirectory);
    const fetchStub = sinon
      .stub(globalThis, "fetch")
      .resolves(jsonResponse({ version: "2.0.0" }));

    const check = startUpdateCheck(INTERACTIVE_CONTEXT);
    await check?.completion;

    expect(fetchStub.calledOnce).to.equal(true);
    expect(check?.latestVersion).to.equal("2.0.0");
    expect(readCache()).to.have.property("latestVersion", "2.0.0");
  });
});

describe("UpdateCheck cache", () => {
  useTemporaryCache();

  it("uses a fresh cache without hitting the registry", async () => {
    writeCache({ checkedAt: NOW - HOUR_MS, latestVersion: "1.5.0" });
    const fetchStub = sinon.stub();

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal("1.5.0");
    expect(fetchStub.called).to.equal(false);
  });

  it("fetches the latest version and caches it on a cache miss", async () => {
    const fetchStub = sinon.stub().resolves(jsonResponse({ version: "2.0.0" }));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(fetchStub.firstCall.args[0]).to.equal(REGISTRY_LATEST_URL);
    expect(check.latestVersion).to.equal("2.0.0");
    expect(readCache()).to.deep.equal({
      checkedAt: NOW,
      latestVersion: "2.0.0",
    });
  });

  it("records the attempt before the registry answers", () => {
    const check = new UpdateCheck(dependencies(pendingFetch()));

    expect(readCache()).to.deep.equal({ checkedAt: NOW });
    check.cancel();
  });

  it("does not retry a failed attempt within 24 hours", async () => {
    writeCache({ checkedAt: NOW - HOUR_MS });
    const fetchStub = sinon.stub();

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal(undefined);
    expect(fetchStub.called).to.equal(false);
  });

  it("refreshes an expired cache", async () => {
    writeCache({ checkedAt: NOW - DAY_MS, latestVersion: "1.5.0" });
    const fetchStub = sinon.stub().resolves(jsonResponse({ version: "2.0.0" }));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(fetchStub.calledOnce).to.equal(true);
    expect(check.latestVersion).to.equal("2.0.0");
  });

  it("keeps the last known version when a refresh fails", async () => {
    writeCache({ checkedAt: NOW - DAY_MS, latestVersion: "1.5.0" });
    const fetchStub = sinon.stub().rejects(new TypeError("fetch failed"));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal("1.5.0");
    expect(readCache()).to.deep.equal({
      checkedAt: NOW,
      latestVersion: "1.5.0",
    });
  });

  it("refreshes a cache written in the future", async () => {
    writeCache({ checkedAt: NOW + HOUR_MS, latestVersion: "1.5.0" });
    const fetchStub = sinon.stub().resolves(jsonResponse({ version: "2.0.0" }));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(fetchStub.calledOnce).to.equal(true);
  });

  const invalidCaches: Record<string, unknown> = {
    "a non-object": null,
    "a missing timestamp": { latestVersion: "1.5.0" },
    "an invalid version": { checkedAt: NOW, latestVersion: "latest" },
  };

  for (const [name, content] of Object.entries(invalidCaches)) {
    it(`ignores a cache holding ${name}`, async () => {
      writeCache(content);
      const fetchStub = sinon
        .stub()
        .resolves(jsonResponse({ version: "2.0.0" }));

      const check = new UpdateCheck(dependencies(fetchStub));
      await check.completion;

      expect(fetchStub.calledOnce).to.equal(true);
    });
  }

  it("ignores an unreadable cache", async () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "{not json");
    const fetchStub = sinon.stub().resolves(jsonResponse({ version: "2.0.0" }));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal("2.0.0");
  });
});

describe("UpdateCheck registry requests", () => {
  useTemporaryCache();

  it("stays quiet when the registry is unreachable", async () => {
    const errorStub = sinon.stub(console, "error");
    const fetchStub = sinon.stub().rejects(new TypeError("fetch failed"));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal(undefined);
    expect(readCache()).to.deep.equal({ checkedAt: NOW });
    expect(errorStub.called).to.equal(false);
  });

  it("ignores registry error responses", async () => {
    const fetchStub = sinon.stub().resolves(jsonResponse({}, 503));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal(undefined);
    expect(readCache()).to.deep.equal({ checkedAt: NOW });
  });

  const invalidManifests: Record<string, unknown> = {
    "a non-string version": { version: 2 },
    "an invalid version": { version: "not-a-version" },
  };

  for (const [name, manifest] of Object.entries(invalidManifests)) {
    it(`ignores a manifest with ${name}`, async () => {
      const fetchStub = sinon.stub().resolves(jsonResponse(manifest));

      const check = new UpdateCheck(dependencies(fetchStub));
      await check.completion;

      expect(check.latestVersion).to.equal(undefined);
    });
  }

  it("still reports the version when the cache cannot be written", async () => {
    fs.writeFileSync(path.dirname(cachePath), "blocks the cache directory");
    const fetchStub = sinon.stub().resolves(jsonResponse({ version: "2.0.0" }));

    const check = new UpdateCheck(dependencies(fetchStub));
    await check.completion;

    expect(check.latestVersion).to.equal("2.0.0");
  });

  it("aborts a registry request that hangs past the timeout", async () => {
    const clock = sinon.useFakeTimers({ now: NOW });

    const check = new UpdateCheck(dependencies(pendingFetch()));
    await clock.tickAsync(FETCH_TIMEOUT_MS);
    await check.completion;

    expect(check.latestVersion).to.equal(undefined);
  });

  it("aborts the registry request when cancelled", async () => {
    const check = new UpdateCheck(dependencies(pendingFetch()));

    check.cancel();
    await check.completion;

    expect(check.latestVersion).to.equal(undefined);
  });
});

describe("reportAvailableUpdate", () => {
  useTemporaryCache();

  async function checkWithLatest(version: string): Promise<UpdateCheck> {
    writeCache({ checkedAt: NOW, latestVersion: version });
    const check = new UpdateCheck(dependencies(sinon.stub()));
    await check.completion;
    return check;
  }

  it("prints a one-line notice on stderr when a newer version exists", async () => {
    const logStub = sinon.stub(console, "log");
    const errorStub = sinon.stub(console, "error");

    await reportAvailableUpdate("1.0.0", await checkWithLatest("2.0.0"));

    expect(logStub.called).to.equal(false);
    expect(errorStub.calledOnce).to.equal(true);
    expect(errorStub.firstCall.args[0])
      .to.contain("Update available 1.0.0 →")
      .and.to.contain("2.0.0")
      .and.to.contain("ajs update");
  });

  it("stays silent when up to date", async () => {
    const infoStub = sinon.stub(cliUi, "info");

    await reportAvailableUpdate("2.0.0", await checkWithLatest("2.0.0"));

    expect(infoStub.called).to.equal(false);
  });

  it("stays silent when the check was skipped", async () => {
    const infoStub = sinon.stub(cliUi, "info");

    await reportAvailableUpdate("1.0.0", undefined);

    expect(infoStub.called).to.equal(false);
  });

  it("stays silent when the current version is not semver", async () => {
    const infoStub = sinon.stub(cliUi, "info");

    await reportAvailableUpdate("dev", await checkWithLatest("2.0.0"));

    expect(infoStub.called).to.equal(false);
  });

  it("waits for a registry request still in flight", async () => {
    const infoStub = sinon.stub(cliUi, "info");
    let answer: (response: Response) => void = () => undefined;
    const fetchStub = sinon.stub().returns(
      new Promise<Response>((resolve) => {
        answer = resolve;
      }),
    );
    const check = new UpdateCheck(dependencies(fetchStub));

    const report = reportAvailableUpdate("1.0.0", check);
    answer(jsonResponse({ version: "2.0.0" }));
    await report;

    expect(infoStub.calledOnce).to.equal(true);
  });

  it("waits no longer than the registry timeout", async () => {
    const clock = sinon.useFakeTimers({ now: NOW });
    const infoStub = sinon.stub(cliUi, "info");
    const check = new UpdateCheck(dependencies(pendingFetch()));

    const report = reportAvailableUpdate("1.0.0", check);
    await clock.tickAsync(FETCH_TIMEOUT_MS);
    await report;

    expect(infoStub.called).to.equal(false);
  });
});
