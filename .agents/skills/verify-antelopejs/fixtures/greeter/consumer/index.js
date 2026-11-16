const http = require("node:http");
const { Greeter } = require("verify-greeter");

let server;

exports.construct = function construct() {};
exports.start = function start() {
  server = http.createServer(async (_request, response) => {
    const greeting = await Greeter.greet("verifier");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ module: "greeter-consumer", greeting }));
  });
  server.listen(Number(process.env.VERIFY_FIXTURE_PORT));
};
exports.stop = function stop() {
  server?.close();
};
exports.destroy = function destroy() {};
