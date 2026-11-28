/**
 * The API client of the signed-in app (module 4): every call carries the access token, and an
 * RFC 9457 problem becomes an `ApiError` with its code, so screens can say what went wrong. The
 * API is on the same origin (`/api`, the web proxy in Docker Compose and Vite's in development).
 */
import type { ValidationResult } from "@cindermed/model";

export interface Problem {
  readonly code: string;
  readonly status: number;
  readonly title: string;
  readonly detail?: string;
  readonly results?: readonly ValidationResult[];
}

export class ApiError extends Error {
  constructor(readonly problem: Problem) {
    super(problem.detail ?? problem.title);
  }
  get status(): number {
    return this.problem.status;
  }
}

export type Role = "owner" | "mapper" | "reviewer" | "engineer" | "viewer";

export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly fhirVersion: string;
  readonly role: Role;
}

export interface Me {
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
  readonly projects: readonly { readonly id: string; readonly name: string; readonly role: Role }[];
}

export interface ApiClient {
  readonly me: () => Promise<Me>;
  readonly projects: () => Promise<ProjectSummary[]>;
  /** A new project from a project file (H3, any JSON: the server checks it); it may get another id. */
  readonly importProject: (file: unknown) => Promise<{ id: string }>;
  /** The project file, as text (H3 export). */
  readonly exportProject: (id: string) => Promise<string>;
}

/** The access token of the signed-in user, or null to sign in again. */
export type TokenSource = () => Promise<string | null>;

async function problemOf(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Partial<Problem>;
    if (typeof body.code === "string")
      return new ApiError({
        code: body.code,
        status: response.status,
        title: body.title ?? response.statusText,
        ...(body.detail === undefined ? {} : { detail: body.detail }),
        ...(body.results === undefined ? {} : { results: body.results }),
      });
  } catch {
    // Not a problem document: described by its status below.
  }
  return new ApiError({ code: "http", status: response.status, title: response.statusText });
}

export interface ApiOptions {
  /** Called when the API says the session is over (401): typically, sign in again. */
  readonly onUnauthenticated?: () => void;
  readonly fetch?: typeof fetch;
}

export function createApiClient(token: TokenSource, options: ApiOptions = {}): ApiClient {
  const fetcher = options.fetch ?? fetch;
  const call = async (method: string, path: string, body?: unknown): Promise<Response> => {
    const access = await token();
    if (access === null) {
      options.onUnauthenticated?.();
      throw new ApiError({ code: "unauthenticated", status: 401, title: "Sign in again" });
    }
    const response = await fetcher(`/api${path}`, {
      method,
      headers: {
        authorization: `Bearer ${access}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401) options.onUnauthenticated?.();
    if (!response.ok) throw await problemOf(response);
    return response;
  };
  const json = async <T>(method: string, path: string, body?: unknown): Promise<T> =>
    (await call(method, path, body)).json() as Promise<T>;
  return {
    me: () => json<Me>("GET", "/me"),
    projects: () => json<ProjectSummary[]>("GET", "/projects"),
    importProject: (file) => json<{ id: string }>("POST", "/projects:import", file),
    exportProject: async (id) =>
      (
        await call("POST", `/projects/${encodeURIComponent(id)}/exports`, { format: "json" })
      ).text(),
  };
}
