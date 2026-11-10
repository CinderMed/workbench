declare module "*/commitlint.config.js" {
  const config: {
    extends: string[];
    rules: { "scope-enum": [number, "always" | "never", string[]] };
  };
  export default config;
}
