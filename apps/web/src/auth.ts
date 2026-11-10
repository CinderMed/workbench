import { UserManager, WebStorageStateStore, type User } from "oidc-client-ts";
import type { WebConfig } from "./config";

export interface SignedInUser {
  name: string;
}

/** The part of OIDC the app uses; the real one is backed by oidc-client-ts (code flow with PKCE). */
export interface AuthClient {
  isCallback: (url: URL) => boolean;
  handleCallback: () => Promise<SignedInUser>;
  getUser: () => Promise<SignedInUser | null>;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

export function displayName(user: User): string {
  const claims = user.profile;
  return claims.name ?? claims.preferred_username ?? claims.email ?? claims.sub;
}

export function createAuthClient(config: WebConfig, origin: string): AuthClient {
  const manager = new UserManager({
    authority: config.oidcAuthority,
    client_id: config.oidcClientId,
    redirect_uri: `${origin}/`,
    post_logout_redirect_uri: `${origin}/`,
    response_type: "code",
    scope: "openid profile email",
    userStore: new WebStorageStateStore({ store: window.sessionStorage }),
  });

  return {
    isCallback: (url) => url.searchParams.has("code") && url.searchParams.has("state"),
    handleCallback: async () => {
      const user = await manager.signinRedirectCallback();
      return { name: displayName(user) };
    },
    getUser: async () => {
      const user = await manager.getUser();
      return user && !user.expired ? { name: displayName(user) } : null;
    },
    signIn: () => manager.signinRedirect(),
    signOut: () => manager.signoutRedirect(),
  };
}
