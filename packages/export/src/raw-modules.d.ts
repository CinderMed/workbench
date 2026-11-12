/** Text files imported by the tests with Vite's `?raw` suffix (no fs in domain packages, ADR-0001). */
declare module "*?raw" {
  const text: string;
  export default text;
}

/** Vite's `import.meta.glob`, used by the golden test to read the fixture files (no fs, ADR-0001). */
interface ImportMeta {
  glob<T>(
    pattern: string,
    options: { query: string; import: string; eager: true },
  ): Record<string, T>;
}
