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
import type { ModuleManifest } from "../module-manifest";
import { isPathWithin, resolvePackage } from "./package-resolution";
import type { PathMapper } from "./path-mapper";

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
  interfaceName?: string;
  provider?: string;
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
        false,
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
        this.interfaceGraphFiles.get(parent?.filename ?? "") !==
          interfaceRequest.packageName,
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
    return result.bindExports ? this.bindInterfaceValue(value, context) : value;
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

  isInterfaceGraphFile(filePath: string): boolean {
    return this.interfaceGraphFiles.has(filePath);
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
      !this.interfaceGraphFiles.has(parent.filename),
      parent,
      parentModule,
    );
  }

  private bindResultProvider(
    result: ResolveResult,
    packageName: string,
    bindExports: boolean,
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
      bindExports,
      interfaceName: packageName,
      provider,
    };
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
      context,
      result.interfaceName,
    );
    return this.bindInterfaceValue(value, providerless);
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
            : this.bindInterfaceValue(member, context);
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
        const result = runWithCapturedModuleContext(context, () =>
          Reflect.apply(
            target,
            receiver,
            argumentsList.map((argument) =>
              this.bindInterfaceValue(argument, context),
            ),
          ),
        );
        return this.bindFunctionResult(result, context);
      },
      construct: (target, argumentsList, newTarget) =>
        runWithCapturedModuleContext(context, () =>
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
      return runWithCapturedModuleContext(context, () => event.register(bound));
    };
    const unregister = (handler: BindableFunction) =>
      runWithCapturedModuleContext(context, () =>
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
