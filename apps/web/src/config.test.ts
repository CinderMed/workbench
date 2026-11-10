import { describe, expect, it } from "vitest";
import { readWebConfig } from "./config";

describe("readWebConfig", () => {
  it("defaults to the Docker Compose realm and client", () => {
    expect(readWebConfig({})).toEqual({
      oidcAuthority: "http://localhost:8081/realms/cindermed",
      oidcClientId: "cindermed-web",
    });
  });

  it("reads the Vite variables and ignores empty values", () => {
    expect(
      readWebConfig({
        VITE_OIDC_AUTHORITY: "https://id.example.org/realms/x",
        VITE_OIDC_CLIENT_ID: "",
      }),
    ).toEqual({ oidcAuthority: "https://id.example.org/realms/x", oidcClientId: "cindermed-web" });
  });
});
