import { readFileSync } from "node:fs";
import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const app = buildApp({ version, logger: { level: process.env["LOG_LEVEL"] ?? "info" } });
const { host, port } = readServerConfig(process.env);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close().then(() => process.exit(0));
  });
}

await app.listen({ host, port });
