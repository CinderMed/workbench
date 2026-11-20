/**
 * The "done when" of module 7 (specification, "Incremental module plan"; v0.4.0): starting from
 * the output of `cindermed init` on the Metastra data file, the Metastra project is built in the
 * local mode, with no server:
 *
 * - done in the UI: the roles (resource type, index, label, table), the named slice and the rows
 *   of the columns (column, role, path, transform, repeat);
 * - loaded from the fixture through the storage interface, as the screens of later modules will
 *   write them: the column metadata with the table's sections and row key (module 5), the value
 *   maps (module 8), the rest of each role (module 6) once the UI has created it, the reference
 *   rows (F1–F3, module 6) in their place among the rows, and the project settings;
 * - the saved project equals the fixture except object ids, dates and review statuses; the column
 *   names and order come from `cindermed init` and are compared too.
 *
 * It needs the R4 core package (the path picker and the checks use the real definitions):
 * FHIR_CORE_PACKAGES=1, as in the Unit tests job. The boolean on Patient.name is red in
 * local/inline-validation.test.tsx; the rows of several tables (MOTU) are the second test here.
 */
import { MantineProvider } from "@mantine/core";
import {
  type Instance,
  type MappingRow,
  type ProjectFile,
  type Transform,
  isProjectFile,
  nextRowCode,
} from "@cindermed/model";
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { useState } from "react";
import { I18nextProvider } from "react-i18next";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { run } from "../../cli/src/cli";
import { loadDefinitions } from "../../cli/src/fhir-packages";
import motuProject from "../../../fixtures/fml-examples/motu/project.json";
import { createI18n } from "./i18n";
import { LocalApp, ProjectView } from "./local/LocalApp";
import { blobAccess } from "./storage/file-access";
import { LocalFileStore } from "./storage/local-file-store";
import type { Loaded, StoreChange } from "./storage/project-store";
import { mockLayout } from "./test-layout";
import type { BrowserDefinitions } from "./validation/index-fetch";
import { openDefinitions, validateAll } from "./validation/validate";

const enabled = process.env["FHIR_CORE_PACKAGES"] === "1";
const repoRoot = resolve(import.meta.dirname, "../../..");
const METASTRA = join(repoRoot, "fixtures/fml-examples/metastra");
const work = join(repoRoot, ".tmp/done-when");

let restore: (() => void) | undefined;
beforeEach(() => {
  restore = mockLayout(4000);
});
afterEach(() => {
  cleanup();
  restore?.();
});

const load = (document: unknown): ProjectFile => {
  const copy = JSON.parse(JSON.stringify(document)) as unknown;
  if (!isProjectFile(copy)) throw new Error("not a project");
  return copy;
};

/** `cindermed` as bin.ts runs it, on this machine's files. */
async function cindermed(args: string[]): Promise<void> {
  const errors: string[] = [];
  const code = await run(args, {
    readFile: (path) => readFile(path, "utf8"),
    readChunks: (path) => createReadStream(path),
    exists: (path) =>
      access(path).then(
        () => true,
        () => false,
      ),
    stdout: () => undefined,
    stderr: (text) => errors.push(text),
    writeFile: async (path, data) => {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, data);
    },
    now: () => new Date(),
    version: "0.0.0-test",
    loadDefinitions,
  });
  if (code !== 0) throw new Error(`cindermed ${args[0] ?? ""}: ${errors.join("")}`);
}

/** Every string equal to a key replaced by its value, deep (ids that point to other objects). */
function renamed<T>(value: T, ids: ReadonlyMap<string, string>): T {
  const walk = (v: unknown): unknown =>
    typeof v === "string"
      ? (ids.get(v) ?? v)
      : Array.isArray(v)
        ? v.map(walk)
        : typeof v === "object" && v !== null
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
          : v;
  return walk(value) as T;
}

const OPTIONAL_LISTS = new Set(["sourceRelations", "templates"]);

/** A value that must be there. */
function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing: ${what}`);
  return value;
}

/** An object without some of its keys. */
function omit<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !keys.some((k) => k === key)),
  ) as Omit<T, K>;
}

/**
 * The project without what the comparison leaves out: dates and review statuses (A5, module 4),
 * and what only the file holds: its `$schema` pointer, and top-level lists left out when empty.
 */
function comparable(project: ProjectFile): unknown {
  const file = Object.fromEntries(
    Object.entries(project).filter(
      ([key, value]) =>
        key !== "$schema" &&
        !(OPTIONAL_LISTS.has(key) && Array.isArray(value) && value.length === 0),
    ),
  );
  const drop = new Set(["createdAt", "updatedAt", "importedAt", "review"]);
  const walk = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(walk)
      : typeof v === "object" && v !== null
        ? Object.fromEntries(
            Object.entries(v)
              .filter(([k]) => !drop.has(k))
              .map(([k, x]) => [k, walk(x)]),
          )
        : v;
  return walk(file);
}

/** The local mode on a project, with the store in the test's hands for the loader. */
async function openLocal(text: string, definitions?: () => Promise<BrowserDefinitions>) {
  const store = new LocalFileStore(
    blobAccess({ name: "project.json", text: () => Promise.resolve(text) }),
  );
  let loaded: Loaded = await store.load();
  let show: (next: Loaded) => void = () => undefined;
  const validator =
    definitions === undefined
      ? (p: ProjectFile) => validateAll(p, { message: "no definitions in this test" })
      : async (p: ProjectFile) => validateAll(p, await definitions());
  function Harness() {
    const [state, setState] = useState(loaded);
    show = setState;
    return (
      <ProjectView
        project={state.project}
        versions={state.versions}
        store={store}
        onLoaded={(next) => {
          loaded = next;
          setState(next);
        }}
        validator={validator}
        {...(definitions === undefined ? {} : { definitions })}
      />
    );
  }
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <Harness />
      </MantineProvider>
    </I18nextProvider>,
  );
  /** Writes through the store, as a later module's screen would, and shows the result. */
  const write = async (changes: StoreChange[]) => {
    const result = await store.apply(changes);
    if (!result.ok) throw new Error(`refused: ${JSON.stringify(result)}`);
    loaded = result;
    act(() => {
      show(result);
    });
  };
  return { store, write, current: () => loaded.project, versions: () => loaded.versions };
}

const grid = () => screen.getByRole("grid");
const lineOf = (match: (cells: HTMLElement[]) => boolean): HTMLElement[] => {
  for (const row of within(grid()).getAllByRole("row")) {
    const cells = within(row).queryAllByRole("gridcell");
    if (cells.length > 1 && match(cells)) return cells;
  }
  throw new Error("no such line");
};
/** The cells of the empty line of a column, or of the row with this code. */
const emptyLine = (column: string) =>
  lineOf((c) => c[0]?.textContent === "" && c[1]?.textContent === column);
const rowLine = (code: string) => lineOf((c) => c[0]?.textContent === code);
const cell = (cells: HTMLElement[], index: number): HTMLElement => {
  const found = cells[index];
  if (found === undefined) throw new Error(`no cell ${String(index)}`);
  return found;
};
const ROLE = 3;
const ELEMENT = 4;
const TRANSFORM = 5;

describe.runIf(enabled)("module 7 is done (v0.4.0)", () => {
  let definitions: () => Promise<BrowserDefinitions>;

  beforeAll(async () => {
    await rm(work, { recursive: true, force: true });
    // The FHIR definition index of the project's version, as for `pnpm dev`.
    const index = join(work, "fhir-index");
    await cindermed(["fhir-index", join(METASTRA, "project.json"), "--out", index]);
    const fetch = (file: string) => readFile(join(index, file), "utf8");
    const opened = await openDefinitions(fetch);
    if (!("defs" in opened)) throw new Error(opened.message);
    definitions = () => Promise.resolve({ defs: opened.defs, fetch });
  }, 300_000);

  afterAll(async () => {
    await rm(work, { recursive: true, force: true });
  });

  it("builds the Metastra project from cindermed init in the local mode", async () => {
    const fixture = load(JSON.parse(await readFile(join(METASTRA, "project.json"), "utf8")));
    const [source] = fixture.sources;

    // 1. cindermed init on the Metastra data file: the header only.
    const initPath = join(work, "metastra.json");
    await cindermed([
      "init",
      join(METASTRA, "test-data/sample-row.csv"),
      "--name",
      fixture.project.name,
      "--table",
      source.name,
      "--fhir-version",
      fixture.project.fhirVersion,
      "--canonical-base",
      fixture.project.canonicalBase,
      "--out",
      initPath,
    ]);
    const initText = await readFile(initPath, "utf8");
    const init = load(JSON.parse(initText));
    // The column names and their order come from init, and are those of the fixture.
    expect(init.sources[0].columns.map((c) => c.name)).toEqual(source.columns.map((c) => c.name));
    expect(init.instances).toEqual([]);
    expect(init.mappings).toEqual([]);

    const user = userEvent.setup();
    const local = await openLocal(initText, definitions);
    await screen.findByRole("grid");
    const project = () => local.current();
    const initSource = project().sources[0];

    // The ids of the fixture's objects in the project being built.
    const ids = new Map<string, string>([
      [fixture.project.id, project().project.id],
      [source.id, initSource.id],
    ]);
    for (const column of source.columns) {
      const made = initSource.columns.find((c) => c.name === column.name);
      if (made === undefined) throw new Error(column.name);
      ids.set(column.id, made.id);
    }
    const version = (kind: string, id: string) => {
      const v = local.versions().get(`${kind}/${id}`);
      return v === undefined ? {} : { readVersion: v };
    };

    // 2. Loaded through the store before the UI steps: project settings, the table's metadata
    //    (sections, row key), the column metadata, the value maps.
    const settings = omit(renamed(fixture.project, ids), "id");
    const table = omit(renamed(source, ids), "columns");
    await local.write([
      {
        op: "update",
        kind: "project",
        id: project().project.id,
        value: { ...settings, id: project().project.id },
      },
      { op: "update", kind: "source", id: initSource.id, value: table },
      ...source.columns.map((column): StoreChange => ({
        op: "update",
        kind: "column",
        id: ids.get(column.id) ?? "",
        value: renamed(column, ids),
      })),
      ...fixture.valueMaps.map((map): StoreChange => ({
        op: "create",
        kind: "valueMap",
        value: map,
      })),
    ]);

    // 3. In the UI: the roles (type, index, label, table).
    await user.click(screen.getByRole("tab", { name: /Roles/ }));
    for (const role of fixture.instances) {
      await user.click(screen.getByRole("button", { name: "Add role" }));
      const dialog = await screen.findByRole("dialog");
      await user.type(within(dialog).getByLabelText(/Resource type/), role.resourceType);
      const index = within(dialog).getByLabelText("Index");
      await user.clear(index);
      await user.type(index, String(role.index));
      await user.type(within(dialog).getByLabelText("Label"), role.label ?? "");
      await user.selectOptions(within(dialog).getByLabelText("Table"), initSource.id);
      await user.click(within(dialog).getByRole("button", { name: "Save" }));
      await waitFor(() => {
        expect(screen.queryByRole("dialog")).toBeNull();
      });
      const made = project().instances.at(-1);
      expect(made).toMatchObject({
        resourceType: role.resourceType,
        index: role.index,
        label: role.label,
        sourceId: initSource.id,
      });
      if (made !== undefined) ids.set(role.id, made.id);
    }
    //    The rest of each role, loaded as module 6 will write it (slices: in the UI, below).
    await local.write(
      fixture.instances.map((role): StoreChange => {
        const id = ids.get(role.id) ?? "";
        const rest = omit(renamed(role, ids), "slices");
        return {
          op: "update",
          kind: "instance",
          id,
          value: { ...rest, id },
          ...version("instance", id),
        };
      }),
    );

    // 4. The rows, in the fixture's order: those of a column in the UI, references loaded.
    await user.click(screen.getByRole("tab", { name: /Grid/ }));
    for (const row of fixture.mappings) {
      if (row.columnId === undefined) {
        const id = local.store.newId("mapping");
        await local.write([
          {
            op: "create",
            kind: "mapping",
            value: { ...renamed(row, ids), id, code: nextRowCode(project()) },
          },
        ]);
        ids.set(row.id, id);
        continue;
      }
      const column = must(
        source.columns.find((c) => c.id === row.columnId),
        "column",
      );
      const roleId = ids.get(row.instanceId) ?? "";
      // Role: Enter on the cell, choose, Enter.
      await user.click(cell(emptyLine(column.name), ROLE));
      await user.keyboard("{Enter}");
      await user.selectOptions(within(grid()).getByRole("combobox", { name: "Role" }), roleId);
      await user.keyboard("{Enter}");
      // Element: typed with F2, or the named slice through the path picker.
      if (row.path.includes("[")) await pickSlicePath(user, column.name, row, fixture);
      else {
        await user.click(cell(emptyLine(column.name), ELEMENT));
        await user.keyboard("{F2}");
        await user.type(within(grid()).getByRole("textbox", { name: "Element" }), row.path);
        await user.keyboard("{Enter}");
      }
      const code = nextRowCode({ ...project(), mappings: project().mappings.slice(0, -1) });
      await waitFor(() => {
        expect(project().mappings.at(-1)?.path).toBe(row.path);
      });
      const made = must(project().mappings.at(-1), "row");
      expect(made.code).toBe(code);
      ids.set(row.id, made.id);
      // Transform and repeat in the transform editor.
      await setTransform(user, made.code, row.transform, row.repeat !== undefined, ids);
    }

    // 5. The saved project equals the fixture, except ids, dates and review statuses.
    const saved = load(JSON.parse(local.store.download().text));
    const back = new Map([...ids].map(([fixtureId, id]) => [id, fixtureId]));
    const slice = project().instances.flatMap((i) => i.slices ?? [])[0];
    const fixtureSlice = fixture.instances.flatMap((i) => i.slices ?? [])[0];
    if (slice !== undefined && fixtureSlice !== undefined) back.set(slice.id, fixtureSlice.id);
    expect(comparable(renamed(saved, back))).toEqual(comparable(fixture));
    // Every row of a column was made in the UI; validation finds no error.
    const checked = await validateAll(saved, await definitions());
    expect(checked.results.filter((r) => r.severity === "error")).toEqual([]);
  }, 600_000);
});

/** The Element of R-007: the path picker, a new named slice, then its valueInteger. */
async function pickSlicePath(
  user: ReturnType<typeof userEvent.setup>,
  columnName: string,
  row: MappingRow,
  fixture: ProjectFile,
) {
  const slice = fixture.instances.flatMap((i) => i.slices ?? [])[0];
  if (slice === undefined) throw new Error("Metastra declares a slice");
  const [discriminator] = slice.discriminator;
  if (!("coding" in discriminator.value)) throw new Error("a coding");
  await user.click(cell(emptyLine(columnName), ELEMENT));
  await user.keyboard("{Enter}");
  const dialog = await screen.findByRole("dialog", {}, { timeout: 30_000 });
  const tree = await within(dialog).findByRole("tree", {}, { timeout: 30_000 });
  const item = (path: string) =>
    within(tree)
      .getAllByRole("treeitem")
      .find((i) => i.textContent.replace(/[▸▾]/g, "").startsWith(path));
  await user.click(must(item(slice.path), slice.path));
  await user.click(
    within(dialog).getByRole("button", { name: `Name a repetition of ${slice.path}` }),
  );
  await user.type(within(dialog).getByLabelText(/^Name/), slice.name);
  expect(within(dialog).getByLabelText("Told apart by")).toHaveProperty(
    "value",
    discriminator.path,
  );
  await user.type(within(dialog).getByLabelText(/^Code system/), discriminator.value.coding.system);
  await user.type(
    within(dialog).getByLabelText(/^Code(?! system)/),
    discriminator.value.coding.code,
  );
  await user.click(within(dialog).getByRole("button", { name: "Create slice" }));
  await waitFor(() => {
    expect(within(dialog).getByTestId("picker-selected").textContent).toBe(
      `${slice.path}[${slice.name}]`,
    );
  });
  // The child under the new slice: the last line with its name.
  const leaf = row.path.split(".").at(-1) ?? "";
  const leaves = within(within(dialog).getByRole("tree"))
    .getAllByRole("treeitem")
    .filter((i) => i.textContent.replace(/[▸▾]/g, "").startsWith(`${leaf}0..`));
  await user.dblClick(must(leaves.at(-1), "leaf"));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
}

/** Sets a row's transform (and repeat) in the transform editor, as the fixture has it. */
async function setTransform(
  user: ReturnType<typeof userEvent.setup>,
  code: string,
  transform: Transform,
  repeat: boolean,
  ids: ReadonlyMap<string, string>,
) {
  if (transform.kind === "copy" && !repeat) return;
  await user.dblClick(cell(rowLine(code), TRANSFORM));
  const dialog = await screen.findByRole("dialog");
  const field = (label: RegExp | string) => within(dialog).getByLabelText(label);
  await user.selectOptions(field("Transform"), transform.kind);
  switch (transform.kind) {
    case "cast":
      await user.selectOptions(field("Convert to"), transform.to);
      if (transform.inputFormat !== undefined) {
        await user.clear(field(/Format in the data file/));
        await user.type(field(/Format in the data file/), transform.inputFormat);
      }
      break;
    case "valueMap":
      await user.selectOptions(field("Value map"), transform.valueMapId);
      break;
    case "quantity":
      if (transform.unitColumnId !== undefined && transform.unitValueMapId !== undefined) {
        await user.click(within(dialog).getByText("Unit from a column"));
        await user.selectOptions(field("Unit column"), ids.get(transform.unitColumnId) ?? "");
        await user.selectOptions(field(/^Unit value map/), transform.unitValueMapId);
      }
      break;
    default:
      break;
  }
  if (repeat) await user.click(field(/One repetition per selected value/));
  await user.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
  });
}

describe("rows of several tables in the same grid (MOTU)", () => {
  it("maps a column of each table, switching table in the grid", async () => {
    const motu = load(motuProject);
    const user = userEvent.setup();
    const download = vi.fn<(name: string, text: string) => void>();
    render(
      <I18nextProvider i18n={createI18n()}>
        <MantineProvider>
          <LocalApp
            download={download}
            validator={(p) => validateAll(p, { message: "no definitions in this test" })}
          />
        </MantineProvider>
      </I18nextProvider>,
    );
    // MOTU without its rows: two of them are made again, one in each table.
    await userEvent.upload(
      screen.getByTestId("file-input"),
      new File([JSON.stringify({ ...motu, mappings: [] })], "motu.json"),
    );
    await screen.findByRole("grid");
    const made: { table: string; column: string; role: Instance; path: string }[] = [];
    for (const code of ["R-001", "R-007"]) {
      const row = must(
        motu.mappings.find((m) => m.code === code),
        code,
      );
      const table = motu.sources.find((s) => s.columns.some((c) => c.id === row.columnId));
      const column = table?.columns.find((c) => c.id === row.columnId);
      const role = motu.instances.find((i) => i.id === row.instanceId);
      if (table === undefined || column === undefined || role === undefined) throw new Error(code);
      made.push({ table: table.name, column: column.name, role, path: row.path });
      await user.click(screen.getByRole("radio", { name: table.name }));
      await user.click(cell(emptyLine(column.name), ROLE));
      await user.keyboard("{Enter}");
      await user.selectOptions(within(grid()).getByRole("combobox", { name: "Role" }), role.id);
      await user.keyboard("{Enter}");
      await user.click(cell(emptyLine(column.name), ELEMENT));
      await user.keyboard("{F2}");
      await user.type(within(grid()).getByRole("textbox", { name: "Element" }), row.path);
      await user.keyboard("{Enter}");
      await waitFor(() => {
        expect(cell(rowLine(`R-00${String(made.length)}`), ELEMENT).textContent).toBe(row.path);
      });
    }
    await user.click(screen.getByRole("button", { name: "Download project" }));
    const [, text] = download.mock.calls.at(-1) ?? [];
    const saved = load(JSON.parse(text ?? "{}"));
    expect(new Set(made.map((m) => m.table)).size).toBe(2);
    expect(
      saved.mappings.map((m) => [m.code, m.columnId, m.instanceId, m.path, m.transform]),
    ).toEqual(
      ["R-001", "R-007"].map((code, i) => {
        const row = must(
          motu.mappings.find((m) => m.code === code),
          code,
        );
        return [`R-00${String(i + 1)}`, row.columnId, row.instanceId, row.path, row.transform];
      }),
    );
  });
});
