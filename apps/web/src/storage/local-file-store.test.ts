import { type MappingRow, type ProjectFile, objectKey, parseProject } from "@cindermed/model";
import { describe, expect, it } from "vitest";
import metastraProject from "../../../../fixtures/fml-examples/metastra/project.json";
import { type FileHandle, blobAccess, handleAccess } from "./file-access";
import { LocalFileStore, NotAProjectError } from "./local-file-store";

const text = JSON.stringify(metastraProject);

/** A file handle in memory, like the File System Access API's, with a clock for lastModified. */
function memoryHandle(initial: string) {
  const file = { text: initial, lastModified: 1 };
  const handle: FileHandle = {
    name: "metastra.json",
    getFile: () =>
      Promise.resolve({ lastModified: file.lastModified, text: () => Promise.resolve(file.text) }),
    createWritable: () => {
      let next = "";
      return Promise.resolve({
        write: (data: string) => {
          next += data;
          return Promise.resolve();
        },
        close: () => {
          file.text = next;
          file.lastModified += 1;
          return Promise.resolve();
        },
      });
    },
  };
  return { file, handle };
}

const rowOf = (project: ProjectFile): MappingRow => {
  const row = project.mappings[0];
  if (row === undefined) throw new Error("metastra has rows");
  return row;
};

describe("LocalFileStore", () => {
  it("loads a project with version 1 for every object", async () => {
    const store = new LocalFileStore(
      blobAccess({ name: "m.json", text: () => Promise.resolve(text) }),
    );
    const { project, versions } = await store.load();
    expect(project.project.name).toBe("Metastra");
    expect(versions.get(objectKey("mapping", rowOf(project).id))).toBe("1");
    expect(versions.get(objectKey("column", project.sources[0].columns[0].id))).toBe("1");
    expect(versions.size).toBe(1 + 1 + 11 + 6 + 16 + 5);
  });

  it("refuses a file that is not a project, with the reasons", async () => {
    const store = new LocalFileStore(
      blobAccess({ name: "data.csv", text: () => Promise.resolve("patient_id,age\nMTS-1,40\n") }),
    );
    await expect(store.load()).rejects.toBeInstanceOf(NotAProjectError);
  });

  it("rewrites the file after each accepted change and bumps only the changed object", async () => {
    const { file, handle } = memoryHandle(text);
    const store = new LocalFileStore(handleAccess(handle));
    const { project } = await store.load();
    const row = rowOf(project);
    const result = await store.apply([
      {
        op: "update",
        kind: "mapping",
        id: row.id,
        readVersion: "1",
        value: { ...row, path: "note.text" },
      },
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.versions.get(objectKey("mapping", row.id))).toBe("2");
    const other = project.mappings[1];
    expect(other && result.versions.get(objectKey("mapping", other.id))).toBe("1");
    const saved = parseProject(file.text).project;
    expect(saved?.mappings[0]?.path).toBe("note.text");
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it("conflicts only on an object that changed since it was read", async () => {
    const store = new LocalFileStore(handleAccess(memoryHandle(text).handle));
    const { project } = await store.load();
    const [first, second] = project.mappings;
    if (first === undefined || second === undefined) throw new Error("two rows");
    await store.apply([
      {
        op: "update",
        kind: "mapping",
        id: first.id,
        readVersion: "1",
        value: { ...first, path: "note.text" },
      },
    ]);
    // Another row, read at version 1: no conflict.
    const other = await store.apply([
      {
        op: "update",
        kind: "mapping",
        id: second.id,
        readVersion: "1",
        value: { ...second, path: "note.text" },
      },
    ]);
    expect(other.ok).toBe(true);
    // The same row, read at version 1 before the first change: conflict.
    const stale = await store.apply([
      { op: "delete", kind: "mapping", id: first.id, readVersion: "1" },
    ]);
    expect(stale).toMatchObject({
      ok: false,
      reason: "conflict",
      keys: [objectKey("mapping", first.id)],
    });
  });

  it("refuses a change that would not match the schema, and writes nothing", async () => {
    const { file, handle } = memoryHandle(text);
    const store = new LocalFileStore(handleAccess(handle));
    const { project } = await store.load();
    const row = rowOf(project);
    const result = await store.apply([
      {
        op: "update",
        kind: "mapping",
        id: row.id,
        readVersion: "1",
        value: { ...row, path: "Not A Path" },
      },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "invalid" });
    expect(file.text).toBe(text);
  });

  it("refuses to write over a file that changed outside the app", async () => {
    const { file, handle } = memoryHandle(text);
    const store = new LocalFileStore(handleAccess(handle));
    const { project } = await store.load();
    file.lastModified = 99; // saved by another program
    const row = rowOf(project);
    const result = await store.apply([
      {
        op: "update",
        kind: "mapping",
        id: row.id,
        readVersion: "1",
        value: { ...row, path: "note.text" },
      },
    ]);
    expect(result).toMatchObject({ ok: false, reason: "fileChanged" });
  });

  it("keeps changes in memory when the file can only be downloaded", async () => {
    const store = new LocalFileStore(
      blobAccess({ name: "m.json", text: () => Promise.resolve(text) }),
    );
    const { project } = await store.load();
    const row = rowOf(project);
    expect(store.canWriteFile).toBe(false);
    await store.apply([{ op: "delete", kind: "mapping", id: row.id, readVersion: "1" }]);
    expect(store.hasUnsavedChanges).toBe(true);
    const saved = store.download();
    expect(saved.name).toBe("m.json");
    expect(parseProject(saved.text).project?.mappings).toHaveLength(15);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it("gives new ids of the project format", () => {
    const store = new LocalFileStore(
      blobAccess({ name: "m.json", text: () => Promise.resolve(text) }),
    );
    expect(store.newId("mapping")).toMatch(/^map_[a-z0-9]{10}$/);
    expect(store.newId("valueMap")).toMatch(/^vm_[a-z0-9]{10}$/);
  });
});
