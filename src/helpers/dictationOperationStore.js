const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const STORE_VERSION = 4;
const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

function storePath() {
  return path.join(app.getPath("userData"), "dictation-operations.json");
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if ([1, 2, 3, STORE_VERSION].includes(parsed?.version) && Array.isArray(parsed.operations)) {
      return {
        version: STORE_VERSION,
        operations: parsed.operations.map((operation) => ({
          ...operation,
          logicalOperationId: operation.logicalOperationId || operation.operationId,
          totalDurationSeconds:
            operation.totalDurationSeconds ??
            (Number.isFinite(operation.durationMs) ? operation.durationMs / 1000 : null),
          chunkResults: operation.chunkResults || {},
          serverOperations: operation.serverOperations || {},
        })),
      };
    }
  } catch {}
  return { version: STORE_VERSION, operations: [] };
}

function writeStore(store) {
  const destination = storePath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temp, JSON.stringify({ ...store, version: STORE_VERSION }), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temp, destination);
  try {
    fs.chmodSync(destination, 0o600);
  } catch {}
}

function prune(store) {
  const cutoff = Date.now() - PENDING_TTL_MS;
  store.operations = store.operations.filter(
    (item) => item.status === "pending" && item.updatedAt >= cutoff
  );
}

function begin({ audioHash, source, durationMs, language = null, accountId }) {
  const store = readStore();
  prune(store);
  const existing = store.operations.find(
    (item) =>
      item.status === "pending" &&
      item.accountId === accountId &&
      item.audioHash === audioHash &&
      item.source === source &&
      (item.language || null) === language
  );
  if (existing) return existing;
  const operationId = crypto.randomUUID();
  const operation = {
    operationId,
    logicalOperationId: operationId,
    idempotencyKey: operationId,
    accountId,
    audioHash,
    source,
    language,
    durationMs: Number.isFinite(durationMs) ? durationMs : null,
    totalDurationSeconds: Number.isFinite(durationMs) && durationMs > 0 ? durationMs / 1000 : null,
    serverOperations: {},
    chunkResults: {},
    expectedChunkCount: null,
    status: "pending",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  store.operations.push(operation);
  writeStore(store);
  return operation;
}

function deterministicChunkKey(operation, index) {
  const digest = crypto
    .createHash("sha256")
    .update(`${operation.idempotencyKey}:chunk:${index}`)
    .digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function attachServerOperation(operationId, index, serverOperationId, expectedChunkCount = null) {
  const store = readStore();
  const item = store.operations.find((candidate) => candidate.operationId === operationId);
  if (!item) return;
  item.serverOperations = { ...(item.serverOperations || {}), [String(index)]: serverOperationId };
  if (Number.isInteger(expectedChunkCount) && expectedChunkCount > 0) {
    item.expectedChunkCount = expectedChunkCount;
  }
  item.updatedAt = Date.now();
  writeStore(store);
}

function recordChunkResult(operationId, index, payload) {
  const store = readStore();
  const item = store.operations.find((candidate) => candidate.operationId === operationId);
  if (!item) return;
  item.chunkResults = { ...(item.chunkResults || {}), [String(index)]: payload };
  item.updatedAt = Date.now();
  writeStore(store);
}

function remove(operationId) {
  const store = readStore();
  store.operations = store.operations.filter((item) => item.operationId !== operationId);
  writeStore(store);
}

function retain(operationId) {
  const store = readStore();
  const item = store.operations.find((candidate) => candidate.operationId === operationId);
  if (item) {
    item.updatedAt = Date.now();
    writeStore(store);
  }
}

function get(operationId) {
  const store = readStore();
  prune(store);
  return store.operations.find((item) => item.operationId === operationId) || null;
}

function listPending(accountId) {
  const store = readStore();
  prune(store);
  writeStore(store);
  return store.operations.filter(
    (item) => item.status === "pending" && (!accountId || item.accountId === accountId)
  );
}

module.exports = {
  begin,
  deterministicChunkKey,
  attachServerOperation,
  recordChunkResult,
  remove,
  retain,
  get,
  listPending,
};
