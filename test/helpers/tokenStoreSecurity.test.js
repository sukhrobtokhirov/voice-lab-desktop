const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("node:module");

const tokenStorePath = require.resolve("../../src/helpers/tokenStore");
const originalLoad = Module._load;
const MAGIC = Buffer.from("VLAB-AUTH\0V2\0", "utf8");

function loadTokenStore(userData) {
  delete require.cache[tokenStorePath];
  const cryptoProvider = {
    isAvailable: () => true,
    encrypt: (value) => Buffer.from(`ENC:${value}`, "utf8"),
    decrypt: (value) => {
      const raw = value.toString("utf8");
      if (!raw.startsWith("ENC:")) throw new Error("invalid encrypted fixture");
      return { value: raw.slice(4), needsReencrypt: false };
    },
  };
  Module._load = function mockedLoad(request, parent, isMain) {
    if (request === "electron") return { app: { getPath: () => userData } };
    if (request === "./secretCrypto") return cryptoProvider;
    return originalLoad.call(this, request, parent, isMain);
  };
  try {
    return require("../../src/helpers/tokenStore");
  } finally {
    Module._load = originalLoad;
  }
}

test("writes credentials only in the strict V2 magic envelope", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    const store = loadTokenStore(dir);
    store.saveSession({ accessToken: "access", refreshToken: "refresh" });
    const encoded = fs.readFileSync(path.join(dir, "auth-token.bin"));
    assert.equal(encoded.subarray(0, MAGIC.length).equals(MAGIC), true);
    assert.doesNotMatch(encoded.toString("utf8"), /^access$/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("migrates one legacy encrypted store once and records the migration", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    fs.writeFileSync(
      path.join(dir, "auth-token.bin"),
      `ENC:${JSON.stringify({ version: 1, access_token: "legacy-access" })}`,
      { mode: 0o600 }
    );
    const store = loadTokenStore(dir);
    assert.equal(store.getSession().accessToken, "legacy-access");
    assert.equal(fs.existsSync(path.join(dir, ".auth-token-legacy-migrated")), true);
    assert.equal(
      fs.readFileSync(path.join(dir, "auth-token.bin")).subarray(0, MAGIC.length).equals(MAGIC),
      true
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("rejects plaintext, unknown versions, and repeated magicless migration", () => {
  for (const fixture of [
    JSON.stringify({ access_token: "plaintext" }),
    `ENC:${JSON.stringify({ version: 99, access_token: "unknown" })}`,
  ]) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
    try {
      fs.writeFileSync(path.join(dir, "auth-token.bin"), fixture, { mode: 0o600 });
      const store = loadTokenStore(dir);
      assert.equal(store.getSession(), null);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-token-"));
  try {
    fs.writeFileSync(path.join(dir, ".auth-token-legacy-migrated"), "done");
    fs.writeFileSync(
      path.join(dir, "auth-token.bin"),
      `ENC:${JSON.stringify({ version: 1, access_token: "replayed" })}`
    );
    assert.equal(loadTokenStore(dir).getSession(), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
