declare module "*/.dependency-cruiser.cjs" {
  import type { IConfiguration } from "dependency-cruiser";
  const config: IConfiguration & { forbidden: NonNullable<IConfiguration["forbidden"]> };
  export default config;
}
