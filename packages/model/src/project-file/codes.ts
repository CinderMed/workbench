/**
 * Stable result codes of reading a project file (H3).
 * Clients key on these strings: never rename one, add a new code instead.
 */
export const ProjectFileCode = {
  /** The text is not valid JSON. */
  INVALID_JSON: "INVALID_JSON",
  /** `formatVersion` is newer than this version, or older with no migration. */
  UNSUPPORTED_FORMAT_VERSION: "UNSUPPORTED_FORMAT_VERSION",
} as const;

export type ProjectFileCode = (typeof ProjectFileCode)[keyof typeof ProjectFileCode];
