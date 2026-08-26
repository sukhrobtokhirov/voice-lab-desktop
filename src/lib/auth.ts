/** VoiceLab marketing / BFF origin (cookies + social OAuth). */
export const AUTH_URL = import.meta.env.VITE_AUTH_URL || "https://voicelab.uz";

/**
 * Account/session API (JWT login/me/refresh) and VoiceLab Desktop API origin.
 */
export const API_URL =
  (import.meta.env.VITE_AUTH_API_URL as string) ||
  (import.meta.env.VITE_VOICELAB_AUTH_API_URL as string) ||
  "https://api.voicelab.uz";

export type SocialProvider = "google" | "microsoft" | "apple";

export type VoiceLabUser = {
  id: string;
  email: string;
  name: string;
  image?: string | null;
};

function desktopAuthError(error: unknown, fallback: string): Error {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = raw
    .replace(/^Error invoking remote method '[^']+':\s*/i, "")
    .replace(/^DesktopAuthError:\s*/i, "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .trim()
    .slice(0, 500);
  return new Error(message || fallback);
}

/**
 * Starting browser auth is only successful once the main process has either
 * opened the browser or already completed authentication. Treat every other
 * status as a failure so callers never silently wait for a browser that was
 * not launched.
 */
function browserSignInStarted(status: { status?: string } | undefined): boolean {
  return Boolean(
    status &&
      (status.status === "opening-browser" ||
        status.status === "waiting-for-browser" ||
        status.status === "authenticated")
  );
}

function browserSignInError(
  status: { errorCode?: string | null; errorMessage?: string | null } | undefined,
  fallback: string
): Error {
  return new Error(status?.errorMessage || status?.errorCode || fallback);
}

const LAST_SIGN_IN_STORAGE_KEY = "voicelab:lastSignInTime";
const GRACE_PERIOD_MS = 60_000;
const GRACE_RETRY_COUNT = 6;
const INITIAL_GRACE_RETRY_DELAY_MS = 500;
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

function normalizeUser(payload: unknown): VoiceLabUser | null {
  if (!payload || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  const userObj = (raw.user && typeof raw.user === "object" ? raw.user : raw) as Record<
    string,
    unknown
  >;
  const id = String(userObj.id ?? userObj.pk ?? userObj.user_id ?? "");
  const email = String(userObj.email ?? userObj.username ?? "");
  if (!id || id.length > 256 || !email || email.length > 320) return null;
  const name =
    String(userObj.name ?? email)
      .trim()
      .slice(0, 256) || email;
  const image = typeof userObj.image === "string" ? userObj.image : null;
  return {
    id,
    email,
    name,
    image,
  };
}

export async function refreshAccessToken(): Promise<boolean> {
  const status = await window.electronAPI?.authRefreshSession?.();
  return status?.status === "authenticated";
}

export async function fetchSession(): Promise<VoiceLabUser | null> {
  const status = await window.electronAPI?.authGetStatus?.();
  if (status?.status !== "authenticated") {
    cachedUser = null;
    return null;
  }
  cachedUser = normalizeUser(status.user);
  return cachedUser;
}

export async function signInWithPassword(
  email: string,
  password: string
): Promise<{ error?: Error; user?: VoiceLabUser | null }> {
  void email;
  void password;
  const status = await window.electronAPI?.authStartBrowser?.();
  if (!browserSignInStarted(status)) {
    return { error: browserSignInError(status, "Unable to open secure browser sign-in") };
  }
  return { user: null };
}

export async function signUpWithPassword(input: {
  email: string;
  password: string;
  name: string;
}): Promise<{ error?: Error; requiresVerification?: boolean; user?: VoiceLabUser | null }> {
  void input;
  const status = await window.electronAPI?.authStartBrowser?.();
  if (!browserSignInStarted(status)) {
    return { error: browserSignInError(status, "Unable to open secure browser registration") };
  }
  return { requiresVerification: false, user: null };
}

/** Compatibility flag — VoiceLab auth is always “configured” via API_URL defaults. */
export const authClient = { configured: true as const };

export async function deleteAccount(): Promise<{ error?: Error }> {
  try {
    if (!window.electronAPI?.authDeleteAccount) {
      throw new Error("Secure account deletion is unavailable");
    }
    await window.electronAPI.authDeleteAccount();
    return {};
  } catch (error) {
    return { error: error instanceof Error ? error : new Error("Failed to delete account") };
  }
}

export async function signOut(): Promise<void> {
  try {
    await window.electronAPI?.authLogout?.();
  } catch {
    // Main process clears secure state even when backend revocation fails.
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

export async function signInWithSocial(
  provider: SocialProvider
): Promise<{ error?: Error; errorCode?: string | null }> {
  try {
    if (provider !== "google") {
      return {
        error: new Error(
          "Only Google social sign-in is supported in VoiceLab Desktop for now. Use email/password or Google."
        ),
      };
    }

    const status = await window.electronAPI?.authStartBrowser?.("google");
    if (!browserSignInStarted(status)) {
      return {
        error: browserSignInError(status, "Social sign-in failed"),
        errorCode: status?.errorCode || null,
      };
    }
    return {};
  } catch (error) {
    const status = await window.electronAPI?.authGetStatus?.().catch(() => null);
    return {
      error: desktopAuthError(error, "Social sign-in failed"),
      errorCode: status?.errorCode || null,
    };
  }
}

export async function reopenBrowserSignIn(): Promise<{ error?: Error; errorCode?: string | null }> {
  try {
    const status = await window.electronAPI?.authReopenBrowser?.();
    if (!browserSignInStarted(status)) {
      return {
        error: browserSignInError(status, "Unable to reopen browser sign-in"),
        errorCode: status?.errorCode || null,
      };
    }
    return {};
  } catch (error) {
    const status = await window.electronAPI?.authGetStatus?.().catch(() => null);
    return {
      error: desktopAuthError(error, "Unable to reopen browser sign-in"),
      errorCode: status?.errorCode || null,
    };
  }
}

export async function cancelBrowserSignIn(): Promise<void> {
  await window.electronAPI?.authCancelBrowser?.();
}

export async function signInWithSSO(_email: string): Promise<{ error?: Error }> {
  return {
    error: new Error("SSO is not available in VoiceLab Desktop yet. Use Google or email/password."),
  };
}

export async function requestPasswordReset(email: string): Promise<{ error?: Error }> {
  void email;
  try {
    const status = await window.electronAPI?.authStartBrowser?.();
    if (!browserSignInStarted(status)) {
      throw browserSignInError(status, "Unable to open VoiceLab sign-in");
    }
    return {};
  } catch (error) {
    return { error: desktopAuthError(error, "Unable to open VoiceLab sign-in") };
  }
}

export async function resendVerificationEmail(email: string): Promise<{ error?: Error }> {
  void email;
  try {
    const status = await window.electronAPI?.authStartBrowser?.();
    if (!browserSignInStarted(status)) {
      throw browserSignInError(status, "Unable to open VoiceLab sign-in");
    }
    return {};
  } catch (error) {
    return { error: desktopAuthError(error, "Unable to open VoiceLab sign-in") };
  }
}
