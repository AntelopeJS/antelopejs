import { Greeter } from "interface-greeter";

let config: { target: string };

export async function construct(moduleConfig: { target: string }) {
  config = moduleConfig;
  console.log("[module-b] Constructed with config:", config);
}

export function start() {
  console.log("[module-b] Started");
  void Greeter.greet(config.target).then((result) => {
    console.log("[module-b] Greeter result:", result);
  });
}

export function stop() {
  console.log("[module-b] Stopped");
}

export async function destroy() {
  console.log("[module-b] Destroyed");
  config = undefined!;
}
