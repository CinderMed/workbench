/** Text files imported by the tests with Vite's `?raw` suffix (no fs in domain packages, ADR-0001). */
declare module "*?raw" {
  const text: string;
  export default text;
}
