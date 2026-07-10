import { expect } from "chai";
import sinon from "sinon";
import { FileWatcher } from "../../../src/core/watch/file-watcher";
import { InMemoryFileSystem } from "../../helpers/in-memory-filesystem";

describe("FileWatcher", () => {
  it("should detect file changes for a module", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/a.txt", "a");
    await fs.writeFile("/mod/node_modules/ignore.txt", "x");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile("/mod/a.txt", "b");
    await watcher.handleFileChange("/mod/a.txt");

    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await watcher.handleFileChange("/mod/node_modules/ignore.txt");
    expect(changes).to.deep.equal([]);
  });

  it("should ignore unchanged files", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/a.txt", "a");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await watcher.handleFileChange("/mod/a.txt");
    expect(changes).to.deep.equal([]);
  });

  it("ignores missing files and directories in handleFileChange", async () => {
    const fs = new InMemoryFileSystem();
    await fs.mkdir("/mod/dir", { recursive: true });
    const watcher = new FileWatcher(fs);

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await watcher.handleFileChange("/missing.txt");
    await watcher.handleFileChange("/mod/dir");

    expect(changes).to.deep.equal([]);
  });

  it("should detect changes to individually watched files", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "original");

    const watcher = new FileWatcher(fs);
    const changes: string[] = [];
    await watcher.watchFile("/project/antelope.config.ts", (path) =>
      changes.push(path),
    );

    await fs.writeFile("/project/antelope.config.ts", "modified");
    await watcher.handleFileChange("/project/antelope.config.ts");

    expect(changes).to.have.lengthOf(1);
    expect(changes[0]).to.equal("/project/antelope.config.ts");
  });

  it("should ignore unchanged watched files", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "content");

    const watcher = new FileWatcher(fs);
    const changes: string[] = [];
    await watcher.watchFile("/project/antelope.config.ts", (path) =>
      changes.push(path),
    );

    await watcher.handleFileChange("/project/antelope.config.ts");

    expect(changes).to.deep.equal([]);
  });

  it("should support multiple listeners on the same watched file", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/config.ts", "v1");

    const watcher = new FileWatcher(fs);
    const listener1: string[] = [];
    const listener2: string[] = [];
    await watcher.watchFile("/project/config.ts", (p) => listener1.push(p));
    await watcher.watchFile("/project/config.ts", (p) => listener2.push(p));

    await fs.writeFile("/project/config.ts", "v2");
    await watcher.handleFileChange("/project/config.ts");

    expect(listener1).to.have.lengthOf(1);
    expect(listener2).to.have.lengthOf(1);
  });

  it("adopts a new source file so later edits behave like it was always there", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile("/mod/page.js", "class Page {}");
    await watcher.handleFileChange("/mod/page.js");
    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await watcher.handleFileChange("/mod/page.js");
    expect(changes).to.deep.equal([]);

    await fs.writeFile("/mod/page.js", "class Page { render() {} }");
    await watcher.handleFileChange("/mod/page.js");
    expect(changes).to.deep.equal(["mod"]);
  });

  it("tracks module signature changes for added, edited, and removed files", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const initial = watcher.getModuleSignature("mod");

    await fs.writeFile("/mod/page.js", "class Page {}");
    await watcher.handleFileChange("/mod/page.js");
    const afterAdd = watcher.getModuleSignature("mod");
    expect(afterAdd).to.not.equal(initial);

    await fs.writeFile("/mod/page.js", "class Page { render() {} }");
    await watcher.handleFileChange("/mod/page.js");
    expect(watcher.getModuleSignature("mod")).to.not.equal(afterAdd);

    await fs.rm("/mod/page.js");
    await watcher.handleFileChange("/mod/page.js");
    expect(watcher.getModuleSignature("mod")).to.equal(initial);
  });

  it("returns to the pre-trigger signature after a transient temp file appears and is removed", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const baseline = watcher.getModuleSignature("mod");

    await fs.writeFile("/mod/index.js.tmp.5678", "intermediate garbage");
    await watcher.handleFileChange("/mod/index.js.tmp.5678");
    expect(watcher.getModuleSignature("mod")).to.not.equal(baseline);

    await fs.rm("/mod/index.js.tmp.5678");
    await watcher.handleFileChange("/mod/index.js.tmp.5678");
    expect(watcher.getModuleSignature("mod")).to.equal(baseline);
  });

  it("watches a directory created at runtime and reloads for it", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile("/mod/page/page.js", "class Empty {}");
    await watcher.handleFileChange("/mod/page");
    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await fs.writeFile("/mod/page/page.js", "class Full { render() {} }");
    await watcher.handleFileChange("/mod/page/page.js");
    expect(changes).to.deep.equal(["mod"]);
  });

  it("recurses into nested directories created at runtime", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile("/mod/category/xy/page.js", "class Xy {}");
    await watcher.handleFileChange("/mod/category");
    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await fs.writeFile("/mod/category/xy/page.js", "class Xy { render() {} }");
    await watcher.handleFileChange("/mod/category/xy/page.js");
    expect(changes).to.deep.equal(["mod"]);
  });

  it("re-adopts a directory that was removed and recreated", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile("/mod/page/page.js", "class A {}");
    await watcher.handleFileChange("/mod/page");
    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await fs.rm("/mod/page/page.js");
    await fs.rm("/mod/page");
    await watcher.handleFileChange("/mod/page");
    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await fs.writeFile("/mod/page/page.js", "class B {}");
    await watcher.handleFileChange("/mod/page");
    expect(changes).to.deep.equal(["mod"]);

    changes.length = 0;
    await fs.writeFile("/mod/page/page.js", "class B { render() {} }");
    await watcher.handleFileChange("/mod/page/page.js");
    expect(changes).to.deep.equal(["mod"]);
  });

  it("clears the module signature contribution of a removed directory", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const baseline = watcher.getModuleSignature("mod");

    await fs.writeFile("/mod/page/page.js", "class A {}");
    await watcher.handleFileChange("/mod/page");
    expect(watcher.getModuleSignature("mod")).to.not.equal(baseline);

    await fs.rm("/mod/page/page.js");
    await fs.rm("/mod/page");
    await watcher.handleFileChange("/mod/page");
    expect(watcher.getModuleSignature("mod")).to.equal(baseline);
  });

  it("ignores a new directory that has no owning module", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "x");

    const watcher = new FileWatcher(fs);
    await watcher.watchFile("/project/antelope.config.ts", () => {});

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.mkdir("/project/newdir", { recursive: true });
    await watcher.handleFileChange("/project/newdir");

    expect(changes).to.deep.equal([]);
  });

  it("ignores a node_modules directory created at runtime", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    await fs.writeFile("/mod/node_modules/dep/index.js", "x");
    await watcher.handleFileChange("/mod/node_modules");

    expect(changes).to.deep.equal([]);
  });

  it("does not notify module changes after stopWatching", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/a.txt", "a");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    watcher.stopWatching();

    await fs.writeFile("/mod/a.txt", "b");
    await watcher.handleFileChange("/mod/a.txt");

    expect(changes).to.deep.equal([]);
  });

  it("does not adopt or re-arm watchers for a new directory after stopWatching", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/index.js", "v1");

    const watcher = new FileWatcher(fs);
    await watcher.scanModule("mod", "/mod");
    watcher.startWatching();

    const changes: string[] = [];
    watcher.onModuleChanged((id) => changes.push(id));

    watcher.stopWatching();

    await fs.writeFile("/mod/page/page.js", "class Empty {}");
    await watcher.handleFileChange("/mod/page");
    watcher.startWatching();

    expect(changes).to.deep.equal([]);
    expect(
      (watcher as unknown as { watchers: Map<string, unknown> }).watchers.size,
    ).to.equal(0);
  });

  it("does not notify watched-file listeners after stopWatching", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/project/antelope.config.ts", "original");

    const watcher = new FileWatcher(fs);
    const changes: string[] = [];
    await watcher.watchFile("/project/antelope.config.ts", (p) =>
      changes.push(p),
    );

    watcher.stopWatching();

    await fs.writeFile("/project/antelope.config.ts", "modified");
    await watcher.handleFileChange("/project/antelope.config.ts");

    expect(changes).to.deep.equal([]);
  });

  it("skips excluded directories when scanning", async () => {
    const fs = new InMemoryFileSystem();
    await fs.writeFile("/mod/.git/ignored.txt", "x");
    await fs.writeFile("/mod/node_modules/ignored.txt", "y");
    await fs.writeFile("/mod/src/ok.txt", "z");

    const hasher = { hashFile: sinon.stub().resolves("hash") } as any;
    const watcher = new FileWatcher(fs, hasher);

    await watcher.scanModule("mod", "/mod");

    const hashedFiles = (hasher.hashFile as sinon.SinonStub)
      .getCalls()
      .map((call: sinon.SinonSpyCall) => call.args[0] as string);
    expect(hashedFiles).to.include("/mod/src/ok.txt");
    expect(hashedFiles).to.not.include("/mod/.git/ignored.txt");
    expect(hashedFiles).to.not.include("/mod/node_modules/ignored.txt");
  });
});
