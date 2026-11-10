import type { User } from "oidc-client-ts";
import { describe, expect, it, vi } from "vitest";

const manager = {
  signinRedirectCallback: vi.fn(),
  getUser: vi.fn(),
  signinRedirect: vi.fn(),
  signoutRedirect: vi.fn(),
};
const settings: unknown[] = [];

vi.mock("oidc-client-ts", () => ({
  UserManager: vi.fn(function (this: unknown, options: unknown) {
    settings.push(options);
    return manager;
  }),
  WebStorageStateStore: vi.fn(),
}));

const { createAuthClient, displayName } = await import("./auth");
const config = { oidcAuthority: "http://kc/realms/cindermed", oidcClientId: "cindermed-web" };

const user = (profile: Record<string, string>, expired = false) =>
  ({ profile: { sub: "s-1", ...profile }, expired }) as unknown as User;

describe("createAuthClient", () => {
  const auth = createAuthClient(config, "http://localhost:8080");

  it("uses the authorization code flow with the app origin as redirect", () => {
    expect(settings[0]).toMatchObject({
      authority: "http://kc/realms/cindermed",
      client_id: "cindermed-web",
      redirect_uri: "http://localhost:8080/",
      post_logout_redirect_uri: "http://localhost:8080/",
      response_type: "code",
    });
  });

  it("recognises the login callback", () => {
    expect(auth.isCallback(new URL("http://localhost:8080/?code=a&state=b"))).toBe(true);
    expect(auth.isCallback(new URL("http://localhost:8080/?code=a"))).toBe(false);
  });

  it("returns the signed-in user, or null when missing or expired", async () => {
    manager.getUser.mockResolvedValueOnce(user({ name: "Ada" }));
    expect(await auth.getUser()).toEqual({ name: "Ada" });
    manager.getUser.mockResolvedValueOnce(user({ name: "Ada" }, true));
    expect(await auth.getUser()).toBeNull();
    manager.getUser.mockResolvedValueOnce(null);
    expect(await auth.getUser()).toBeNull();
  });

  it("completes the callback and delegates sign-in and sign-out", async () => {
    manager.signinRedirectCallback.mockResolvedValueOnce(user({ preferred_username: "mapper" }));
    expect(await auth.handleCallback()).toEqual({ name: "mapper" });
    await auth.signIn();
    await auth.signOut();
    expect(manager.signinRedirect).toHaveBeenCalledOnce();
    expect(manager.signoutRedirect).toHaveBeenCalledOnce();
  });
});

describe("displayName", () => {
  it("prefers name, then username, then email, then subject", () => {
    expect(displayName(user({ name: "Ada", preferred_username: "a" }))).toBe("Ada");
    expect(displayName(user({ preferred_username: "a", email: "a@x" }))).toBe("a");
    expect(displayName(user({ email: "a@example.org" }))).toBe("a@example.org");
    expect(displayName(user({}))).toBe("s-1");
  });
});
