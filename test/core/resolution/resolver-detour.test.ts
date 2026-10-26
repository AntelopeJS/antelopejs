import { nodeModule } from "../../helpers/node-module";
import { expect } from "chai";

import { Resolver } from "../../../src/core/resolution/resolver";
import { PathMapper } from "../../../src/core/resolution/path-mapper";
import { ResolverDetour } from "../../../src/core/resolution/resolver-detour";

type ModuleResolver = (request: string) => string;

function createResolver(resolvedPath?: string): Resolver {
  const resolver = new Resolver(new PathMapper(() => false));
  if (resolvedPath) {
    resolver.resolve = () => ({ resolvedPath });
  }
  return resolver;
}

function resolveRequest(): string {
  return nodeModule._resolveFilename(
    "request",
    { filename: "/module/index.js" },
    false,
    {},
  );
}

describe("ResolverDetour", () => {
  const processResolver = nodeModule._resolveFilename;
  let originalResolver: ModuleResolver;

  beforeEach(() => {
    originalResolver = (request) => request;
    nodeModule._resolveFilename = originalResolver;
  });

  afterEach(() => {
    nodeModule._resolveFilename = processResolver;
  });

  it("uses one process hook and preserves the newer lease", () => {
    const first = new ResolverDetour(createResolver("first"));
    const second = new ResolverDetour(createResolver("second"));

    first.attach();
    const processHook = nodeModule._resolveFilename;
    second.attach();

    expect(nodeModule._resolveFilename).to.equal(processHook);
    expect(resolveRequest()).to.equal("second");

    first.detach();
    expect(nodeModule._resolveFilename).to.equal(processHook);
    expect(resolveRequest()).to.equal("second");

    second.detach();
    expect(nodeModule._resolveFilename).to.equal(originalResolver);
  });

  it("restores the older lease when the newer lease detaches first", () => {
    const first = new ResolverDetour(createResolver("first"));
    const second = new ResolverDetour(createResolver("second"));

    first.attach();
    second.attach();
    second.detach();

    expect(resolveRequest()).to.equal("first");

    first.detach();
    expect(nodeModule._resolveFilename).to.equal(originalResolver);
  });

  it("uses the resolver that owns the requesting module", () => {
    const firstResolver = createResolver("first");
    const secondResolver = createResolver("second");
    firstResolver.ownsResolutionContext = (_request, parent) =>
      parent?.filename === "/first/index.js";
    secondResolver.ownsResolutionContext = (_request, parent) =>
      parent?.filename === "/second/index.js";
    const first = new ResolverDetour(firstResolver);
    const second = new ResolverDetour(secondResolver);

    first.attach();
    second.attach();

    expect(
      nodeModule._resolveFilename(
        "request",
        { filename: "/first/index.js" },
        false,
        {},
      ),
    ).to.equal("first");
    expect(
      nodeModule._resolveFilename(
        "request",
        { filename: "/second/index.js" },
        false,
        {},
      ),
    ).to.equal("second");

    second.detach();
    first.detach();
  });

  it("attaches and detaches each lease idempotently", () => {
    const detour = new ResolverDetour(createResolver());

    detour.attach();
    const processHook = nodeModule._resolveFilename;
    detour.attach();
    expect(nodeModule._resolveFilename).to.equal(processHook);

    detour.detach();
    detour.detach();
    expect(nodeModule._resolveFilename).to.equal(originalResolver);
  });

  it("detects an externally replaced process hook without overwriting it", () => {
    const detour = new ResolverDetour(createResolver());
    const externalResolver = (request: string) => `external:${request}`;

    detour.attach();
    nodeModule._resolveFilename = externalResolver;

    expect(() => detour.detach()).to.throw(
      "Node module resolver hook was replaced externally",
    );
    expect(nodeModule._resolveFilename).to.equal(externalResolver);
  });
});
