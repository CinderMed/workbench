import { readFileSync } from "node:fs";
import { buildApp } from "./app.js";
import { readServerConfig } from "./config.js";
import { connect } from "./db/connect.js";
import { migrate } from "./db/migrate.js";

const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8"),
) as { version: string };

const config = readServerConfig(process.env);
const db =
  config.databaseUrl === undefined
    ? undefined
    : await connect({ connectionString: config.databaseUrl });
if (db !== undefined) await migrate(db);

const app = await buildApp({
  version,
  logger: { level: process.env["LOG_LEVEL"] ?? "info" },
  ...(db === undefined ? {} : { db }),
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app
      .close()
      .then(() => db?.destroy())
      .then(() => process.exit(0));
  });
}

await app.listen({ host: config.host, port: config.port });
