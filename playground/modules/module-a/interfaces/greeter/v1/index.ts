import { InterfaceFunction } from '@ajs/core/beta';

export const Greeter = {
  greet: InterfaceFunction<(name: string) => string>(),
};
