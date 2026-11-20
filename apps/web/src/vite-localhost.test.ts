// @vitest-environment node
import { fileURLToPath } from "node:url";
import { resolveConfig } from "vite";
import { describe, expect, it } from "vitest";

const configFile = fileURLToPath(new URL("../vite.config.ts", import.meta.url));

describe("the dev server (local mode, ADR-0021)", () => {
  it("listens on 127.0.0.1 only, with a strict port and Vite's host check on", async () => {
    const config = await resolveConfig({ configFile }, "serve");
    expect(config.server.host).toBe("127.0.0.1");
    expect(config.server.strictPort).toBe(true);
    expect(config.server.allowedHosts).not.toBe(true);
    expect(config.preview.host).toBe("127.0.0.1");
  });

  it.each([
    [{ server: { host: "0.0.0.0" } }, "server.host must be 127.0.0.1"],
    [{ server: { host: true } }, "server.host must be 127.0.0.1"],
    [{ server: { allowedHosts: true as const } }, "server.allowedHosts must not be true"],
    [{ preview: { host: "0.0.0.0" } }, "preview.host must be 127.0.0.1"],
  ])("refuses to start with %j", async (override, message) => {
    await expect(resolveConfig({ configFile, ...override }, "serve")).rejects.toThrow(message);
  });
});
