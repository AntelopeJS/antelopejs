import sinon from "sinon";
import { expect } from "chai";
import { Logging } from "@antelopejs/interface-core/logging";
import {
  GetModuleContext,
  RunWithModuleContext,
} from "@antelopejs/interface-core/modules";

import { Resolver } from "../../../src/core/resolution/resolver";
import { PathMapper } from "../../../src/core/resolution/path-mapper";
import { clearForeignPackageWarnings } from "../../../src/core/resolution/foreign-package-warning";

const CONSUMER_FILE = "/project/consumer/index.js";
const OWNER_FILE = "/project/owner/pages.js";

function createOwnerModule(id: string, folder: string): any {
  return {
    id,
    manifest: { folder, srcAliases: [], paths: [] },
    runInContext: <T>(callback: () => T): T =>
      RunWithModuleContext({ module: id, owner: `${id}#1` }, callback),
  };
}

function createResolver(): Resolver {
  const resolver = new Resolver(new PathMapper(() => false));
  resolver.moduleByFolder.set(
    "/project/consumer",
    createOwnerModule("consumer", "/project/consumer"),
  );
  resolver.moduleByFolder.set(
    "/project/owner",
    createOwnerModule("owner", "/project/owner"),
  );
  return resolver;
}

function claimAsConsumer(resolver: Resolver, filePath: string): string {
  return RunWithModuleContext({ module: "consumer", owner: "consumer#1" }, () =>
    resolver.claimFileOwnership(
      filePath,
      () => GetModuleContext()?.module ?? "",
    ),
  );
}

describe("Resolver file ownership", () => {
  beforeEach(() => {
    clearForeignPackageWarnings();
  });

  afterEach(() => {
    sinon.restore();
    clearForeignPackageWarnings();
  });

  it("evaluates a foreign package file under its owning module", () => {
    expect(claimAsConsumer(createResolver(), OWNER_FILE)).to.equal("owner");
  });

  it("leaves the module's own files under its own context", () => {
    expect(claimAsConsumer(createResolver(), CONSUMER_FILE)).to.equal(
      "consumer",
    );
  });

  it("leaves dependencies installed under the owning module untouched", () => {
    expect(
      claimAsConsumer(
        createResolver(),
        "/project/owner/node_modules/shared/index.js",
      ),
    ).to.equal("consumer");
  });

  it("leaves interface package files shared between consumers", () => {
    const resolver = createResolver();
    resolver.interfacePackages.set(
      "@antelopejs/interface-owner",
      "/project/owner/interfaces/owner",
    );

    expect(
      claimAsConsumer(resolver, "/project/owner/interfaces/owner/index.js"),
    ).to.equal("consumer");
  });

  it("leaves files of an unloaded package attributed to the requiring module", () => {
    expect(
      claimAsConsumer(createResolver(), "/project/library/index.js"),
    ).to.equal("consumer");
  });

  it("warns once per consumer and owner pair", () => {
    const warn = sinon.stub(Logging.Channel.prototype, "Warn");
    const resolver = createResolver();

    claimAsConsumer(resolver, OWNER_FILE);
    claimAsConsumer(resolver, "/project/owner/controllers.js");
    claimAsConsumer(resolver, CONSUMER_FILE);

    expect(warn.callCount).to.equal(1);
    expect(String(warn.firstCall.args[0])).to.contain(
      "Module 'consumer' evaluates files of module 'owner'",
    );
    expect(String(warn.firstCall.args[0])).to.contain("interface package");
  });

  it("warns again once the warnings are cleared", () => {
    const warn = sinon.stub(Logging.Channel.prototype, "Warn");
    const resolver = createResolver();

    claimAsConsumer(resolver, OWNER_FILE);
    resolver.clearCache();
    claimAsConsumer(resolver, OWNER_FILE);

    expect(warn.callCount).to.equal(2);
  });

  it("skips the ownership check for builtins and contextless requires", () => {
    const resolver = createResolver();

    expect(resolver.requiresOwnershipCheck("node:fs")).to.equal(false);
    expect(resolver.requiresOwnershipCheck("fs")).to.equal(false);
    expect(resolver.requiresOwnershipCheck("owner/pages")).to.equal(false);
    expect(
      RunWithModuleContext({ module: "consumer", owner: "consumer#1" }, () =>
        resolver.requiresOwnershipCheck("owner/pages"),
      ),
    ).to.equal(true);
  });
});
