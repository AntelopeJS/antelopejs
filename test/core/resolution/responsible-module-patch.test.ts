import { expect } from "chai";
import {
  type CallSiteLike,
  computeResponsibleModule,
  type ModuleFolderEntryInternal,
} from "../../../src/core/resolution/responsible-module-patch";

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

  it("stops walking when a frame has no functionName but has a typeName", () => {
    const entries: ModuleFolderEntryInternal[] = [{ id: "local", dir: "/app" }];
    const trace: CallSiteLike[] = [
      frame("/somewhere/else.js", { functionName: null, typeName: "Foo" }),
      frame("/app/dist/index.js"),
    ];

    expect(computeResponsibleModule(trace, entries)).to.equal(undefined);
  });
});
