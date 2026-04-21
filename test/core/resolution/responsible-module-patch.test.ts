import { RegisteringProxy } from "@antelopejs/interface-core";
import { expect } from "chai";
import {
  applyResponsibleModulePatch,
  type CallSiteLike,
  computeResponsibleModule,
  type ModuleFolderEntryInternal,
} from "../../../src/core/resolution/responsible-module-patch";

applyResponsibleModulePatch();

function frame(
  fileName: string | null,
  opts: { functionName?: string | null; typeName?: string | null } = {},
): CallSiteLike {
  return {
    getFileName: () => fileName,
    getFunctionName: () =>
      "functionName" in opts ? (opts.functionName ?? null) : "fn",
    getTypeName: () => opts.typeName ?? null,
  };
}

describe("computeResponsibleModule", () => {
  it("skips node_modules frames and walks to the user module", () => {
    const entries: ModuleFolderEntryInternal[] = [{ id: "local", dir: "/app" }];
    const trace: CallSiteLike[] = [
      frame("/app/node_modules/@antelopejs/interface-core/dist/proxies.js"),
      frame("/app/dist/pages/skins.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("local");
  });

  it("skips node:internal frames", () => {
    const entries: ModuleFolderEntryInternal[] = [{ id: "local", dir: "/app" }];
    const trace: CallSiteLike[] = [
      frame("node:internal/process/task_queues"),
      frame("/app/dist/index.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("local");
  });

  it("returns the first non-implementor match, even when an implementor matches earlier", () => {
    const entries: ModuleFolderEntryInternal[] = [
      { id: "cms", dir: "/project/cms", isImplementor: true },
      { id: "playground", dir: "/project/cms/playground" },
    ];
    const trace: CallSiteLike[] = [
      frame("/project/cms/dist/interfaces/cms/page.js"),
      frame("/project/cms/dist/interfaces/cms/page.js"),
      frame("/project/cms/playground/dist/table-view/drawer/page.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("playground");
  });

  it("falls back to the first implementor match when no user frame matches", () => {
    const entries: ModuleFolderEntryInternal[] = [
      { id: "cms", dir: "/project/cms", isImplementor: true },
    ];
    const trace: CallSiteLike[] = [
      frame("/project/cms/dist/interfaces/cms/page.js"),
      frame("/project/cms/dist/implementations/cms/hooks.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("cms");
  });

  it("returns undefined when no frame matches any module", () => {
    const entries: ModuleFolderEntryInternal[] = [{ id: "local", dir: "/app" }];
    const trace: CallSiteLike[] = [
      frame("/some/unrelated/file.js"),
      frame("/other/path.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal(undefined);
  });

  it("picks the longest matching folder on a single frame", () => {
    const entries: ModuleFolderEntryInternal[] = [
      { id: "cms", dir: "/project/cms", isImplementor: true },
      { id: "playground", dir: "/project/cms/playground" },
    ];
    const trace: CallSiteLike[] = [
      frame("/project/cms/playground/dist/table-view/drawer/page.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("playground");
  });

  it("returns the consumer module when the implementor lives in its cache folder (laytho-backend shape)", () => {
    const entries: ModuleFolderEntryInternal[] = [
      { id: "local", dir: "/home/user/app" },
      {
        id: "cms",
        dir: "/home/user/app/.antelope/cache/@antelopejs-private/cms",
        isImplementor: true,
      },
    ];
    const trace: CallSiteLike[] = [
      frame(
        "/home/user/app/.antelope/cache/@antelopejs-private/cms/dist/interfaces/cms/page.js",
      ),
      frame("/home/user/app/dist/pages/skins.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("local");
  });

  it("does not abort on unmatched frames with no functionName but a typeName", () => {
    const entries: ModuleFolderEntryInternal[] = [{ id: "local", dir: "/app" }];
    const trace: CallSiteLike[] = [
      frame("/somewhere/else.js", { functionName: null, typeName: "Foo" }),
      frame("/app/dist/index.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("local");
  });

  it("walks past anonymous frames between implementor and consumer", () => {
    const entries: ModuleFolderEntryInternal[] = [
      { id: "cms", dir: "/project/cms", isImplementor: true },
      { id: "playground", dir: "/project/cms/playground" },
    ];
    const trace: CallSiteLike[] = [
      frame("/project/cms/dist/interfaces/cms/page.js"),
      frame("/third-party/anon.js", { functionName: null, typeName: "Proxy" }),
      frame("/project/cms/playground/dist/page.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal("playground");
  });
});

describe("RegisteringProxy replay resilience", () => {
  it("replays every entry even when an earlier callback throws", () => {
    const proxy = new RegisteringProxy<(id: string, arg: string) => void>();
    proxy.register("a", "alpha");
    proxy.register("b", "beta");
    proxy.register("c", "gamma");

    const seen: string[] = [];
    const callback = (id: string, arg: string) => {
      seen.push(`${id}:${arg}`);
      if (id === "a") {
        throw new Error("boom");
      }
    };

    proxy.onRegister(callback, true);

    expect(seen).to.deep.equal(["a:alpha", "b:beta", "c:gamma"]);
  });
});
