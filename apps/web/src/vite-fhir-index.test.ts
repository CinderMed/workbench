// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { serveFhirIndex } from "../vite-fhir-index";

let base: string;
let dir: string;
beforeAll(async () => {
  base = await mkdtemp(join(tmpdir(), "fhir-index-"));
  dir = join(base, "index");
  await mkdir(join(dir, "types"), { recursive: true });
  await writeFile(join(dir, "index.json"), '{"formatVersion":"1.1.0"}');
  await writeFile(join(dir, "types/Patient.json"), '{"type":"Patient"}');
  await writeFile(join(dir, "notes.txt"), "not json");
  await writeFile(join(base, "secret.json"), '{"secret":true}');
});
afterAll(() => rm(base, { recursive: true, force: true }));

async function get(url: string, method = "GET") {
  const response = { statusCode: 200, headers: {} as Record<string, string>, body: "" };
  let passed = false;
  await serveFhirIndex(dir)(
    { url, method } as IncomingMessage,
    {
      set statusCode(code: number) {
        response.statusCode = code;
      },
      setHeader: (name: string, value: string) => {
        response.headers[name] = value;
      },
      end: (body?: string) => {
        response.body = body ?? "";
      },
    } as unknown as ServerResponse,
    () => {
      passed = true;
    },
  );
  return { ...response, passed };
}

describe("serveFhirIndex (local mode, dev server only)", () => {
  it("serves the index and its documents as JSON", async () => {
    const manifest = await get("/fhir-index/index.json");
    expect(manifest.statusCode).toBe(200);
    expect(manifest.headers["Content-Type"]).toBe("application/json; charset=utf-8");
    expect(manifest.body).toBe('{"formatVersion":"1.1.0"}');
    expect((await get("/fhir-index/types/Patient.json?v=1")).body).toBe('{"type":"Patient"}');
  });

  it.each([
    "/fhir-index/../secret.json",
    "/fhir-index/%2e%2e/secret.json",
    "/fhir-index/types/../../secret.json",
    "/fhir-index/notes.txt",
    "/fhir-index/missing.json",
    "/fhir-index/",
  ])("answers 404 to %s", async (url) => {
    const response = await get(url);
    expect(response.statusCode).toBe(404);
    expect(response.body).toBe("");
  });

  it.each(["/fhir-index/%E0%A4%A", "/fhir-index/%", "/fhir-index/types/%zz.json"])(
    "answers 400 to the malformed escape in %s, without throwing",
    async (url) => {
      const response = await get(url);
      expect(response.statusCode).toBe(400);
      expect(response.body).toBe("");
    },
  );

  it("answers only GET, and leaves other paths to the dev server", async () => {
    expect((await get("/fhir-index/index.json", "POST")).statusCode).toBe(404);
    expect((await get("/src/main.tsx")).passed).toBe(true);
  });
});
