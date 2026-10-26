interface TestGlobals {
  [ROUTING_RESULTS_KEY]?: RoutingResults;
  [ROUTING_CLOSURES_KEY]?: RoutingClosures;
  [ROUTING_EMITTERS_KEY]?: RoutingEmits;
  [ROUTING_REGISTRATIONS_KEY]?: Record<string, Array<[string, string]>>;
  [ROUTING_EVENTS_KEY]?: Record<string, string[]>;
  [ROUTING_PROVIDER_CLASSES_KEY]?: object[];
  [CIRCULAR_RESULT_KEY]?: string;
  [TRANSITIVE_REGISTRATIONS_KEY]?: string[];
  [STARTED_CONSUMERS_KEY]?: string[];
}

export const testGlobals: typeof globalThis & TestGlobals = globalThis;

export const ROUTING_RESULTS_KEY = "__antelopeProviderRouting";

export const ROUTING_CLOSURES_KEY = "__antelopeProviderRoutingClosures";

export const ROUTING_REGISTRATIONS_KEY =
  "__antelopeProviderRoutingRegistrations";

export const ROUTING_EMITTERS_KEY = "__antelopeProviderRoutingEmitters";

export const ROUTING_EVENTS_KEY = "__antelopeProviderRoutingEvents";

export const ROUTING_PROVIDER_CLASSES_KEY = "__antelopeProviderRoutingClasses";

export const CIRCULAR_RESULT_KEY = "__antelopeCircularInterfaceResult";

export const TRANSITIVE_REGISTRATIONS_KEY = "__antelopeTransitiveRegistrations";

export const STARTED_CONSUMERS_KEY = "__antelopeStartedConsumers";

export const INTERFACE_NAME = "routing-interface";

export const CIRCULAR_INTERFACE_NAME = "circular-interface";

export const CORE_INTERFACE_NAME = "@antelopejs/interface-core";

export const COMPATIBLE_NESTED_CORE_VERSION = "0.0.11";

export const PROVIDER_CONSUMER_INTERFACE_NAME = "provider-consumer-interface";

export const DATABASE_INTERFACE_NAME = "database-interface";

export const DECORATORS_INTERFACE_NAME = "database-decorators";

export const AUTOMATION_INTERFACE_NAME = "automation-interface";

export const CIRCULAR_PROXY_WARNING =
  "Accessing non-existent property 'Symbol(@antelopejs/interface-core/proxy)'";

interface RoutingResult {
  module: string;
  value: string;
  environment: string;
  hasCanonicalClassIdentity: boolean;
  hasCanonicalDecoratorMetadata: boolean;
  isCanonicalProxy: boolean;
  providerMetadata: string;
  connections: Array<{
    id?: string;
    path: string;
    provider: string;
    selected: boolean;
  }>;
  selectedConnection?: {
    id?: string;
    path: string;
    provider: string;
    selected: boolean;
  };
}

export interface RoutingResults {
  [consumer: string]: RoutingResult;
}

export type RoutingClosure = () => Promise<RoutingResult>;

export interface RoutingClosures {
  [consumer: string]: RoutingClosure;
}

export interface RoutingEmits {
  [provider: string]: (value: string) => void;
}

export interface RoutingProject {
  folder: string;
  consumerAIndex: string;
}

export interface StandaloneCircularProject {
  folder: string;
  nestedInterfaceFolder: string;
}

export interface FixturePackageOptions {
  name: string;
  source: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  antelopeJs?: { standalone?: boolean; implements?: string[] };
  exports?: Record<string, string>;
}

export interface StartInterfaceFolders {
  decoratorsFolder: string;
  automationFolder: string;
}
