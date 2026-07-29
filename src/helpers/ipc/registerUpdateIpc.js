function registerUpdateIpc({
  handle,
  updateManager,
  postMigrationDetector,
  getProtocolState,
}) {
  handle("check-for-updates", () => updateManager.checkForUpdates());
  handle("download-update", () => updateManager.downloadUpdate());
  handle("install-update", () => updateManager.installUpdate());
  handle("get-app-version", () => updateManager.getAppVersion());
  handle("get-update-status", () => updateManager.getUpdateStatus());
  handle("get-update-info", () => updateManager.getUpdateInfo());
  handle("get-post-migration-state", () => ({
    justMigrated: postMigrationDetector.isReturningFromOldBundle(),
  }));
  handle("get-oauth-protocol-registered", () => getProtocolState().registered);
  handle("get-oauth-protocol", () => getProtocolState().protocol);
  handle("mark-bundle-migrated", () => postMigrationDetector.markBundleMigrated());
  handle("mark-bundle-migration-dismissed", () =>
    postMigrationDetector.markBundleMigrationDismissed()
  );
}

module.exports = { registerUpdateIpc };
