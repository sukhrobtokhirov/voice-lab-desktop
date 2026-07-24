import { openExternalLink } from "../utils/externalLinks";

/** VoiceLab marketing / BFF origin (cookies + social OAuth). */
export const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://voicelab.uz";

/**
 * Account/session API (JWT login/me/refresh).
 * Separate from Aisha STT base (`back.aisha.group` + X-Api-Key).
 */
export const API_URL =
  (import.meta.env.VITE_AUTH_API_URL as string) ||
  (import.meta.env.VITE_VOICELAB_AUTH_API_URL as string) ||
  "https://api.voicelab.uz";

export type SocialProvider = "google" | "microsoft" | "apple";

export type VoiceLabUser = {
  id: string;
  email: string;
  name?: string;
  image?: string | null;
  [key: string]: unknown;
};

const LAST_SIGN_IN_STORAGE_KEY = "voicelab:lastSignInTime";
const GRACE_PERIOD_MS = 60_000;
const GRACE_RETRY_COUNT = 6;
const INITIAL_GRACE_RETRY_DELAY_MS = 500;
const DESKTOP_OAUTH_CALLBACK_PATH = "/auth/desktop-callback";

let lastSignInTime: number | null = null;
let cachedUser: VoiceLabUser | null = null;

function getLocalStorageSafe(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function loadLastSignInTimeFromStorage(): number | null {
  const storage = getLocalStorageSafe();
  if (!storage) return null;
  const raw = storage.getItem(LAST_SIGN_IN_STORAGE_KEY);
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    storage.removeItem(LAST_SIGN_IN_STORAGE_KEY);
    return null;
  }
  return parsed;
}

function persistLastSignInTime(value: number | null): void {
  const storage = getLocalStorageSafe();
  if (!storage) return;
  if (value === null) storage.removeItem(LAST_SIGN_IN_STORAGE_KEY);
  else storage.setItem(LAST_SIGN_IN_STORAGE_KEY, String(value));
}

function getLastSignInTime(): number | null {
  const stored = loadLastSignInTimeFromStorage();
  if (stored !== null) lastSignInTime = stored;
  return lastSignInTime;
}

function createAuthExpiredError(originalError: unknown): Error {
  const error = originalError instanceof Error ? originalError : new Error("Session expired");
  Object.assign(error, {
    code: "AUTH_EXPIRED",
    messageKey: "hooks.audioRecording.errorDescriptions.sessionExpired",
  });
  return error;
}

function clearLastSignInTime(): void {
  lastSignInTime = null;
  persistLastSignInTime(null);
}

function markSignedOutState(): void {
  const storage = getLocalStorageSafe();
  storage?.setItem("isSignedIn", "false");
  clearLastSignInTime();
  cachedUser = null;
}

export function updateLastSignInTime(): void {
  const now = Date.now();
  lastSignInTime = now;
  persistLastSignInTime(now);
}

export function isWithinGracePeriod(): boolean {
  const startedAt = getLastSignInTime();
  if (!startedAt) return false;
  return Math.max(0, Date.now() - startedAt) < GRACE_PERIOD_MS;
}

export function getCachedUser(): VoiceLabUser | null {
  return cachedUser;
}

function extractTokens(payload: Record<string, unknown>) {
  const access =
    (payload.access_token as string) ||
    (payload.access as string) ||
    (payload.accessToken as string) ||
    "";
  const refresh =
    (payload.refresh_token as string) ||
    (payload.refresh as string) ||
    (payload.refreshToken as string) ||
    "";
  return { access, refresh };
}

function normalizeUser(payload: unknown): VoiceLabUser | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const userObj = (raw.user && typeof raw.user === "object" ? raw.user : raw) as Record<
    string,
    unknown
  >;
  const id = String(userObj.id ?? userObj.pk ?? userObj.user_id ?? "");
  const email = String(userObj.email ?? userObj.username ?? "");
  if (!id && !email) return null;
  return {
    ...userObj,
    id: id || email,
    email,
    name: String(userObj.full_name ?? userObj.name ?? userObj.username ?? email),
    image: (userObj.avatar as string) || (userObj.image as string) || null,
  };
}

async function persistSession(access: string, refresh?: string) {
  if (!access) return;
  const payload = JSON.stringify({ access, refresh: refresh || "" });
  await window.electronAPI?.authSetToken?.(payload);
}

async function apiFetch(path: string, init: RequestInit = {}, accessToken?: string) {
  const headers = new Headers(init.headers || {});
  if (!headers.has("Content-Type") && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  headers.set("x-voicelab-source", "desktop");
  const token = accessToken ?? (await window.electronAPI?.authGetToken?.()) ?? "";
  if (token) headers.set("Authorization", `Bearer ${token}`);

  const response = await fetch(`${API_URL.replace(/\/+$/, "")}${path}`, {
    ...init,
    headers,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data: data as Record<string, unknown> };
}

export async function refreshAccessToken(): Promise<boolean> {
  const raw = await window.electronAPI?.authGetToken?.();
  if (!raw) return false;

  let refresh = "";
  try {
    const parsed = JSON.parse(raw);
    refresh = parsed?.refresh || parsed?.refresh_token || "";
  } catch {
    return false;
  }
  if (!refresh) return false;

  const { response, data } = await apiFetch(
    "/api/auth/token/refresh/",
    {
      method: "POST",
      body: JSON.stringify({ refresh, refresh_token: refresh }),
    },
    ""
  );

  if (!response.ok) return false;
  const tokens = extractTokens(data);
  if (!tokens.access) return false;
  await persistSession(tokens.access, tokens.refresh || refresh);
  return true;
}

export async function fetchSession(): Promise<VoiceLabUser | null> {
  const token = await window.electronAPI?.authGetToken?.();
  if (!token) {
    cachedUser = null;
    return null;
  }

  let { response, data } = await apiFetch("/api/auth/me/");
  if (response.status === 401) {
    const refreshed = await refreshAccessToken();
    if (!refreshed) {
      cachedUser = null;
      return null;
    }
    ({ response, data } = await apiFetch("/api/auth/me/"));
  }

  if (!response.ok) {
    cachedUser = null;
    return null;
  }

  cachedUser = normalizeUser(data);
  return cachedUser;
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ error?: Error; user?: VoiceLabUser | null }> {
  const identity = email.trim();
  const { response, data } = await apiFetch(
    "/api/auth/login/",
    {
      method: "POST",
      body: JSON.stringify({
        username_or_email: identity,
        email: identity.includes("@") ? identity : undefined,
        username: identity.includes("@") ? undefined : identity,
        password,
      }),
    },
    ""
  );

  if (!response.ok) {
    return {
      error: new Error(
        String(data.error || data.detail || data.message || "Invalid credentials")
      ),
    };
  }

  const tokens = extractTokens(data);
  if (!tokens.access) {
    return { error: new Error("Login succeeded but no access token was returned") };
  }

  await persistSession(tokens.access, tokens.refresh);
  updateLastSignInTime();
  const user = (await fetchSession()) || normalizeUser(data);
  return { user };
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ error?: Error; requiresVerification?: boolean; user?: VoiceLabUser | null }> {
  const identity = input.email.trim();
  const { response, data } = await apiFetch(
    "/api/auth/register/",
    {
      method: "POST",
      body: JSON.stringify({
        username_or_email: identity,
        email: identity,
        full_name: input.name,
        name: input.name,
        password: input.password,
      }),
    },
    ""
  );

  if (!response.ok) {
    return {
      error: new Error(
        String(data.error || data.detail || data.message || "Failed to create account")
      ),
    };
  }

  const tokens = extractTokens(data);
  const requiresVerification = Boolean(data.requiresVerification || data.requires_verification);

  if (tokens.access) {
    await persistSession(tokens.access, tokens.refresh);
    updateLastSignInTime();
    const user = await fetchSession();
    return { user, requiresVerification };
  }

  return { requiresVerification: requiresVerification || true };
}

/** Compatibility flag — VoiceLab auth is always “configured” via API_URL defaults. */
export const authClient = { configured: true as const };

export async function deleteAccount(): Promise<{ error?: Error }> {
  try {
    const { response, data } = await apiFetch("/api/auth/delete-account/", { method: "DELETE" });
    if (!response.ok) {
      throw new Error(String(data.error || "Failed to delete account"));
    }
    await signOut();
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Failed to delete account") };
  }
}

export async function signOut(): Promise<void> {
  try {
    await apiFetch("/api/auth/logout/", { method: "POST" }).catch(() => null);
    await fetch(`${AUTH_URL.replace(/\/+$/, "")}/api/auth/logout`, { method: "POST" }).catch(
      () => null
    );
  } catch {
    // ignore
  }
  try {
    await window.electronAPI?.authClearSession?.();
  } catch {
    // ignore
  }
  markSignedOutState();
}

export async function withSessionRefresh<T>(operation: () => Promise<T>): Promise<T> {
  const startedInGracePeriod = isWithinGracePeriod();
  let graceRetriesUsed = 0;

  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const isAuthExpired =
        error?.code === "AUTH_EXPIRED" ||
        error?.message?.toLowerCase().includes("session expired") ||
        error?.message?.toLowerCase().includes("auth expired");

      if (!isAuthExpired) throw error;

      const refreshed = await refreshAccessToken();
      if (refreshed) {
        try {
          return await operation();
        } catch (retryError) {
          error = retryError;
        }
      }

      if (startedInGracePeriod && graceRetriesUsed < GRACE_RETRY_COUNT) {
        const delayMs = INITIAL_GRACE_RETRY_DELAY_MS * Math.pow(2, graceRetriesUsed);
        graceRetriesUsed += 1;
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw createAuthExpiredError(error);
    }
  }
}

export async function signInWithSocial(provider: SocialProvider): Promise<{ error?: Error }> {
  try {
    if (provider !== "google") {
      return {
        error: new Error(
          "Only Google social sign-in is supported in VoiceLab Desktop for now. Use email/password or Google."
        ),
      };
    }

    const protocol = (await window.electronAPI?.getOAuthProtocol?.()) || "voicelab";
    const next = `${DESKTOP_OAUTH_CALLBACK_PATH}?protocol=${encodeURIComponent(protocol)}`;
    const url = new URL(`${AUTH_URL.replace(/\/+$/, "")}/api/auth/social/google`);
    url.searchParams.set("next", next);
    openExternalLink(url.toString());
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Social sign-in failed") };
  }
}

export async function signInWithSSO(_email: string): Promise<{ error?: Error }> {
  return {
    error: new Error("SSO is not available in VoiceLab Desktop yet. Use Google or email/password."),
  };
}

export async function requestPasswordReset(email: string): Promise<{ error?: Error }> {
  try {
    const response = await fetch(`${AUTH_URL.replace(/\/+$/, "")}/api/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim() }),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to send reset email");
    }
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Failed to send reset email") };
  }
}

export async function resendVerificationEmail(email: string): Promise<{ error?: Error }> {
  try {
    const response = await fetch(
      `${AUTH_URL.replace(/\/+$/, "")}/api/auth/resend-verification-code`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      }
    );
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || "Failed to resend verification");
    }
    return {};
  } catch (error) {
    return {
      error: error instanceof Error ? error : new Error("Failed to resend verification"),
    };
  }
}
