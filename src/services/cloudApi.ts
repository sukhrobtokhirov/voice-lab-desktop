interface CloudApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
  status?: number;
}

export class CloudApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "CloudApiError";
    this.status = status;
    this.code = code;
  }
}

type WorkspaceApiMethod = "GET" | "POST" | "PATCH" | "DELETE";

async function cloudRequest<T = unknown>(
  method: WorkspaceApiMethod,
  path: string,
  body?: unknown
): Promise<T> {
  if (
    ["/api/dictionary/", "/api/snippets/", "/api/notes/", "/api/transcriptions/"].some(
      (prefix) => path.startsWith(prefix)
    )
  ) {
    throw new CloudApiError(
      "Legacy cloud sync is disabled. Use the account-scoped desktop sync contract.",
      410,
      "LEGACY_SYNC_DISABLED"
    );
  }
  const result = (await window.electronAPI?.workspaceApiRequest?.({
    method,
    path,
    body,
  })) as CloudApiResponse<T> | undefined;

  if (!result?.success) {
    throw new CloudApiError(
      result?.error ?? "Cloud API request failed",
      result?.status ?? 0,
      result?.code
    );
  }

  return result.data as T;
}

export async function cloudGet<T = unknown>(path: string): Promise<T> {
  return cloudRequest<T>("GET", path);
}

export async function cloudPost<T = unknown>(path: string, body?: unknown): Promise<T> {
  return cloudRequest<T>("POST", path, body);
}

export async function cloudPatch<T = unknown>(path: string, body?: unknown): Promise<T> {
  return cloudRequest<T>("PATCH", path, body);
}

export async function cloudDelete<T = unknown>(path: string, body?: unknown): Promise<T> {
  return cloudRequest<T>("DELETE", path, body);
}
