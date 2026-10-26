import {
  INTERFACE_NAME,
  ROUTING_CLOSURES_KEY,
  ROUTING_EMITTERS_KEY,
  ROUTING_EVENTS_KEY,
  ROUTING_PROVIDER_CLASSES_KEY,
  ROUTING_REGISTRATIONS_KEY,
  ROUTING_RESULTS_KEY,
} from "./provider-routing.fixture-types";

export function providerSource(
  value: string,
  delayMs = 0,
  declarationRequest = `${INTERFACE_NAME}/declaration`,
  providerKey = value,
): string {
  return `
const { AsyncProxy, ImplementInterface } = require("@antelopejs/interface-core");
const { GetModuleContext } = require("@antelopejs/interface-core/modules");
const { GetRuntimeInfo } = require("@antelopejs/interface-core/runtime");
if (GetModuleContext()?.module !== ${JSON.stringify(`provider-${providerKey}`)}) throw new Error("Lifecycle root evaluated outside its provider construction");
const declaration = require(${JSON.stringify(declarationRequest)});
const lazyDeclaration = require(${JSON.stringify(declarationRequest.replace("declaration", "lazy"))});
exports.construct = async () => {
  await new Promise((resolve) => setTimeout(resolve, ${delayMs}));
  const runtimeInfo = await GetRuntimeInfo();
  Reflect.defineMetadata("routing:provider", "canonical", declaration.RoutingValue);
  global[${JSON.stringify(ROUTING_PROVIDER_CLASSES_KEY)}].push(declaration.RoutingValue);
  ImplementInterface(declaration, {
    GetValue: () => ({ value: ${JSON.stringify(value)}, module: GetModuleContext().module, environment: runtimeInfo.env, instance: new declaration.RoutingValue(), isCanonicalProxy: declaration.GetValue.proxy instanceof AsyncProxy }),
    RegisterValue: {
      register: (id, registeredValue) => global[${JSON.stringify(ROUTING_REGISTRATIONS_KEY)}][${JSON.stringify(providerKey)}].push([id, registeredValue]),
      unregister: (id) => global[${JSON.stringify(ROUTING_REGISTRATIONS_KEY)}][${JSON.stringify(providerKey)}].push([id, "unregistered"]),
    },
  });
  ImplementInterface(lazyDeclaration, { GetLazyValue: () => ({ value: ${JSON.stringify(value)}, module: GetModuleContext().module }) });
  global[${JSON.stringify(ROUTING_EMITTERS_KEY)}][${JSON.stringify(providerKey)}] = (eventValue) => declaration.ValueEvent.emit(eventValue);
};
exports.destroy = () => {};
`;
}

export function consumerSource(consumer: string): string {
  return `
const { GetInterfaceInstance, GetInterfaceInstances } = require("@antelopejs/interface-core");
const declaration = require(${JSON.stringify(`${INTERFACE_NAME}/declaration`)});
exports.construct = async () => {
  const result = await declaration.GetValue();
  class DecoratedValue {}
  declaration.MarkRoutingValue()(DecoratedValue);
  declaration.RegisterValue.register("shared", ${JSON.stringify(consumer)});
  const eventHandler = async (value) => {
    const routed = await declaration.GetValue();
    global[${JSON.stringify(ROUTING_EVENTS_KEY)}][${JSON.stringify(consumer)}].push(value + ":" + routed.value);
  };
  declaration.ValueEvent.register(eventHandler);
  declaration.ValueEvent.register(eventHandler);
  global[${JSON.stringify(ROUTING_CLOSURES_KEY)}][${JSON.stringify(consumer)}] = declaration.CreateDeferred();
  global[${JSON.stringify(ROUTING_RESULTS_KEY)}][${JSON.stringify(consumer)}] = {
    ...result,
    hasCanonicalClassIdentity: Object.getPrototypeOf(result.instance) === declaration.RoutingValue.prototype,
    hasCanonicalDecoratorMetadata: Reflect.getMetadata("routing:value", DecoratedValue) === declaration.RoutingValue,
    providerMetadata: Reflect.getMetadata("routing:provider", declaration.RoutingValue),
    connections: GetInterfaceInstances(${JSON.stringify(INTERFACE_NAME)}),
    selectedConnection: GetInterfaceInstance(${JSON.stringify(INTERFACE_NAME)}, "primary"),
  };
};
exports.destroy = () => {};
`;
}
