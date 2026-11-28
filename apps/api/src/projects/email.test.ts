import { describe, expect, it } from "vitest";
import { isEmail } from "./members.js";

describe("isEmail", () => {
  it.each(["ada@example.org", "first.last@sub.example.co.uk", "a@b.c"])("accepts %s", (text) => {
    expect(isEmail(text)).toBe(true);
  });

  it.each([
    "",
    "ada",
    "@example.org",
    "ada@",
    "ada@example",
    "ada@.org",
    "ada@example.",
    "a@b@c.d",
    "ada @example.org",
  ])("refuses %j", (text) => {
    expect(isEmail(text)).toBe(false);
  });

  it("stays fast on the input that slowed the old pattern down", () => {
    const start = performance.now();
    expect(isEmail(`!@!.${"!.".repeat(100_000)}`)).toBe(false);
    expect(isEmail(`!@!.${"!.".repeat(100_000)}x`)).toBe(true);
    expect(performance.now() - start).toBeLessThan(100);
  });
});
