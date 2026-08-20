type SyncReason = "start" | "focus" | "interval" | "online" | "manual";

class SyncService {
  // The current desktop token is scoped to Desktop STT only. Keep the public
  // service surface for existing callers, but do not let renderer lifecycle,
  // storage, or editing events activate the separate sync API.
  canSync(): boolean {
    return false;
  }

  startAutoSync(): void {
    // Intentionally disabled for the Desktop STT-only build.
  }

  requestSyncAll(_reason: SyncReason): void {
    // Intentionally disabled for the Desktop STT-only build.
  }

  async syncAll(_waitForLock = false): Promise<void> {
    // Intentionally disabled for the Desktop STT-only build.
  }

  async syncDictionaryNow(): Promise<void> {
    // Intentionally disabled for the Desktop STT-only build.
  }

  async syncSnippetsNow(): Promise<void> {
    // Snippets remain device-local until the server exposes this collection.
  }

  debouncedPush(_entityType: string, _entityId: number): void {
    // Intentionally disabled for the Desktop STT-only build.
  }
}

export const syncService = new SyncService();
