const { ImplementInterface } = require("@antelopejs/interface-core");
const { Greeter } = require("verify-greeter");

exports.construct = function construct(config) {
  ImplementInterface(Greeter, { greet: (name) => `${config?.prefix ?? "Hello"}, ${name}` });
};
exports.start = function start() {};
exports.stop = function stop() {
  console.log("greeter-provider stopped");
};
exports.destroy = function destroy() {};
