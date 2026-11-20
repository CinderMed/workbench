/**
 * Access to the opened project file (ADR-0021, local mode). With the File System Access API
 * (Chromium) the file itself is rewritten; elsewhere the file is read once and saved with an
 * explicit download. Only project files are opened, never data files.
 */

/** Thrown when the file changed outside the app since the app last read or wrote it. */
export class FileChangedError extends Error {
  constructor(name: string) {
    super(`${name} changed outside the app`);
    this.name = "FileChangedError";
  }
}

export interface FileAccess {
  readonly name: string;
  read(): Promise<string>;
  /** Rewrites the file; absent when the file can only be downloaded. */
  readonly write?: (text: string) => Promise<void>;
}

/** The subset of `FileSystemFileHandle` used here (typed locally: not in every DOM lib). */
export interface FileHandle {
  readonly name: string;
  getFile(): Promise<{ readonly lastModified: number; text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

/** A file opened through the File System Access API: read and rewritten in place. */
export function handleAccess(handle: FileHandle): FileAccess {
  let lastModified: number | undefined;
  return {
    name: handle.name,
    async read() {
      const file = await handle.getFile();
      lastModified = file.lastModified;
      return file.text();
    },
    async write(text) {
      const before = await handle.getFile();
      if (lastModified !== undefined && before.lastModified !== lastModified)
        throw new FileChangedError(handle.name);
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      lastModified = (await handle.getFile()).lastModified;
    },
  };
}

/** A file picked with an `<input type="file">` or dropped: read once, saved by download. */
export function blobAccess(file: { readonly name: string; text(): Promise<string> }): FileAccess {
  return { name: file.name, read: () => file.text() };
}
