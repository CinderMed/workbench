import { MantineProvider } from "@mantine/core";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { type ApiClient, createApiClient } from "./api/client";
import type { AuthClient, SignedInUser } from "./auth";
import { createI18n } from "./i18n";

afterEach(cleanup);

function fakeAuth(overrides: Partial<AuthClient> = {}): AuthClient {
  return {
    isCallback: (url) => url.searchParams.has("code"),
    handleCallback: vi.fn<() => Promise<SignedInUser>>().mockResolvedValue({ name: "Ada Mapper" }),
    getUser: vi.fn<() => Promise<SignedInUser | null>>().mockResolvedValue(null),
    signIn: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    signOut: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    accessToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("token"),
    ...overrides,
  };
}

const noProjects: ApiClient = {
  me: vi.fn(),
  projects: () => Promise.resolve([]),
  importProject: vi.fn(),
  exportProject: vi.fn(),
};

function renderApp(auth: AuthClient, href = "http://localhost:8080/", api: ApiClient = noProjects) {
  const replaceUrl = vi.fn<(url: string) => void>();
  render(
    <I18nextProvider i18n={createI18n()}>
      <MantineProvider>
        <App auth={auth} location={{ href }} replaceUrl={replaceUrl} api={api} />
      </MantineProvider>
    </I18nextProvider>,
  );
  return { replaceUrl };
}

describe("App", () => {
  it("redirects to the Keycloak login when nobody is signed in", async () => {
    const auth = fakeAuth();
    renderApp(auth);
    expect(await screen.findByText("Redirecting to sign in…")).toBeTruthy();
    expect(auth.signIn).toHaveBeenCalledOnce();
  });

  it("shows the signed-in user and signs out", async () => {
    const auth = fakeAuth({ getUser: vi.fn().mockResolvedValue({ name: "Ada Mapper" }) });
    renderApp(auth);
    expect(await screen.findByText("Signed in as Ada Mapper")).toBeTruthy();
    expect(auth.signIn).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it("completes the login callback and removes code and state from the URL", async () => {
    const auth = fakeAuth();
    const { replaceUrl } = renderApp(auth, "http://localhost:8080/?code=abc&state=xyz");
    expect(await screen.findByText("Signed in as Ada Mapper")).toBeTruthy();
    expect(auth.handleCallback).toHaveBeenCalledOnce();
    expect(replaceUrl).toHaveBeenCalledWith("/");
  });

  it("shows the error and retries", async () => {
    const getUser = vi
      .fn<() => Promise<SignedInUser | null>>()
      .mockRejectedValueOnce(new Error("Keycloak unreachable"))
      .mockResolvedValueOnce({ name: "Ada Mapper" });
    renderApp(fakeAuth({ getUser }));
    expect(await screen.findByText("Sign-in failed: Keycloak unreachable")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Signed in as Ada Mapper")).toBeTruthy();
  });

  it("shows the signed-in user's projects", async () => {
    const auth = fakeAuth({ getUser: vi.fn().mockResolvedValue({ name: "Ada Mapper" }) });
    renderApp(auth);
    expect(
      await screen.findByText("You have no projects yet: create one, or import a project file."),
    ).toBeTruthy();
  });

  it("sends the token to the API, and signs in again when the API answers 401", async () => {
    const auth = fakeAuth({ getUser: vi.fn().mockResolvedValue({ name: "Ada Mapper" }) });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({ code: "unauthenticated", status: 401, title: "Authentication required" }),
        {
          status: 401,
          headers: { "content-type": "application/problem+json" },
        },
      ),
    );
    const api = createApiClient(auth.accessToken, {
      fetch,
      onUnauthenticated: () => void auth.signIn(),
    });
    renderApp(auth, "http://localhost:8080/", api);
    expect(await screen.findByText(/The projects could not be loaded/)).toBeTruthy();
    expect(fetch).toHaveBeenCalledWith("/api/projects", expect.objectContaining({ method: "GET" }));
    const init = fetch.mock.calls[0]?.[1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer token");
    expect(auth.signIn).toHaveBeenCalledOnce();
  });
});
