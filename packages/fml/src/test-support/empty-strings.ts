/** JSON paths of every empty string in a value (FHIR does not allow empty strings, #120). */
export function emptyStrings(value: unknown, path = "$"): string[] {
  if (value === "") return [path];
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => emptyStrings(item, `${path}[${String(i)}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value).flatMap(([key, item]) => emptyStrings(item, `${path}.${key}`));
  }
  return [];
}
