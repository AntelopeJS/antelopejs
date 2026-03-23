import { InterfaceFunction } from "@antelopejs/interface-core";

export const Greeter = {
  greet: InterfaceFunction<(name: string) => string>(),
};
