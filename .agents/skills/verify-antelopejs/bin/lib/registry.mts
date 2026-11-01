import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import path from "node:path";

/** A package a {@link LocalRegistry} publishes: its package.json and its files. */
export interface PublishedPackage {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  packageManager?: string;
  files?: Record<string, string>;
}

interface PublishedManifest {
  name: string;
  version: string;
  main: string;
  dependencies: Record<string, string>;
  packageManager?: string;
}

interface StoredVersion {
  manifest: PublishedManifest;
  tarball: Buffer;
}

const TARBALL_SEGMENT = "/-/";

/**
 * An npm registry served from the harness process on 127.0.0.1, so journeys
 * can publish a new version of a dependency between two commands without the
 * network. npm and pnpm reach it through `npm_config_registry`; every request
 * is kept in `requests` for the evidence.
 */
export class LocalRegistry {
  readonly requests: string[] = [];
  private readonly packages = new Map<string, Map<string, StoredVersion>>();
  private server: Server | undefined;
  private readonly folder: string;
  url = "";

  constructor(folder: string) {
    this.folder = folder;
    mkdirSync(folder, { recursive: true });
  }

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      const route = decodeURIComponent((request.url ?? "/").split("?")[0]);
      this.requests.push(`${request.method} ${route}`);
      const body = this.answer(route);
      response.writeHead(body ? 200 : 404, { "content-type": route.includes(TARBALL_SEGMENT) ? "application/octet-stream" : "application/json" });
      response.end(body ?? JSON.stringify({ error: "not found" }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    this.server = server;
    const address = server.address();
    this.url = `http://127.0.0.1:${address instanceof Object ? address.port : 0}`;
  }

  stop(): Promise<void> {
    return new Promise((resolve) => (this.server ? this.server.close(() => resolve()) : resolve()));
  }

  /** The environment that points npm and pnpm at this registry and keeps their caches in `cacheRoot`. */
  env(cacheRoot: string) {
    return {
      npm_config_registry: `${this.url}/`,
      npm_config_offline: "false",
      npm_config_cache: path.join(cacheRoot, "npm"),
      npm_config_store_dir: path.join(cacheRoot, "pnpm-store"),
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_update_notifier: "false",
    };
  }

  /** Packs `pkg` with `npm pack` and serves it from now on. */
  publish(pkg: PublishedPackage): void {
    const source = path.join(this.folder, "sources", `${pkg.name}@${pkg.version}`);
    mkdirSync(source, { recursive: true });
    const manifest: PublishedManifest = { name: pkg.name, version: pkg.version, main: "index.js", dependencies: pkg.dependencies ?? {} };
    if (pkg.packageManager) {
      manifest.packageManager = pkg.packageManager;
    }
    writeFileSync(path.join(source, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    for (const [file, content] of Object.entries({ "index.js": "module.exports = {};\n", ...pkg.files })) {
      writeFileSync(path.join(source, file), content);
    }
    const output = path.join(this.folder, "tarballs");
    mkdirSync(output, { recursive: true });
    const packed = JSON.parse(execFileSync("npm", ["pack", source, "--pack-destination", output, "--json"], { encoding: "utf8", env: { ...process.env, npm_config_offline: "true" } }));
    const tarball = readFileSync(path.join(output, packed[0].filename));
    const versions = this.packages.get(pkg.name) ?? new Map<string, StoredVersion>();
    versions.set(pkg.version, { manifest, tarball });
    this.packages.set(pkg.name, versions);
  }

  private tarballUrl(name: string, version: string): string {
    return `${this.url}/${name}${TARBALL_SEGMENT}${name}-${version}.tgz`;
  }

  private packument(name: string): string | undefined {
    const versions = this.packages.get(name);
    if (!versions) {
      return undefined;
    }
    const entries = [...versions.entries()].map(([version, stored]) => [
      version,
      {
        ...stored.manifest,
        dist: {
          tarball: this.tarballUrl(name, version),
          shasum: createHash("sha1").update(stored.tarball).digest("hex"),
          integrity: `sha512-${createHash("sha512").update(stored.tarball).digest("base64")}`,
        },
      },
    ]);
    const latest = entries[entries.length - 1][0];
    return JSON.stringify({ name, "dist-tags": { latest }, versions: Object.fromEntries(entries) });
  }

  private answer(route: string): string | Buffer | undefined {
    const tarballAt = route.indexOf(TARBALL_SEGMENT);
    if (tarballAt === -1) {
      return this.packument(route.slice(1));
    }
    const name = route.slice(1, tarballAt);
    const file = route.slice(tarballAt + TARBALL_SEGMENT.length);
    const version = file.slice(name.length + 1, -".tgz".length);
    return this.packages.get(name)?.get(version)?.tarball;
  }
}
