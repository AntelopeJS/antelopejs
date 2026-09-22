import { types as utilTypes } from "node:util";
import {
  AsyncProxy,
  EventProxy,
  GetInterfaceProxyIdentity,
  IsInterfaceProxy,
  RegisteringProxy,
} from "@antelopejs/interface-core";
import {
  captureModuleContext,
  getModuleContext,
  internal,
  runWithCapturedModuleContext,
} from "@antelopejs/interface-core/internal";

import type { PathMapper } from "./path-mapper";
import type { ModuleManifest } from "../module-manifest";
import { isPathWithin, resolvePackage } from "./package-resolution";

export interface ModuleRef {
  id: string;
  manifest: ModuleManifest;
}

interface ResolverParent {
  filename?: string;
}

export interface ResolveResult {
  resolvedPath: string;
  resolveFrom?: string;
  bindExports?: boolean;
  /**
   * The importer is itself a file of an interface package, so the bound
   * exports are kept by a file instance shared by every consumer that
   * outlives each of their generations. Such a facade owns no consumer
   * context: it adopts the caller's context at call time.
   */
  sharedExports?: boolean;
  interfaceName?: string;
  provider?: string;
}

interface ExportBinding {
  bindExports: boolean;
  sharedExports: boolean;
}

interface InterfacePackageRequest {
  packageName: string;
  result: ResolveResult;
}

interface ProxyReference {
  identity: string;
  proxy: object;
}

interface ProxyOwner {
  interfaceName: string;
  proxies: WeakSet<object>;
}

interface BoundMember {
  bound: unknown;
  source: unknown;
}

const CORE_PKG = "@antelopejs/interface-core";
const CORE_PACKAGE = resolvePackage(CORE_PKG, __dirname);
const CORE_RESOLVE_FROM = CORE_PACKAGE?.root ?? __dirname;
const CORE_ENTRY = CORE_PACKAGE?.entry ?? CORE_PKG;
const CLASS_PREFIX = "class ";
const PROXY_ATTACHMENT_METHODS = new Set<PropertyKey>([
  "detach",
  "onCall",
  "onHandlers",
  "onRegister",
  "onUnregister",
]);
let nextResolverIdentity = 1;

type CapturedModuleContext = NonNullable<
  ReturnType<typeof captureModuleContext>
>;
type BindableFunction = (...args: any[]) => unknown;
type InterfaceProxyKind = Parameters<typeof IsInterfaceProxy>[1];

function isRecognizedInterfaceProxy(
  value: unknown,
  kind?: InterfaceProxyKind,
): boolean {
  if (utilTypes.isProxy(value)) {
    return false;
  }
  if (
    value instanceof AsyncProxy ||
    value instanceof EventProxy ||
    value instanceof RegisteringProxy
  ) {
    return IsInterfaceProxy(value, kind);
  }
  try {
    return IsInterfaceProxy(value, kind);
  } catch {
    return false;
  }
}

function getProxyCandidate(candidate: object): unknown {
  if (typeof candidate === "function" && "proxy" in candidate) {
    return candidate.proxy;
  }
  return candidate;
}

function collectProxyReferences(value: unknown): ProxyReference[] {
  const references: ProxyReference[] = [];
  const visited = new WeakSet<object>();
  const visit = (candidate: unknown): void => {
    if (
      (typeof candidate !== "object" && typeof candidate !== "function") ||
      candidate === null
    ) {
      return;
    }
    if (utilTypes.isProxy(candidate)) {
      return;
    }
    const proxy = getProxyCandidate(candidate);
    if (isRecognizedInterfaceProxy(proxy)) {
      const identity = GetInterfaceProxyIdentity(proxy);
      if (identity) {
        references.push({ identity, proxy: proxy as object });
      }
      return;
    }
    if (visited.has(candidate)) {
      return;
    }
    visited.add(candidate);
    Object.values(candidate).forEach(visit);
  };
  visit(value);
  return references;
}

export class Resolver {
  public readonly moduleByFolder = new Map<string, ModuleRef>();
  public readonly modulesById = new Map<string, ModuleRef>();
  public readonly interfacePackages = new Map<string, string>();
  public readonly interfacePackageEntries = new Map<string, string>();
  public readonly interfacePackageResolveFrom = new Map<string, string>();
  public readonly lifecycleInterfacePackages = new Set<string>();
  public readonly stubbedInterfacePackages = new Set<string>();
  public stubModulePath?: string;
  private readonly resolverIdentity = nextResolverIdentity++;
  private readonly interfaceGraphFiles = new Map<string, string>();
  private readonly interfaceDependencies = new Map<string, Set<string>>();
  private readonly boundValues = new WeakMap<
    object,
    WeakMap<CapturedModuleContext, unknown>
  >();
  private readonly routedEvents = new Map<string, EventProxy>();
  private readonly proxyOwners = new Map<string, ProxyOwner>();
  private readonly providerlessContexts = new WeakMap<
    CapturedModuleContext,
    Map<string, CapturedModuleContext>
  >();
  private readonly sharedInterfaceContexts = new WeakMap<
    CapturedModuleContext,
    Map<string, CapturedModuleContext>
  >();
  /**
   * Shared facade contexts, mapped to the interface package whose exports they
   * were bound for. The interface name is what tells a facade which provider
   * its own proxies resolve to, whoever the caller is.
   */
  private readonly sharedContexts = new WeakMap<
    CapturedModuleContext,
    string
  >();
  private readonly sharedStubInterfaces = new WeakMap<
    CapturedModuleContext,
    string
  >();
  private readonly adoptedContexts = new WeakMap<
    CapturedModuleContext,
    WeakMap<CapturedModuleContext, CapturedModuleContext>
  >();
  private readonly stubbedContexts = new WeakSet<CapturedModuleContext>();

  constructor(private pathMapper: PathMapper) {}

  resolve(request: string, parent?: ResolverParent): ResolveResult | undefined {
    const parentModule = this.resolveLocalModule(parent?.filename);
    if (parentModule) {
      const mapped = this.pathMapper.resolve(request, parentModule.manifest);
      if (mapped) {
        return { resolvedPath: mapped };
      }
    }
    const coreResult = this.resolveInterfaceCore(request);
    if (coreResult) {
      return this.bindResultProvider(
        coreResult,
        CORE_PKG,
        { bindExports: false, sharedExports: false },
        parent,
        parentModule,
      );
    }
    const interfaceRequest = this.resolveInterfacePackage(request);
    if (interfaceRequest) {
      this.trackInterfaceDependency(
        parent?.filename,
        interfaceRequest.packageName,
      );
      return this.bindResultProvider(
        interfaceRequest.result,
        interfaceRequest.packageName,
        {
          bindExports:
            this.interfaceGraphFiles.get(parent?.filename ?? "") !==
            interfaceRequest.packageName,
          sharedExports: this.isInterfacePackageFile(parent?.filename),
        },
        parent,
        parentModule,
      );
    }
    return this.resolveRelativeInterface(request, parent, parentModule);
  }

  ownsResolutionContext(_request: string, parent?: ResolverParent): boolean {
    const contextModule = getModuleContext()?.module;
    if (contextModule && this.modulesById.has(contextModule)) {
      return true;
    }
    return Boolean(this.resolveLocalModule(parent?.filename));
  }

  requiresPreResolution(request: string, parent?: ResolverParent): boolean {
    return Boolean(this.findRequestedInterface(request, parent?.filename));
  }

  bindProviderRoutes(result: ResolveResult, value: unknown): unknown {
    const references = collectProxyReferences(value);
    if (result.interfaceName) {
      this.registerProxyOwners(result.interfaceName, references);
    }
    const context = captureModuleContext();
    if (!context?.providerRoutes) {
      return value;
    }
    this.replayKnownRoutes(context);
    if (!result.provider) {
      return this.bindStubbedInterfaceValue(result, value, context);
    }
    this.bindImportedRoutes(context, result, references);
    if (!result.bindExports) {
      return value;
    }
    return this.bindInterfaceValue(
      value,
      this.getBindingContext(result, context),
    );
  }

  /**
   * Runs the module body of an interface package file in the context its own
   * files are shared under.
   *
   * A self-hosted interface attaches its implementation at module scope, and
   * the runtime reads that attachment route from the ambient context. Loading
   * the file in the importing module's context would route the attachment to
   * whichever module imported the interface first, while every registration
   * later routes to the interface's declared provider.
   */
  runInInterfaceContext<T>(result: ResolveResult, load: () => T): T {
    const context = captureModuleContext();
    if (!context || !this.isSharedInterfaceLoad(result)) {
      return load();
    }
    return runWithCapturedModuleContext(
      this.getSharedInterfaceContext(result, context),
      load,
    );
  }

  private isSharedInterfaceLoad(result: ResolveResult): boolean {
    return Boolean(
      result.interfaceName &&
      result.interfaceName !== CORE_PKG &&
      result.provider &&
      !this.lifecycleInterfacePackages.has(result.interfaceName),
    );
  }

  trackInterfaceFile(result: ResolveResult, resolvedPath: string): void {
    if (result.interfaceName) {
      this.interfaceGraphFiles.set(resolvedPath, result.interfaceName);
    }
  }

  getInterfaceEntryToPrime(
    result: ResolveResult,
    resolvedPath: string,
  ): ResolveResult | undefined {
    const interfaceName = result.interfaceName;
    if (!interfaceName || this.lifecycleInterfacePackages.has(interfaceName)) {
      return undefined;
    }
    const entry = this.interfacePackageEntries.get(interfaceName);
    if (!entry || entry === resolvedPath || require.cache[entry]) {
      return undefined;
    }
    return {
      ...result,
      resolvedPath: entry,
      resolveFrom: undefined,
      bindExports: false,
    };
  }

  /**
   * Root directory of the interface package whose own import graph brought
   * `filePath` in, or undefined when the file is not part of one.
   *
   * Callers need the root, not just a yes/no: whether a cached file may
   * survive a module reload depends on where the interface package sits
   * relative to the module being reloaded.
   */
  getInterfaceGraphRoot(filePath: string): string | undefined {
    const packageName = this.interfaceGraphFiles.get(filePath);
    if (!packageName) {
      return undefined;
    }
    if (packageName === CORE_PKG) {
      return CORE_PACKAGE?.root;
    }
    return this.interfacePackages.get(packageName);
  }

  buildProviderRoutes(moduleId: string): Readonly<Record<string, string>> {
    const routes: Record<string, string> = {};
    this.bindKnownRoutes(moduleId, routes);
    return routes;
  }

  clearCache(): void {
    for (const event of this.routedEvents.values()) {
      internal.knownEvents.delete(event);
      const identity = GetInterfaceProxyIdentity(event);
      if (identity) {
        internal.proxyStates.delete(identity);
      }
    }
    this.routedEvents.clear();
    this.interfaceGraphFiles.clear();
    this.interfaceDependencies.clear();
    this.proxyOwners.clear();
  }

  private registerProxyOwners(
    interfaceName: string,
    references: ProxyReference[],
  ): void {
    for (const { identity, proxy } of references) {
      const owner = this.proxyOwners.get(identity);
      if (!owner) {
        this.proxyOwners.set(identity, {
          interfaceName,
          proxies: new WeakSet([proxy]),
        });
        continue;
      }
      if (owner.interfaceName !== interfaceName && !owner.proxies.has(proxy)) {
        throw new Error(
          `Interface packages '${owner.interfaceName}' and '${interfaceName}' declare distinct proxies with identity '${identity}'. Use unique interface proxy identities.`,
        );
      }
      owner.proxies.add(proxy);
    }
  }

  private bindImportedRoutes(
    context: CapturedModuleContext,
    result: ResolveResult,
    references: ProxyReference[],
  ): void {
    for (const { identity } of references) {
      const owner = this.proxyOwners.get(identity)?.interfaceName;
      if (result.interfaceName && owner !== result.interfaceName) {
        continue;
      }
      this.bindRoute(
        context.module,
        context.providerRoutes as Record<string, string>,
        identity,
        result.provider as string,
      );
    }
  }

  private replayKnownRoutes(context: CapturedModuleContext): void {
    this.bindKnownRoutes(
      context.module,
      context.providerRoutes as Record<string, string>,
    );
  }

  private bindKnownRoutes(
    moduleId: string,
    routes: Record<string, string>,
  ): void {
    const module = this.modulesById.get(moduleId);
    if (!module) {
      return;
    }
    for (const [identity, { interfaceName }] of this.proxyOwners) {
      for (const provider of this.resolveProviders(module, interfaceName)) {
        this.bindRoute(moduleId, routes, identity, provider);
      }
    }
  }

  private bindRoute(
    moduleId: string,
    routes: Record<string, string>,
    identity: string,
    provider: string,
  ): void {
    const current = routes[identity];
    if (current && current !== provider) {
      throw new Error(
        `Module '${moduleId}' resolves proxy '${identity}' to both '${current}' and '${provider}'. Use unique interface proxy identities.`,
      );
    }
    routes[identity] = provider;
  }

  private resolveInterfaceCore(request: string): ResolveResult | undefined {
    if (request === CORE_PKG) {
      return { resolvedPath: CORE_ENTRY };
    }
    if (request.startsWith(`${CORE_PKG}/`)) {
      return { resolvedPath: request, resolveFrom: CORE_RESOLVE_FROM };
    }
    return undefined;
  }

  private resolveInterfacePackage(
    request: string,
  ): InterfacePackageRequest | undefined {
    for (const [packageName, rootDir] of this.interfacePackages) {
      if (request === packageName) {
        return {
          packageName,
          result: {
            resolvedPath:
              this.interfacePackageEntries.get(packageName) ?? rootDir,
          },
        };
      }
      if (request.startsWith(`${packageName}/`)) {
        return {
          packageName,
          result: {
            resolvedPath: request,
            resolveFrom:
              this.interfacePackageResolveFrom.get(packageName) ?? rootDir,
          },
        };
      }
    }
    return undefined;
  }

  private resolveRelativeInterface(
    request: string,
    parent: ResolverParent | undefined,
    parentModule: ModuleRef | undefined,
  ): ResolveResult | undefined {
    if (!request.startsWith(".") || !parent?.filename) {
      return undefined;
    }
    const packageName = this.findInterfacePackageByPath(parent.filename);
    if (!packageName) {
      return undefined;
    }
    return this.bindResultProvider(
      { resolvedPath: request },
      packageName,
      {
        bindExports: !this.interfaceGraphFiles.has(parent.filename),
        sharedExports: true,
      },
      parent,
      parentModule,
    );
  }

  private bindResultProvider(
    result: ResolveResult,
    packageName: string,
    binding: ExportBinding,
    parent: ResolverParent | undefined,
    parentModule: ModuleRef | undefined,
  ): ResolveResult {
    const provider = this.resolveRequestProvider(
      packageName,
      parent?.filename,
      parentModule,
    );
    return {
      ...result,
      bindExports: binding.bindExports,
      sharedExports: binding.sharedExports,
      interfaceName: packageName,
      provider,
    };
  }

  /**
   * Whether `filename` belongs to an interface package, either because the
   * resolver brought it in through an interface import graph or because it
   * sits inside an interface package root.
   */
  private isInterfacePackageFile(filename: string | undefined): boolean {
    if (!filename) {
      return false;
    }
    return (
      this.interfaceGraphFiles.has(filename) ||
      this.findInterfacePackageByPath(filename) !== undefined
    );
  }

  private resolveProvider(
    module: ModuleRef,
    packageName: string,
  ): string | undefined {
    if (module.manifest.implements?.includes(packageName)) {
      return module.id;
    }
    return internal.interfaceConnections[module.id]?.[packageName]?.find(
      ({ selected }) => selected,
    )?.provider;
  }

  private resolveRequestProvider(
    packageName: string,
    parentFilename: string | undefined,
    parentModule: ModuleRef | undefined,
  ): string | undefined {
    const contextModule = getModuleContext()?.module;
    const consumer = contextModule
      ? this.modulesById.get(contextModule)
      : undefined;
    const direct = consumer
      ? this.resolveProvider(consumer, packageName)
      : undefined;
    if (direct) {
      return direct;
    }
    const parentInterface = parentFilename
      ? this.interfaceGraphFiles.get(parentFilename)
      : undefined;
    const inherited =
      consumer && parentInterface
        ? this.resolveChildProvider(consumer, parentInterface, packageName)
        : undefined;
    return (
      inherited ??
      (parentModule
        ? this.resolveProvider(parentModule, packageName)
        : undefined)
    );
  }

  private resolveChildProvider(
    consumer: ModuleRef,
    parentInterface: string,
    childInterface: string,
  ): string | undefined {
    for (const provider of this.resolveProviders(consumer, parentInterface)) {
      const providerModule = this.modulesById.get(provider);
      const childProvider = providerModule
        ? this.resolveProvider(providerModule, childInterface)
        : undefined;
      if (childProvider) {
        return childProvider;
      }
    }
    return undefined;
  }

  private resolveProviders(
    module: ModuleRef,
    interfaceName: string,
    visited = new Set<string>(),
  ): Set<string> {
    const direct = this.resolveProvider(module, interfaceName);
    if (direct) {
      return new Set([direct]);
    }
    if (visited.has(interfaceName)) {
      return new Set();
    }
    visited.add(interfaceName);
    const providers = new Set<string>();
    for (const [parent, children] of this.interfaceDependencies) {
      if (!children.has(interfaceName)) {
        continue;
      }
      this.collectChildProviders(
        module,
        parent,
        interfaceName,
        visited,
        providers,
      );
    }
    return providers;
  }

  private collectChildProviders(
    module: ModuleRef,
    parentInterface: string,
    childInterface: string,
    visited: Set<string>,
    providers: Set<string>,
  ): void {
    for (const parentProvider of this.resolveProviders(
      module,
      parentInterface,
      new Set(visited),
    )) {
      const providerModule = this.modulesById.get(parentProvider);
      const childProvider = providerModule
        ? this.resolveProvider(providerModule, childInterface)
        : undefined;
      if (childProvider) {
        providers.add(childProvider);
      }
    }
  }

  private trackInterfaceDependency(
    parentFilename: string | undefined,
    childInterface: string,
  ): void {
    const parentInterface = parentFilename
      ? this.interfaceGraphFiles.get(parentFilename)
      : undefined;
    if (!parentInterface || parentInterface === childInterface) {
      return;
    }
    const dependencies =
      this.interfaceDependencies.get(parentInterface) ?? new Set<string>();
    dependencies.add(childInterface);
    this.interfaceDependencies.set(parentInterface, dependencies);
  }

  private findRequestedInterface(
    request: string,
    parentFilename?: string,
  ): string | undefined {
    if (request === CORE_PKG || request.startsWith(`${CORE_PKG}/`)) {
      return CORE_PKG;
    }
    const direct = this.findInterfacePackageRequest(request);
    if (direct) {
      return direct;
    }
    return request.startsWith(".") && parentFilename
      ? this.findInterfacePackageByPath(parentFilename)
      : undefined;
  }

  private findInterfacePackageRequest(request: string): string | undefined {
    return [...this.interfacePackages.keys()].find(
      (packageName) =>
        request === packageName || request.startsWith(`${packageName}/`),
    );
  }

  private findInterfacePackageByPath(fileName: string): string | undefined {
    const coreRoot = CORE_PACKAGE?.root ?? "";
    let matchingRoot =
      coreRoot && isPathWithin(fileName, coreRoot) ? coreRoot : "";
    let matchingPackage = matchingRoot ? CORE_PKG : undefined;
    for (const [packageName, root] of this.interfacePackages) {
      if (isPathWithin(fileName, root) && root.length > matchingRoot.length) {
        matchingRoot = root;
        matchingPackage = packageName;
      }
    }
    return matchingPackage;
  }

  private bindInterfaceValue(
    value: unknown,
    context: CapturedModuleContext,
  ): unknown {
    if (isRecognizedInterfaceProxy(value, "event")) {
      return this.getRoutedEvent(value, context);
    }
    if (
      typeof value === "function" &&
      this.isClass(value as BindableFunction)
    ) {
      return value;
    }
    if (!this.isBindableValue(value)) {
      return value;
    }
    const cached = this.boundValues.get(value)?.get(context);
    if (cached) {
      return cached;
    }
    const bound =
      typeof value === "function"
        ? this.createFunctionFacade(value as BindableFunction, context)
        : this.createObjectFacade(value, context);
    const contexts =
      this.boundValues.get(value) ??
      new WeakMap<CapturedModuleContext, unknown>();
    contexts.set(context, bound);
    this.boundValues.set(value, contexts);
    return bound;
  }

  /**
   * Binds a value that merely travels through a facade: an argument of a
   * facade call, or a member read off a facaded object.
   *
   * Only values that need the facade machinery get one: functions, whose body
   * must run in the right module context, interface proxies, which must be
   * routed, and containers of those. Plain data crosses untouched, so `===`,
   * `Map`/`Set` keys and caller-visible mutation keep working across a module
   * boundary the way they do inside one.
   */
  private bindPassedValue(
    value: unknown,
    context: CapturedModuleContext,
  ): unknown {
    return this.needsFacade(value)
      ? this.bindInterfaceValue(value, context)
      : value;
  }

  /**
   * Whether `value` is, or transitively holds, something a facade has to wrap:
   * a function or an interface proxy. The walk only descends into plain
   * objects and arrays, the same shapes `isBindableValue` accepts, so it stops
   * at every class instance.
   */
  private needsFacade(value: unknown, visited?: WeakSet<object>): boolean {
    if (typeof value === "function") {
      return true;
    }
    if (!this.isBindableValue(value)) {
      return false;
    }
    if (isRecognizedInterfaceProxy(value)) {
      return true;
    }
    const seen = visited ?? new WeakSet<object>();
    if (seen.has(value)) {
      return false;
    }
    seen.add(value);
    return Object.values(value).some((member) =>
      this.needsFacade(member, seen),
    );
  }

  private bindStubbedInterfaceValue(
    result: ResolveResult,
    value: unknown,
    context: CapturedModuleContext,
  ): unknown {
    if (
      !result.interfaceName ||
      !this.stubbedInterfacePackages.has(result.interfaceName)
    ) {
      return value;
    }
    const providerless = this.getProviderlessContext(
      this.getBindingContext(result, context),
      result.interfaceName,
    );
    return this.bindInterfaceValue(value, providerless);
  }

  /**
   * Context a set of interface exports is bound to.
   *
   * Exports imported by a module are owned by that module: its context is the
   * right one, and dies with it. Exports imported by an interface package
   * file are kept by a single shared instance that every consumer reaches and
   * that survives their reloads, so no consumer may own them: they get a
   * detached copy of the importing context, used only as a fallback for work
   * that runs without any ambient context.
   */
  private getBindingContext(
    result: ResolveResult,
    context: CapturedModuleContext,
  ): CapturedModuleContext {
    if (!result.sharedExports) {
      return context;
    }
    return this.getSharedInterfaceContext(result, context);
  }

  /**
   * Single context an interface package's own files are shared under.
   *
   * Its `provider` is the one the interface resolves to, never the one the
   * importing module happens to run for: the shared instance answers every
   * consumer, so the importer's own provider would leak into work the
   * interface performs for all of them, and an attachment the interface makes
   * for itself would land on a route no consumer ever requests.
   */
  private getSharedInterfaceContext(
    result: ResolveResult,
    context: CapturedModuleContext,
  ): CapturedModuleContext {
    const interfaceName = result.interfaceName ?? "";
    const contexts = this.sharedInterfaceContexts.get(context) ?? new Map();
    const existing = contexts.get(interfaceName);
    if (existing) {
      return existing;
    }
    const shared = { ...context, provider: result.provider };
    contexts.set(interfaceName, shared);
    this.sharedInterfaceContexts.set(context, contexts);
    this.sharedContexts.set(shared, interfaceName);
    return shared;
  }

  /**
   * Context a facade call actually runs in: the owning context for a facade a
   * module owns, the live caller context for a shared interface facade, which
   * belongs to no module. Falling back to the load-time context keeps the
   * hard failure for orphaned asynchronous work, which has no ambient context
   * to adopt.
   */
  private effectiveContext(
    context: CapturedModuleContext,
  ): CapturedModuleContext {
    const sharedInterface = this.sharedContexts.get(context);
    if (sharedInterface === undefined) {
      return context;
    }
    const ambient = captureModuleContext();
    if (!ambient) {
      return context;
    }
    const adopted = this.getAdoptedContext(context, ambient, sharedInterface);
    const stubbed = this.sharedStubInterfaces.get(context);
    return stubbed ? this.getProviderlessContext(adopted, stubbed) : adopted;
  }

  /**
   * Caller context a shared interface facade runs in. The caller owns the
   * execution, so its module, owner and routes win; the routes the interface
   * package was loaded with fill in the proxies the caller never resolved
   * itself, which are the ones only reachable through this package.
   *
   * The `provider` field is NOT a route: it is the fallback a proxy without a
   * route resolves to, and it only ever means "the provider of the interface
   * these exports belong to". Adopting the caller's own `provider` would make
   * every unrouted proxy reached through this facade resolve to the provider
   * of whatever interface the caller happened to be running for, so it is
   * recomputed for the facade's own interface instead.
   */
  private getAdoptedContext(
    shared: CapturedModuleContext,
    ambient: CapturedModuleContext,
    interfaceName: string,
  ): CapturedModuleContext {
    const cached = this.adoptedContexts.get(shared)?.get(ambient);
    if (cached) {
      return cached;
    }
    const adopted = {
      ...ambient,
      provider: this.adoptedProvider(interfaceName, ambient, shared),
      providerRoutes: this.chainProviderRoutes(
        ambient.providerRoutes,
        shared.providerRoutes,
      ),
    };
    const contexts =
      this.adoptedContexts.get(shared) ??
      new WeakMap<CapturedModuleContext, CapturedModuleContext>();
    contexts.set(ambient, adopted);
    this.adoptedContexts.set(shared, contexts);
    return adopted;
  }

  /**
   * Provider the facade's own interface resolves to for the calling module,
   * falling back to the provider the interface package was loaded with when
   * the caller declares no connection of its own.
   */
  private adoptedProvider(
    interfaceName: string,
    ambient: CapturedModuleContext,
    shared: CapturedModuleContext,
  ): string | undefined {
    const consumer = this.modulesById.get(ambient.module);
    const direct = consumer
      ? this.resolveProvider(consumer, interfaceName)
      : undefined;
    return direct ?? shared.provider;
  }

  private chainProviderRoutes(
    routes: Readonly<Record<string, string>> | undefined,
    fallback: Readonly<Record<string, string>> | undefined,
  ): Readonly<Record<string, string>> | undefined {
    if (!routes || !fallback) {
      return routes ?? fallback;
    }
    return new Proxy(routes, {
      get: (target, identity) =>
        Reflect.get(target, identity) ?? Reflect.get(fallback, identity),
    });
  }

  private getProviderlessContext(
    context: CapturedModuleContext,
    interfaceName: string,
  ): CapturedModuleContext {
    const contexts = this.providerlessContexts.get(context) ?? new Map();
    const existing = contexts.get(interfaceName);
    if (existing) {
      return existing;
    }
    const providerless = {
      ...context,
      provider: undefined,
      providerRoutes: this.filterStubbedProviderRoutes(context, interfaceName),
    };
    contexts.set(interfaceName, providerless);
    this.providerlessContexts.set(context, contexts);
    this.stubbedContexts.add(providerless);
    const sharedInterface = this.sharedContexts.get(context);
    if (sharedInterface !== undefined) {
      this.sharedContexts.set(providerless, sharedInterface);
      this.sharedStubInterfaces.set(providerless, interfaceName);
    }
    return providerless;
  }

  private filterStubbedProviderRoutes(
    context: CapturedModuleContext,
    interfaceName: string,
  ): Readonly<Record<string, string>> {
    const routes = context.providerRoutes ?? {};
    return new Proxy(routes, {
      get: (target, identity) => {
        const owner =
          typeof identity === "string"
            ? this.proxyOwners.get(identity)?.interfaceName
            : undefined;
        if (
          owner === interfaceName &&
          this.stubbedInterfacePackages.has(interfaceName)
        ) {
          return undefined;
        }
        return Reflect.get(target, identity);
      },
    });
  }

  private isBindableValue(value: unknown): value is object {
    if (
      (typeof value !== "object" && typeof value !== "function") ||
      value === null
    ) {
      return false;
    }
    if (utilTypes.isProxy(value)) {
      return false;
    }
    if (typeof value === "function" || isRecognizedInterfaceProxy(value)) {
      return true;
    }
    const prototype = Object.getPrototypeOf(value);
    return (
      Array.isArray(value) ||
      prototype === Object.prototype ||
      prototype === null
    );
  }

  private isClass(value: BindableFunction): boolean {
    return Function.prototype.toString.call(value).startsWith(CLASS_PREFIX);
  }

  private createObjectFacade(
    value: object,
    context: CapturedModuleContext,
  ): object {
    const members = new Map<PropertyKey, BoundMember>();
    const facade = new Proxy(value, {
      get: (target, property) => {
        const descriptor = Reflect.getOwnPropertyDescriptor(target, property);
        if (
          descriptor &&
          !descriptor.configurable &&
          "value" in descriptor &&
          !descriptor.writable
        ) {
          return descriptor.value;
        }
        const member = Reflect.get(target, property, target);
        const cached = members.get(property);
        if (cached && Object.is(cached.source, member)) {
          return cached.bound;
        }
        const bound =
          typeof member === "function" && !this.isClass(member)
            ? this.bindObjectFunction(member, target, facade, property, context)
            : this.bindPassedValue(member, context);
        members.set(property, { bound, source: member });
        return bound;
      },
    });
    return facade;
  }

  private bindObjectFunction(
    member: BindableFunction,
    target: object,
    facade: object,
    property: PropertyKey,
    context: CapturedModuleContext,
  ): BindableFunction {
    const isStubAttachment =
      this.stubbedContexts.has(context) &&
      isRecognizedInterfaceProxy(target) &&
      PROXY_ATTACHMENT_METHODS.has(property);
    return isStubAttachment
      ? member.bind(target)
      : this.createFunctionFacade(member, context, target, facade);
  }

  private createFunctionFacade(
    value: BindableFunction,
    context: CapturedModuleContext,
    boundThis?: object,
    facadeThis?: object,
  ): BindableFunction {
    return new Proxy(value, {
      apply: (target, thisArg, argumentsList) => {
        const receiver =
          boundThis &&
          (!facadeThis || thisArg === facadeThis || thisArg === undefined)
            ? boundThis
            : thisArg;
        // The call runs in the caller's context, but the values crossing the
        // facade stay bound to the facade's own context: binding them to the
        // live caller context would hand out a different facade for the same
        // value on every call, and callers that pair a value with itself
        // across calls -- `unregister(handler)` then `register(handler)` --
        // would no longer match.
        const result = runWithCapturedModuleContext(
          this.effectiveContext(context),
          () =>
            Reflect.apply(
              target,
              receiver,
              argumentsList.map((argument) =>
                this.bindPassedValue(argument, context),
              ),
            ),
        );
        return this.bindFunctionResult(result, context);
      },
      construct: (target, argumentsList, newTarget) =>
        runWithCapturedModuleContext(this.effectiveContext(context), () =>
          Reflect.construct(target, argumentsList, newTarget),
        ),
      get: (target, property) => {
        if (property === "prototype") {
          return target.prototype;
        }
        return this.bindInterfaceValue(
          Reflect.get(target, property, target),
          context,
        );
      },
    });
  }

  private bindFunctionResult(
    value: unknown,
    context: CapturedModuleContext,
  ): unknown {
    if (value instanceof Promise) {
      return value.then((result) =>
        typeof result === "function"
          ? this.bindInterfaceValue(result, context)
          : result,
      );
    }
    return typeof value === "function"
      ? this.bindInterfaceValue(value, context)
      : value;
  }

  private getRoutedEvent(
    value: unknown,
    context: CapturedModuleContext,
  ): unknown {
    const identity = GetInterfaceProxyIdentity(value);
    const provider = identity
      ? (context.providerRoutes?.[identity] ?? context.provider)
      : undefined;
    if (!identity || !provider) {
      return value;
    }
    const key = `${identity}\0${provider}`;
    const routed = this.routedEvents.get(key);
    if (routed) {
      return this.bindRoutedEvent(routed, context);
    }
    const created = new EventProxy(
      `${this.resolverIdentity}:${provider}:${identity}`,
    );
    this.routedEvents.set(key, created);
    return this.bindRoutedEvent(created, context);
  }

  private bindRoutedEvent(
    event: EventProxy,
    context: CapturedModuleContext,
  ): EventProxy {
    const cached = this.boundValues.get(event)?.get(context);
    if (cached) {
      return cached as EventProxy;
    }
    const bound = this.createEventFacade(event, context);
    const contexts =
      this.boundValues.get(event) ??
      new WeakMap<CapturedModuleContext, unknown>();
    contexts.set(context, bound);
    this.boundValues.set(event, contexts);
    return bound;
  }

  private createEventFacade(
    event: EventProxy,
    context: CapturedModuleContext,
  ): EventProxy {
    const handlers = new WeakMap<BindableFunction, BindableFunction>();
    const register = (handler: BindableFunction) => {
      const bound =
        handlers.get(handler) ?? this.createFunctionFacade(handler, context);
      handlers.set(handler, bound);
      return runWithCapturedModuleContext(this.effectiveContext(context), () =>
        event.register(bound),
      );
    };
    const unregister = (handler: BindableFunction) =>
      runWithCapturedModuleContext(this.effectiveContext(context), () =>
        event.unregister(handlers.get(handler) ?? handler),
      );
    const emit = this.createFunctionFacade(event.emit, context, event);
    return new Proxy(event, {
      get: (target, property) => {
        if (property === "register") {
          return register;
        }
        if (property === "unregister") {
          return unregister;
        }
        if (property === "emit") {
          return emit;
        }
        return Reflect.get(target, property, target);
      },
    });
  }

  private resolveLocalModule(fileName?: string): ModuleRef | undefined {
    if (!fileName) {
      return undefined;
    }
    let matchingFolder = "";
    let matchingModule: ModuleRef | undefined;
    for (const [folder, module] of this.moduleByFolder) {
      if (
        isPathWithin(fileName, folder) &&
        folder.length > matchingFolder.length
      ) {
        matchingFolder = folder;
        matchingModule = module;
      }
    }
    return matchingModule;
  }
}
