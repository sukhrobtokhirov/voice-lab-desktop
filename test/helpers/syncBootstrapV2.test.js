const test = require("node:test");
const assert = require("node:assert/strict");
const {
  collectSyncBootstrapV2,
  isRestartableBootstrapError,
} = require("../../src/helpers/syncBootstrapV2");

function page({
  version = "v2_snapshot",
  cursor = "incremental-final",
  snapshotCursor = null,
  complete = true,
  dictionary = [],
  preference = [],
}) {
  return {
    snapshot_contract_version: 2,
    snapshot_version: version,
    schema_version: 2,
    consent_version: 4,
    account_id: "account-1",
    device_id: "device-1",
    cursor,
    snapshot_cursor: snapshotCursor,
    snapshot_complete: complete,
    snapshot: { dictionary, preference },
    page: { payload_bytes: 128 },
    enabled: { dictionary: true, preferences: true, transcripts: false, audio: false },
  };
}

test("stages all v2 pages and returns only one complete replacement snapshot", async () => {
  const calls = [];
  const pages = [
    page({
      complete: false,
      snapshotCursor: "snapshot-page-2",
      dictionary: [{ id: "d1" }],
    }),
    page({
      complete: true,
      snapshotCursor: null,
      dictionary: [{ id: "d2" }],
      preference: [{ id: "p1" }],
    }),
  ];
  const result = await collectSyncBootstrapV2(async (cursor) => {
    calls.push(cursor);
    return pages[calls.length - 1];
  });

  assert.deepEqual(calls, [null, "snapshot-page-2"]);
  assert.equal(result.snapshot_complete, true);
  assert.equal(result.snapshot_cursor, null);
  assert.equal(result.cursor, "incremental-final");
  assert.deepEqual(result.snapshot.dictionary.map(({ id }) => id), ["d1", "d2"]);
  assert.deepEqual(result.snapshot.preference.map(({ id }) => id), ["p1"]);
});

test("never returns a partial snapshot", async () => {
  await assert.rejects(
    () => collectSyncBootstrapV2(async () => page({
      complete: false,
      snapshotCursor: null,
      dictionary: [{ id: "partial" }],
    })),
    /missing snapshot_cursor/
  );
});

for (const [status, code] of [
  [409, "SYNC_SNAPSHOT_STALE"],
  [410, "SYNC_SNAPSHOT_EXPIRED"],
  [410, "SYNC_CURSOR_EXPIRED"],
]) {
  test(`discards staged pages and restarts on ${status} ${code}`, async () => {
    const calls = [];
    const error = Object.assign(new Error(code), { status, code });
    const result = await collectSyncBootstrapV2(async (cursor) => {
      calls.push(cursor);
      if (calls.length === 1) {
        return page({
          version: "v2_stale",
          complete: false,
          snapshotCursor: "stale-page",
          dictionary: [{ id: "must-be-discarded" }],
        });
      }
      if (calls.length === 2) throw error;
      return page({
        version: "v2_fresh",
        dictionary: [{ id: "fresh" }],
      });
    });

    assert.deepEqual(calls, [null, "stale-page", null]);
    assert.deepEqual(result.snapshot.dictionary, [{ id: "fresh" }]);
    assert.equal(isRestartableBootstrapError(error), true);
  });
}

test("rejects a changed snapshot_version without touching local state", async () => {
  const pages = [
    page({ version: "v2_a", complete: false, snapshotCursor: "next" }),
    page({ version: "v2_b" }),
  ];
  let index = 0;
  await assert.rejects(
    () => collectSyncBootstrapV2(async () => pages[index++]),
    /metadata changed/
  );
});
