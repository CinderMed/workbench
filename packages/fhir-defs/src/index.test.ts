import { describe, expect, it } from "vitest";
import { packageName } from "./index.js";

describe("@cindermed/fhir-defs", () => {
  it("exposes its package name", () => {
    expect(packageName).toBe("@cindermed/fhir-defs");
  });
});
