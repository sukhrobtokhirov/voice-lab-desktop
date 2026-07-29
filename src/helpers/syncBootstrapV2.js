const RESTARTABLE_BOOTSTRAP_CODES = new Set([
  "SYNC_SNAPSHOT_STALE",
  "SYNC_SNAPSHOT_EXPIRED",
  "SYNC_CURSOR_EXPIRED",
]);

const DEFAULT_MAX_PAGES = 10_000;
const DEFAULT_MAX_PAYLOAD_BYTES = 128 * 1024 * 1024;

function serverErrorCode(error) {
  return String(
    error?.details?.code
      || error?.details?.error_code
      || error?.serverCode
      || error?.code
      || ""
  ).toUpperCase();
}

function isRestartableBootstrapError(error) {
  const code = serverErrorCode(error);
  return (
    RESTARTABLE_BOOTSTRAP_CODES.has(code)
    && (Number(error?.status) === 409 || Number(error?.status) === 410)
  );
}

function assertString(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`Sync bootstrap is missing ${name}`);
  return normalized;
}

function pagePayloadBytes(page) {
  const declared = Number(page?.page?.payload_bytes);
  if (Number.isSafeInteger(declared) && declared >= 0) return declared;
  return Buffer.byteLength(JSON.stringify(page?.snapshot || {}), "utf8");
}

class BootstrapSnapshotStage {
  constructor(firstPage, { maxPages, maxPayloadBytes }) {
    if (Number(firstPage?.snapshot_contract_version) !== 2) {
      throw new Error("Unsupported sync snapshot contract");
    }
    this.snapshotVersion = assertString(firstPage.snapshot_version, "snapshot_version");
    this.accountId = assertString(firstPage.account_id, "account_id");
    this.deviceId = assertString(firstPage.device_id, "device_id");
    this.schemaVersion = Number(firstPage.schema_version);
    this.consentVersion = Number(firstPage.consent_version);
    this.maxPages = maxPages;
    this.maxPayloadBytes = maxPayloadBytes;
    this.pages = 0;
    this.payloadBytes = 0;
    this.snapshot = {};
    this.firstPage = firstPage;
    this.lastPage = null;
  }

  add(page) {
    if (
      String(page?.snapshot_version || "") !== this.snapshotVersion
      || String(page?.account_id || "") !== this.accountId
      || String(page?.device_id || "") !== this.deviceId
      || Number(page?.schema_version) !== this.schemaVersion
      || Number(page?.consent_version) !== this.consentVersion
    ) {
      throw new Error("Sync bootstrap page metadata changed during snapshot");
    }

    this.pages += 1;
    this.payloadBytes += pagePayloadBytes(page);
    if (this.pages > this.maxPages || this.payloadBytes > this.maxPayloadBytes) {
      throw new Error("Sync bootstrap snapshot exceeds local staging limits");
    }

    const pageSnapshot = page.snapshot && typeof page.snapshot === "object"
      ? page.snapshot
      : {};
    for (const [collection, records] of Object.entries(pageSnapshot)) {
      if (!Array.isArray(records)) {
        throw new Error(`Sync bootstrap collection ${collection} is invalid`);
      }
      const staged = this.snapshot[collection] || [];
      staged.push(...records);
      this.snapshot[collection] = staged;
    }

    const complete = page.snapshot_complete === true;
    if (!complete && !String(page.snapshot_cursor || "").trim()) {
      throw new Error("Partial sync bootstrap page is missing snapshot_cursor");
    }
    if (complete && page.snapshot_cursor) {
      throw new Error("Complete sync bootstrap page must not include snapshot_cursor");
    }
    this.lastPage = page;
    return complete;
  }

  finalize() {
    if (!this.lastPage?.snapshot_complete) {
      throw new Error("Cannot commit an incomplete sync bootstrap snapshot");
    }
    return {
      ...this.firstPage,
      ...this.lastPage,
      snapshot: this.snapshot,
      snapshot_cursor: null,
      snapshot_complete: true,
      cursor: this.lastPage.cursor,
    };
  }
}

async function collectSyncBootstrapV2(
  fetchPage,
  {
    assertContext = () => {},
    maxRestarts = 2,
    maxPages = DEFAULT_MAX_PAGES,
    maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES,
  } = {}
) {
  let restartCount = 0;

  for (;;) {
    let stage = null;
    let snapshotCursor = null;
    try {
      for (;;) {
        const page = await fetchPage(snapshotCursor);
        assertContext(page);
        if (!stage) {
          stage = new BootstrapSnapshotStage(page, { maxPages, maxPayloadBytes });
        }
        const complete = stage.add(page);
        if (complete) return stage.finalize();
        snapshotCursor = page.snapshot_cursor;
      }
    } catch (error) {
      stage = null;
      snapshotCursor = null;
      if (!isRestartableBootstrapError(error) || restartCount >= maxRestarts) {
        throw error;
      }
      restartCount += 1;
    }
  }
}

module.exports = {
  BootstrapSnapshotStage,
  collectSyncBootstrapV2,
  isRestartableBootstrapError,
  serverErrorCode,
};
