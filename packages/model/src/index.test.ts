import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@cindermed/model", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@cindermed/model");
  });
});
