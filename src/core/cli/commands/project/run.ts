import { createDevCommand } from "./dev";

export default function () {
  return createDevCommand({
    name: "run",
    summary: "Same as project dev",
    description:
      "Same as ajs project dev, which is the name to use: run the project in development mode.",
  });
}
