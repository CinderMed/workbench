import { describe, expect, it } from "vitest";
import metastra from "../../../../fixtures/fml-examples/metastra/project.json" with { type: "json" };
import motu from "../../../../fixtures/fml-examples/motu/project.json" with { type: "json" };
import type { ProjectFile } from "../generated/project.js";
import { IntegrityCode } from "../integrity/index.js";
import { SCHEMA_VIOLATION } from "../schema-validation.js";
import { PROJECT_FORMAT_VERSION } from "../schemas.js";
import {
  type Migration,
  type ParsedProject,
  ProjectFileCode,
  migrateProject,
  parseProject,
  serializeProject,
  validateProject,
} from "./index.js";
import { orderKeys } from "./key-order.js";

const examples = { metastra, motu } as const;

function copy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Reverses the key order of every object, to prove the output does not depend on it. */
function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseKeys);
  if (typeof value !== "object" || value === null) return value;
  const reversed: Record<string, unknown> = {};
  for (const key of Object.keys(value).reverse()) {
    reversed[key] = reverseKeys((value as Record<string, unknown>)[key]);
  }
  return reversed;
}

function projectOf(parsed: ParsedProject): ProjectFile {
  if (parsed.project === undefined) throw new Error("expected a project");
  return parsed.project;
}

function withVersion(formatVersion: string): Record<string, unknown> {
  return { ...copy(motu), formatVersion };
}

describe.each(Object.entries(examples))("example project %s", (_name, example) => {
  const text = JSON.stringify(example);

  it("parses with no results", () => {
    const parsed = parseProject(text);
    expect(parsed.results).toEqual([]);
    expect(parsed.project).toEqual(example);
    expect(parsed.migratedFrom).toBeUndefined();
  });

  it("round-trips through serialize and parse", () => {
    const project = projectOf(parseProject(text));
    const serialized = serializeProject(project);
    const reparsed = parseProject(serialized);
    expect(reparsed.results).toEqual([]);
    expect(reparsed.project).toEqual(project);
    expect(serializeProject(projectOf(reparsed))).toBe(serialized);
  });

  it("serializes to the same text whatever the key order of the input", () => {
    const project = example as unknown as ProjectFile;
    expect(serializeProject(reverseKeys(project) as ProjectFile)).toBe(serializeProject(project));
  });
});

describe("serializeProject", () => {
  const project = copy(motu) as unknown as ProjectFile;
  const text = serializeProject(project);

  it("indents with two spaces and ends with a newline", () => {
    expect(text.startsWith('{\n  "$schema"')).toBe(true);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  it("puts the top-level keys in schema order", () => {
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);
    expect(keys).toEqual(
      [
        "$schema",
        "formatVersion",
        "project",
        "sources",
        "sourceRelations",
        "instances",
        "mappings",
        "valueMaps",
        "templates",
        "extensions",
      ].filter((key) => key in project),
    );
  });

  it("puts the keys of nested objects in the order of their definition", () => {
    const column = (JSON.parse(text) as ProjectFile).sources[0].columns[0];
    expect(Object.keys(column)[0]).toBe("id");
  });

  it("sorts the keys of open maps and keeps the order of arrays", () => {
    const withExtensions = {
      ...project,
      extensions: { zeta: 1, alpha: { b: 2, a: 1 }, list: [3, 1, 2] },
    } as ProjectFile;
    const parsed = JSON.parse(serializeProject(withExtensions)) as {
      extensions: Record<string, unknown>;
    };
    expect(Object.keys(parsed.extensions)).toEqual(["alpha", "list", "zeta"]);
    expect(Object.keys(parsed.extensions["alpha"] as object)).toEqual(["a", "b"]);
    expect(parsed.extensions["list"]).toEqual([3, 1, 2]);
  });
});

describe("orderKeys", () => {
  const schema = {
    $defs: {
      "a/b": { type: "object", properties: { z: { type: "string" }, y: { type: "string" } } },
    },
    type: "object",
    properties: { kind: { type: "string" }, nested: { $ref: "#/$defs/a~1b" } },
    oneOf: [{ properties: { first: { type: "string" } } }],
    if: { properties: { kind: { const: "x" } } },
    then: { properties: { second: { type: "string" } } },
    else: { properties: { third: { type: "string" } } },
  };

  it("follows $ref, composition and conditional branches", () => {
    const value = {
      third: "",
      second: "",
      first: "",
      other: "",
      nested: { y: "", z: "" },
      kind: "x",
    };
    const ordered = orderKeys(value, schema) as Record<string, unknown>;
    expect(Object.keys(ordered)).toEqual(["kind", "nested", "first", "second", "third", "other"]);
    expect(Object.keys(ordered["nested"] as object)).toEqual(["z", "y"]);
  });

  it("leaves scalars and unresolvable references alone", () => {
    expect(orderKeys("text", schema)).toBe("text");
    expect(orderKeys(null, schema)).toBeNull();
    const broken = { properties: { a: { $ref: "#/$defs/missing" } } };
    expect(orderKeys({ a: { y: 1, x: 2 } }, broken)).toEqual({ a: { x: 2, y: 1 } });
  });
});

describe("parseProject", () => {
  it("reports text that is not JSON", () => {
    const parsed = parseProject("{ not json");
    expect(parsed.project).toBeUndefined();
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0]).toMatchObject({
      severity: "error",
      code: ProjectFileCode.INVALID_JSON,
      objectKind: "project",
    });
  });

  it("returns no project when the schema check fails", () => {
    const parsed = parseProject(JSON.stringify({ formatVersion: PROJECT_FORMAT_VERSION }));
    expect(parsed.project).toBeUndefined();
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(parsed.results.every((result) => result.code === SCHEMA_VIOLATION)).toBe(true);
  });

  it("returns the project together with its integrity errors", () => {
    const project = copy(motu);
    const [first, second] = project.mappings;
    if (first === undefined || second === undefined) throw new Error("motu needs two rows");
    second.code = first.code;
    const parsed = parseProject(JSON.stringify(project));
    expect(parsed.project).toBeDefined();
    expect(parsed.results.map((result) => result.code)).toEqual([IntegrityCode.DUPLICATE_ROW_CODE]);
  });

  it.each(["2.0.0", "1.3.0"])("rejects the newer format version %s", (version) => {
    const parsed = parseProject(JSON.stringify(withVersion(version)));
    expect(parsed.project).toBeUndefined();
    expect(parsed.results).toEqual([
      expect.objectContaining({
        code: ProjectFileCode.UNSUPPORTED_FORMAT_VERSION,
        objectKind: "project",
        field: "formatVersion",
      }),
    ]);
  });

  it("reads another patch of the current minor as it is", () => {
    const parsed = parseProject(JSON.stringify(withVersion("1.2.7")));
    expect(parsed.results).toEqual([]);
    expect(parsed.migratedFrom).toBeUndefined();
    expect(parsed.project?.formatVersion).toBe("1.2.7");
  });

  it("reads an older minor of the same major and stamps the current version", () => {
    const parsed = parseProject(JSON.stringify(withVersion("1.0.0")));
    expect(parsed.results).toEqual([]);
    expect(parsed.migratedFrom).toBe("1.0.0");
    expect(parsed.project?.formatVersion).toBe(PROJECT_FORMAT_VERSION);
  });

  it("rejects an older major with no migration", () => {
    const parsed = parseProject(JSON.stringify(withVersion("0.9.0")));
    expect(parsed.results).toEqual([
      expect.objectContaining({
        code: ProjectFileCode.UNSUPPORTED_FORMAT_VERSION,
        message: expect.stringContaining("no migration from 0.x") as unknown,
      }),
    ]);
  });

  it("runs the registered migrations of an older major", () => {
    const { project: projectInfo, ...rest } = copy(motu);
    const legacy = { ...rest, formatVersion: "0.4.0", meta: projectInfo };
    const renameMeta: Migration = {
      fromMajor: 0,
      migrate: ({ meta, ...document }) => ({ ...document, project: meta }),
    };
    const parsed = parseProject(JSON.stringify(legacy), [renameMeta]);
    expect(parsed.results).toEqual([]);
    expect(parsed.migratedFrom).toBe("0.4.0");
    expect(parsed.project?.project).toEqual(projectInfo);
  });
});

describe("migrateProject", () => {
  it.each([[null], [[1, 2]], ["text"], [{}], [{ formatVersion: 12 }], [{ formatVersion: "1.2" }]])(
    "leaves %j to the schema check",
    (document) => {
      expect(migrateProject(document)).toEqual({ document, results: [] });
    },
  );

  it("does not change the input document", () => {
    const document = withVersion("1.1.0");
    migrateProject(document);
    expect(document["formatVersion"]).toBe("1.1.0");
  });
});

describe("validateProject", () => {
  it("stops at the schema level when the schema check fails", () => {
    expect(validateProject({}).every((result) => result.code === SCHEMA_VIOLATION)).toBe(true);
  });

  it("runs the integrity level on a document that passes the schema", () => {
    expect(validateProject(copy(metastra))).toEqual([]);
  });
});
