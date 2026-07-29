const { z } = require("zod");
const { parse } = require("./providerContracts");

const syncOptionsSchema = z
  .object({
    pull: z.boolean().optional(),
    maxPushBatches: z.number().int().min(1).max(10).optional(),
    bestEffort: z.boolean().optional(),
  })
  .strict()
  .optional();

const preferencesSchema = z.record(z.string().min(1).max(128), z.unknown());

function registerSyncIpc({ handle, host }) {
  handle("desktop-sync-bootstrap", () => host._bootstrapDesktopSync());
  handle("desktop-sync-set-preferences", (_event, preferences) =>
    host.databaseManager
      .getDesktopSyncStore()
      .setPortablePreferences(parse(preferencesSchema, preferences))
  );
  handle("desktop-sync-run", (_event, options) =>
    host._runDesktopSync(parse(syncOptionsSchema, options))
  );
  handle("desktop-sync-pause", () => {
    host.databaseManager.getDesktopSyncStore().pause();
    return { success: true };
  });
}

module.exports = { registerSyncIpc };
