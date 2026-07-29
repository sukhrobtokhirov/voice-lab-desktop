const AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const AUTO_SYNC_THROTTLE_MS = 20_000;
const SYNC_LOCK = "voicelab-desktop-sync-v1";

type SyncReason = "start" | "focus" | "interval" | "online" | "manual";

class SyncService {
  private syncing = false;
  private pending = false;
  private started = false;
  private lastCompletedAt = 0;
  private pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private preferenceTimer: ReturnType<typeof setTimeout> | null = null;

  private localPortablePreferences(): Record<string, unknown> {
    let translationTargets: string[] = [];
    try {
      translationTargets = JSON.parse(localStorage.getItem("translationTargets") || "[]");
    } catch {}
    return {
      preferred_language: localStorage.getItem("preferredLanguage") || "auto",
      ui_language: localStorage.getItem("uiLanguage") || "uz",
      theme: localStorage.getItem("theme") || "auto",
      auto_paste_enabled: localStorage.getItem("autoPasteEnabled") !== "false",
      cleanup_enabled: localStorage.getItem("useCleanupModel") === "true",
      audio_cues_enabled: localStorage.getItem("audioCuesEnabled") !== "false",
      pause_media_on_dictation: localStorage.getItem("pauseMediaOnDictation") === "true",
      translation_targets: Array.isArray(translationTargets) ? translationTargets : [],
    };
  }

  private async applyPortablePreferences(portable: Record<string, unknown>): Promise<void> {
    if (!Object.keys(portable).length) return;
    const storageKeys: Record<string, string> = {
      preferred_language: "preferredLanguage",
      ui_language: "uiLanguage",
      theme: "theme",
      auto_paste_enabled: "autoPasteEnabled",
      cleanup_enabled: "useCleanupModel",
      audio_cues_enabled: "audioCuesEnabled",
      pause_media_on_dictation: "pauseMediaOnDictation",
      translation_targets: "translationTargets",
    };
    for (const [key, value] of Object.entries(portable)) {
      const storageKey = storageKeys[key];
      if (!storageKey) continue;
      localStorage.setItem(
        storageKey,
        key === "translation_targets" ? JSON.stringify(value) : String(value)
      );
    }
    const { useSettingsStore } = await import("../stores/settingsStore.js");
    useSettingsStore.setState({
      preferredLanguage: String(portable.preferred_language ?? "auto"),
      uiLanguage: String(portable.ui_language ?? "uz"),
      theme: (portable.theme ?? "auto") as "light" | "dark" | "auto",
      autoPasteEnabled: portable.auto_paste_enabled !== false,
      useCleanupModel: portable.cleanup_enabled === true,
      audioCuesEnabled: portable.audio_cues_enabled !== false,
      pauseMediaOnDictation: portable.pause_media_on_dictation === true,
      translationTargets: Array.isArray(portable.translation_targets)
        ? (portable.translation_targets as string[])
        : [],
    });
  }

  canSync(): boolean {
    return (
      typeof window !== "undefined" &&
      localStorage.getItem("isSignedIn") === "true" &&
      Boolean(window.electronAPI?.desktopSyncRun)
    );
  }

  startAutoSync(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;
    this.requestSyncAll("start");
    window.addEventListener("focus", () => this.requestSyncAll("focus"));
    window.addEventListener("online", () => this.requestSyncAll("online"));
    window.addEventListener("voicelab-portable-preference-changed", () => {
      if (this.preferenceTimer) clearTimeout(this.preferenceTimer);
      this.preferenceTimer = setTimeout(() => {
        this.preferenceTimer = null;
        if (!this.canSync()) return;
        void window.electronAPI
          .desktopSyncSetPreferences?.(this.localPortablePreferences())
          .then(() => this.syncAll(false));
      }, 500);
    });
    window.addEventListener("storage", (event) => {
      if (event.key !== "isSignedIn") return;
      if (event.newValue === "true") this.requestSyncAll("start");
      else void window.electronAPI?.desktopSyncPause?.();
    });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") this.requestSyncAll("focus");
    });
    setInterval(() => this.requestSyncAll("interval"), AUTO_SYNC_INTERVAL_MS);
  }

  requestSyncAll(reason: SyncReason): void {
    if (!this.canSync()) return;
    if (
      reason !== "manual" &&
      (this.syncing || Date.now() - this.lastCompletedAt < AUTO_SYNC_THROTTLE_MS)
    ) {
      return;
    }
    void this.syncAll(reason === "manual");
  }

  async syncAll(waitForLock = false): Promise<void> {
    if (!this.canSync()) return;
    if (this.syncing) {
      this.pending = true;
      return;
    }
    this.syncing = true;
    try {
      const run = async () => {
        let result = await window.electronAPI.desktopSyncRun?.({
          pull: true,
          maxPushBatches: 5,
        });
        if (result?.state) {
          const portable = result.state.portablePreferences || {};
          if (Object.keys(portable).length) {
            await this.applyPortablePreferences(portable);
          } else {
            await window.electronAPI.desktopSyncSetPreferences?.(
              this.localPortablePreferences()
            );
            result = await window.electronAPI.desktopSyncRun?.({
              pull: false,
              maxPushBatches: 2,
            });
          }
          window.dispatchEvent(
            new CustomEvent("voicelab-dictionary-state", { detail: result.state })
          );
        }
        this.lastCompletedAt = Date.now();
      };
      if (navigator.locks?.request) {
        await navigator.locks.request(
          SYNC_LOCK,
          { ifAvailable: !waitForLock },
          async (lock) => {
            if (lock) await run();
          }
        );
      } else {
        await run();
      }
    } catch (error) {
      console.warn("VoiceLab desktop sync failed", error);
    } finally {
      this.syncing = false;
    }
    if (this.pending) {
      this.pending = false;
      await this.syncAll(false);
    }
  }

  async syncDictionaryNow(): Promise<void> {
    await this.syncAll(true);
  }

  async syncSnippetsNow(): Promise<void> {
    // Snippets remain device-local until the server exposes this collection.
  }

  debouncedPush(entityType: string, entityId: number): void {
    if (entityType !== "dictionary" || !this.canSync()) return;
    const key = `${entityType}:${entityId}`;
    const current = this.pushTimers.get(key);
    if (current) clearTimeout(current);
    this.pushTimers.set(
      key,
      setTimeout(() => {
        this.pushTimers.delete(key);
        void this.syncDictionaryNow();
      }, 750)
    );
  }
}

export const syncService = new SyncService();
