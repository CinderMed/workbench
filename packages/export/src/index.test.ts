import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@cindermed/export", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@cindermed/export");
  });
});
