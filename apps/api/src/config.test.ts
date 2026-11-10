import { describe, expect, it } from "vitest";
import { readServerConfig } from "./config.js";

describe("readServerConfig", () => {
  it("defaults to 0.0.0.0:3000", () => {
    expect(readServerConfig({})).toEqual({ host: "0.0.0.0", port: 3000 });
  });

  it("reads HOST and PORT", () => {
    expect(readServerConfig({ HOST: "127.0.0.1", PORT: "8000" })).toEqual({
      host: "127.0.0.1",
      port: 8000,
    });
  });

  it.each(["0", "70000", "abc", "3.5"])("rejects PORT=%s", (port) => {
    expect(() => readServerConfig({ PORT: port })).toThrow("PORT must be an integer");
  });
});
