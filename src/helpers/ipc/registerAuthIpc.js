const { BrowserWindow } = require("electron");
const { z } = require("zod");
const { parse } = require("./providerContracts");

const authProviderSchema = z.enum(["google"]).optional();

function registerAuthIpc({ handle, host }) {
  const clearRuntime = async () => {
    const services = [
      host.assemblyAiStreaming,
      host.deepgramStreaming,
      host.cortiStreaming,
      host._dictationStreaming,
    ];
    await Promise.allSettled(
      services.filter(Boolean).map(async (service) => {
        service.clearCachedToken?.();
        await service.disconnect?.(false);
      })
    );
    host._dictationStreaming = null;
    host._dictationConnectPromise = null;
  };

  handle("auth-start-browser", async (_event, provider) => {
    const parsedProvider = parse(authProviderSchema, provider);
    if (!host.desktopAuthManager) {
      return { status: "error", user: null, errorCode: "AUTH_MANAGER_UNAVAILABLE" };
    }
    void parsedProvider;
    return host.desktopAuthManager.startAuthorization();
  });
  handle("auth-get-status", () =>
    host.desktopAuthManager?.getPublicStatus() || {
      status: "error",
      user: null,
      errorCode: "AUTH_MANAGER_UNAVAILABLE",
    }
  );
  handle("auth-get-profile", async () => {
    if (!host.desktopAuthManager || !host.voiceLabApiClient) return null;
    try {
      return await host.voiceLabApiClient.getDesktopProfile();
    } catch {
      // Profile data only enhances the UI. An unavailable avatar must never
      // interrupt a valid desktop session.
      return null;
    }
  });
  handle("auth-reopen-browser", async () =>
    host.desktopAuthManager
      ? host.desktopAuthManager.reopenAuthorization()
      : { status: "error", user: null, errorCode: "AUTH_MANAGER_UNAVAILABLE" }
  );
  handle("auth-cancel-browser", () =>
    host.desktopAuthManager
      ? host.desktopAuthManager.cancelAuthorization()
      : { status: "signed-out", user: null, errorCode: null }
  );
  handle("auth-refresh-session", async () =>
    host.desktopAuthManager
      ? host.desktopAuthManager.refreshSession({ force: true })
      : { status: "signed-out", user: null, errorCode: "AUTH_MANAGER_UNAVAILABLE" }
  );

  const logout = async (event) => {
    host.databaseManager.getDesktopSyncStore().pause();
    const result = host.desktopAuthManager
      ? await host.desktopAuthManager.logout()
      : { success: true, revoked: false };
    await clearRuntime();
    const window = BrowserWindow.fromWebContents(event.sender);
    if (window) await window.webContents.session.clearStorageData({ storages: ["cookies"] });
    return result;
  };
  handle("auth-logout", logout);
  handle("auth-clear-session", logout);
  handle("auth-delete-account", async () => {
    if (!host.desktopAuthManager) throw new Error("Authentication manager unavailable");
    host.databaseManager.getDesktopSyncStore().pause();
    const result = await host.desktopAuthManager.deleteAccount();
    await clearRuntime();
    return result;
  });
}

module.exports = { registerAuthIpc };
