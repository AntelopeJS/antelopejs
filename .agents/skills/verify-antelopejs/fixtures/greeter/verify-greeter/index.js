const { InterfaceFunction } = require("@antelopejs/interface-core");

/** @type {typeof InterfaceFunction<(name: string) => string>} */
const greet = InterfaceFunction;

exports.Greeter = { greet: greet() };
