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
