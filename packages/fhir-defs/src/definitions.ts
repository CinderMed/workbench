/**
 * The definitions of one index (ADR-0013), opened from its manifest. Type documents are loaded
 * only when needed: the CLI and the API add them all at once from a built index; the browser loads
 * the few it needs through `load`, with a fetch function it provides. Every document is checked
 * against the manifest's SHA-256 before use. No I/O happens here.
 */
import { sha256Hex } from "./hash.js";
import {
  type IndexEntry,
  type IndexIssue,
  type IndexManifest,
  type Result,
  type TypeDocument,
  failure,
  parseManifest,
  parseTypeDocument,
} from "./index-format.js";

/** Gets the text of a file of the index (a path from the manifest, such as `types/Patient.json`). */
export type IndexFetch = (file: string) => Promise<string>;

export class FhirDefinitions {
  readonly manifest: IndexManifest;
  private readonly byUrl = new Map<string, IndexEntry>();
  private readonly byType = new Map<string, IndexEntry>();
  private readonly documents = new Map<string, TypeDocument>();

  private constructor(manifest: IndexManifest) {
    this.manifest = manifest;
    for (const entry of manifest.entries) {
      this.byUrl.set(entry.url, entry);
      // Types are found by name too; profiles only by URL.
      if (entry.derivation !== "constraint") this.byType.set(entry.type, entry);
    }
  }

  /** Opens an index from its manifest (the parsed `index.json`). */
  static open(manifest: unknown): Result<FhirDefinitions> {
    const parsed = parseManifest(manifest);
    if (!parsed.ok) return parsed;
    return { ok: true, value: new FhirDefinitions(parsed.value), issues: [] };
  }

  get fhirVersion(): string {
    return this.manifest.fhirVersion;
  }

  /** The manifest entry of a type (by name, such as `Patient`) or of a type or profile (by URL). */
  entry(ref: string): IndexEntry | undefined {
    return this.byType.get(ref) ?? this.byUrl.get(ref);
  }

  /** The resource types that can be created: concrete resources, not profiles, sorted. */
  resourceTypes(): string[] {
    return this.manifest.entries
      .filter((e) => e.kind === "resource" && !e.abstract && e.derivation === "specialization")
      .map((e) => e.type)
      .sort();
  }

  /** The document of a type or profile, if it has been loaded. */
  document(ref: string): TypeDocument | undefined {
    const entry = this.entry(ref);
    return entry === undefined ? undefined : this.documents.get(entry.file);
  }

  isLoaded(ref: string): boolean {
    return this.document(ref) !== undefined;
  }

  /** Adds the text of a document of the manifest, after checking its digest and format. */
  add(file: string, text: string): Result<TypeDocument> {
    const entry = this.manifest.entries.find((e) => e.file === file);
    if (entry === undefined)
      return failure({
        severity: "error",
        code: "INDEX_ENTRY_UNKNOWN",
        message: `${file} is not in the index`,
        subject: file,
      });
    if (sha256Hex(text) !== entry.sha256)
      return failure({
        severity: "error",
        code: "INDEX_DOCUMENT_DIGEST_MISMATCH",
        message: `${file} does not match the SHA-256 of the index`,
        subject: file,
      });
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    const parsed = parseTypeDocument(json, file);
    if (!parsed.ok) return parsed;
    if (parsed.value.url !== entry.url)
      return failure({
        severity: "error",
        code: "INDEX_DOCUMENT_MALFORMED",
        message: `${file} defines ${parsed.value.url}, not ${entry.url}`,
        subject: file,
      });
    this.documents.set(file, parsed.value);
    return parsed;
  }

  /**
   * Loads the documents of these types or profiles that are not loaded yet, in parallel. Unknown
   * references and failed fetches are reported; the documents that did load stay loaded.
   */
  async load(refs: readonly string[], fetch: IndexFetch): Promise<Result<void>> {
    const issues: IndexIssue[] = [];
    const files = new Set<string>();
    for (const ref of refs) {
      const entry = this.entry(ref);
      if (entry === undefined)
        issues.push({
          severity: "error",
          code: "INDEX_ENTRY_UNKNOWN",
          message: `${ref} is not in the index`,
          subject: ref,
        });
      else if (!this.documents.has(entry.file)) files.add(entry.file);
    }
    await Promise.all(
      [...files].map(async (file) => {
        let text: string;
        try {
          text = await fetch(file);
        } catch (error) {
          issues.push({
            severity: "error",
            code: "INDEX_DOCUMENT_UNAVAILABLE",
            message: `${file} could not be fetched: ${error instanceof Error ? error.message : String(error)}`,
            subject: file,
          });
          return;
        }
        const added = this.add(file, text);
        if (!added.ok) issues.push(...added.issues);
      }),
    );
    return issues.length === 0 ? { ok: true, value: undefined, issues } : { ok: false, issues };
  }
}

/** Identifier of an index: the SHA-256 of its manifest text. The API serves an index under it. */
export function indexId(manifestText: string): string {
  return sha256Hex(manifestText);
}
