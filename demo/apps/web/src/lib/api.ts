import type { ErrorBody, ErrorCode } from "@authz-demo/authz-types";

// Mọi request đi cùng origin qua /api (Vite proxy sang API); phiên là cookie httpOnly, JS không cầm token.
export type AppErrorCode = ErrorCode | "network";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: AppErrorCode,
    readonly correlationId: string | null,
    readonly details?: ErrorBody["details"],
  ) {
    super(code);
  }
}

export const isApiError = (error: unknown, code?: AppErrorCode): error is ApiError =>
  error instanceof ApiError && (code === undefined || error.code === code);

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      credentials: "same-origin",
      ...init,
      headers: { Accept: "application/json", ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError(0, "network", null);
  }
  if (response.status === 204) return undefined as T;
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as Partial<ErrorBody> | null;
    const code = body?.error ?? (response.status === 401 ? "unauthenticated" : "internal_error");
    throw new ApiError(response.status, code, body?.correlationId ?? response.headers.get("X-Correlation-Id"), body?.details);
  }
  return (await response.json()) as T;
}
