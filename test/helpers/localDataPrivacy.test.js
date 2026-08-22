const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { randomBytes } = require("node:crypto");
const { DatabaseSync } = require("node:sqlite");
const Module = require("node:module");

const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  if (request === "electron") {
    return {
      app: {
        getPath: (name) =>
          name === "temp" ? os.tmpdir() : path.join(os.tmpdir(), "voicelab-privacy-test"),
      },
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const {
  LocalDataCorruptionError,
  LocalDataCrypto,
} = require("../../src/helpers/localDataCrypto");
const {
  LocalDataProtection,
  normalizeDictionaryValue,
} = require("../../src/helpers/localDataProtection");
const AudioStorageManager = require("../../src/helpers/audioStorage");
const DatabaseManager = require("../../src/helpers/database");
const DesktopSyncStore = require("../../src/helpers/desktopSyncStore");
Module._load = originalLoad;

function registry(key = randomBytes(32), indexKey = randomBytes(32), current = 1) {
  return {
    format: 1,
    current,
    keys: { [current]: key.toString("base64") },
    index_key: indexKey.toString("base64"),
    created_at: "2026-07-30T00:00:00.000Z",
  };
}

function cryptoService(material = registry()) {
  return new LocalDataCrypto({
    registry: material,
    persist: false,
    userDataPath: os.tmpdir(),
  });
}

function sqliteAdapter(database) {
  return {
    prepare: (sql) => database.prepare(sql),
    exec: (sql) => database.exec(sql),
    pragma: (statement, options = {}) => {
      const value = database.prepare(`PRAGMA ${statement}`).get();
      if (options.simple && value) return Object.values(value)[0];
      return value;
    },
    transaction: (callback) => (...args) => {
      database.exec("BEGIN IMMEDIATE");
      try {
        const result = callback(...args);
        database.exec("COMMIT");
        return result;
      } catch (error) {
        database.exec("ROLLBACK");
        throw error;
      }
    },
  };
}

function createLegacyDatabase() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE transcriptions (
      id INTEGER PRIMARY KEY,
      client_transcription_id TEXT,
      text TEXT NOT NULL,
      raw_text TEXT,
      error_message TEXT
    );
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY,
      client_note_id TEXT,
      privacy_scope_id TEXT DEFAULT 'device-local',
      title TEXT,
      content TEXT,
      enhanced_content TEXT,
      enhancement_prompt TEXT,
      enhanced_at_content_hash TEXT,
      transcript TEXT,
      source_file TEXT,
      participants TEXT
    );
    CREATE TABLE agent_conversations (
      id INTEGER PRIMARY KEY,
      client_conversation_id TEXT,
      privacy_scope_id TEXT DEFAULT 'device-local',
      title TEXT
    );
    CREATE TABLE agent_messages (
      id INTEGER PRIMARY KEY,
      conversation_id INTEGER,
      client_message_id TEXT,
      privacy_scope_id TEXT DEFAULT 'device-local',
      content TEXT,
      metadata TEXT
    );
    CREATE TABLE custom_dictionary (
      id INTEGER PRIMARY KEY,
      client_dict_id TEXT,
      word TEXT NOT NULL,
      deleted_at TEXT
    );
    CREATE TABLE desktop_dictionary_entries (
      id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      normalized_key TEXT NOT NULL,
      display_form TEXT NOT NULL,
      language TEXT NOT NULL,
      replacement TEXT,
      pronunciation TEXT,
      context TEXT,
      deleted_at TEXT,
      PRIMARY KEY (account_id, id)
    );
    CREATE TABLE desktop_synced_transcripts (
      account_id TEXT NOT NULL,
      id TEXT NOT NULL,
      title TEXT,
      text TEXT,
      metadata_json TEXT,
      PRIMARY KEY (account_id, id)
    );
    CREATE TABLE sync_outbox (
      mutation_id TEXT PRIMARY KEY,
      account_id TEXT NOT NULL,
      payload_json TEXT NOT NULL
    );
    CREATE TABLE google_calendar_tokens (
      id INTEGER PRIMARY KEY,
      google_email TEXT NOT NULL UNIQUE,
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      scope TEXT NOT NULL
    );
    INSERT INTO transcriptions VALUES
      (1, 'tx-1', 'private transcript', 'raw private transcript', 'provider leaked text');
    INSERT INTO notes VALUES
      (1, 'note-1', 'account:one', 'Private title', 'Private content', 'Enhanced private',
       'Prompt private', 'hash-private', '[{"text":"meeting secret"}]',
       '/private/audio.webm', '[{"email":"a@b.c"}]');
    INSERT INTO agent_conversations VALUES
      (1, 'conv-1', 'account:one', 'Private conversation');
    INSERT INTO agent_messages VALUES
      (1, 1, 'message-1', 'account:one', 'Private agent message', '{"prompt":"private"}');
    INSERT INTO custom_dictionary VALUES
      (1, 'dict-1', 'Oʻzbekiston', NULL);
    INSERT INTO desktop_dictionary_entries VALUES
      ('entry-1', 'account-a', 'oʻzbekiston', 'Oʻzbekiston', 'uz', 'Uzbekistan', 'oz-bek', 'country', NULL);
    INSERT INTO desktop_synced_transcripts VALUES
      ('account-a', 'sync-1', 'Meeting title', 'synced transcript', '{"duration_ms":1200}');
    INSERT INTO sync_outbox VALUES
      ('mutation-1', 'account-a', '{"text":"pending transcript"}');
    INSERT INTO google_calendar_tokens VALUES
      (1, 'calendar@example.com', 'access-token-secret', 'refresh-token-secret', 9999999999999, 'calendar.read');
  `);
  return { sqlite, db: sqliteAdapter(sqlite) };
}

test("versioned online migration encrypts sensitive columns and builds HMAC indexes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-privacy-migration-"));
  const { sqlite, db } = createLegacyDatabase();
  const crypto = cryptoService();
  const protection = new LocalDataProtection(
    db,
    crypto,
    path.join(dir, "transcriptions.db")
  );
  try {
    protection.migrateCore();
    protection.migrateSync();

    const transcription = sqlite.prepare("SELECT * FROM transcriptions WHERE id = 1").get();
    assert.match(transcription.text, /^vlabf:1:/);
    assert.doesNotMatch(transcription.text, /private transcript/);
    assert.equal(
      protection.reveal("transcriptions", "tx-1", "text", transcription.text),
      "private transcript"
    );

    const note = sqlite.prepare("SELECT * FROM notes WHERE id = 1").get();
    for (const field of [
      "title", "content", "enhanced_content", "enhancement_prompt",
      "enhanced_at_content_hash", "transcript", "source_file", "participants",
    ]) {
      assert.match(note[field], /^vlabf:1:/, field);
    }
    const conversation = sqlite.prepare("SELECT * FROM agent_conversations").get();
    const message = sqlite.prepare("SELECT * FROM agent_messages").get();
    assert.match(conversation.title, /^vlabf:1:/);
    assert.match(message.content, /^vlabf:1:/);
    assert.match(message.metadata, /^vlabf:1:/);
    assert.equal(
      protection.reveal(
        "agent_messages",
        "account:one:message-1",
        "content",
        message.content
      ),
      "Private agent message"
    );

    const googleTokens = sqlite.prepare("SELECT * FROM google_calendar_tokens").get();
    assert.match(googleTokens.access_token, /^vlabf:1:/);
    assert.match(googleTokens.refresh_token, /^vlabf:1:/);
    assert.doesNotMatch(googleTokens.access_token, /access-token-secret/);
    assert.equal(
      protection.reveal(
        "google_calendar_tokens",
        "calendar@example.com",
        "access_token",
        googleTokens.access_token
      ),
      "access-token-secret"
    );

    const dictionary = sqlite.prepare("SELECT * FROM custom_dictionary WHERE id = 1").get();
    assert.match(dictionary.word, /^vlabf:1:/);
    assert.match(dictionary.word_hmac, /^[a-f0-9]{64}$/);
    assert.notEqual(dictionary.word_hmac, normalizeDictionaryValue("Oʻzbekiston"));

    const synced = sqlite
      .prepare("SELECT * FROM desktop_synced_transcripts WHERE id = 'sync-1'")
      .get();
    assert.match(synced.title, /^vlabf:1:/);
    assert.match(synced.text, /^vlabf:1:/);
    assert.match(synced.metadata_json, /^vlabf:1:/);

    const outbox = sqlite.prepare("SELECT payload_json FROM sync_outbox").get();
    assert.match(outbox.payload_json, /^vlabf:1:/);

    const states = sqlite
      .prepare(
        "SELECT completed_at FROM local_data_migrations WHERE completed_at IS NOT NULL"
      )
      .all();
    assert.equal(states.length, 9);
  } finally {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("field encryption fails closed for wrong keys, tampering, plaintext, and account swaps", () => {
  const materialA = registry();
  const materialB = registry();
  const cryptoA = cryptoService(materialA);
  const cryptoB = cryptoService(materialB);
  const contextA = {
    table: "desktop_synced_transcripts",
    row: "account-a:record-1",
    field: "text",
  };
  const contextB = { ...contextA, row: "account-b:record-1" };
  const encrypted = cryptoA.encryptText("account A secret", contextA);

  assert.equal(cryptoA.decryptText(encrypted, contextA), "account A secret");
  assert.throws(
    () => cryptoB.decryptText(encrypted, contextA),
    LocalDataCorruptionError
  );
  assert.throws(
    () => cryptoA.decryptText(encrypted, contextB),
    LocalDataCorruptionError
  );
  const parts = encrypted.split(":");
  const ciphertext = parts[5];
  const midpoint = Math.floor(ciphertext.length / 2);
  parts[5] =
    ciphertext.slice(0, midpoint)
    + (ciphertext[midpoint] === "A" ? "B" : "A")
    + ciphertext.slice(midpoint + 1);
  assert.throws(
    () => cryptoA.decryptText(parts.join(":"), contextA),
    LocalDataCorruptionError
  );
  assert.throws(
    () => cryptoA.decryptText("plaintext regression", contextA),
    /unexpectedly plaintext/
  );
});

test("deterministic HMAC lookup preserves normalized dictionary search without deterministic ciphertext", () => {
  const crypto = cryptoService();
  const namespace = "custom_dictionary:word";
  const first = normalizeDictionaryValue("  OʻZBEKISTON ");
  const second = normalizeDictionaryValue("oʻzbekiston");
  assert.equal(crypto.deterministicIndex(namespace, first), crypto.deterministicIndex(namespace, second));

  const context = { table: "custom_dictionary", row: "dict-1", field: "word" };
  assert.notEqual(
    crypto.encryptText("Oʻzbekiston", context),
    crypto.encryptText("Oʻzbekiston", context)
  );
});

test("key rotation re-encrypts online while retaining authenticated reads", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-privacy-rotation-"));
  const { sqlite, db } = createLegacyDatabase();
  const crypto = cryptoService();
  const protection = new LocalDataProtection(
    db,
    crypto,
    path.join(dir, "transcriptions.db")
  );
  try {
    protection.migrateCore();
    protection.migrateSync();
    const before = sqlite.prepare("SELECT text FROM transcriptions WHERE id = 1").get().text;
    const nextVersion = protection.rotateKeyAndReencrypt();
    const after = sqlite.prepare("SELECT text FROM transcriptions WHERE id = 1").get().text;
    assert.equal(nextVersion, 2);
    assert.notEqual(after, before);
    assert.equal(crypto.encryptedTextVersion(after), 2);
    assert.equal(
      protection.reveal("transcriptions", "tx-1", "text", after),
      "private transcript"
    );
    assert.deepEqual(crypto.retainedVersions(), [1, 2]);
  } finally {
    sqlite.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("audio content and metadata stay encrypted, account identifiers stay out of filenames, and retention deletes", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-private-"));
  const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-temp-"));
  const crypto = cryptoService();
  const storage = new AudioStorageManager({ userDataPath, tempPath, cryptoService: crypto });
  try {
    const secret = Buffer.from("sensitive audio bytes");
    const result = storage.saveAudio("account-a-record-42", secret, "2020-01-01T00:00:00Z");
    assert.equal(result.success, true);

    const filenames = fs.readdirSync(path.join(userDataPath, "audio"));
    assert.equal(filenames.some((name) => name.includes("account-a-record-42")), false);
    const audioFile = filenames.find((name) => name.endsWith(".webm.enc"));
    assert.ok(audioFile);
    assert.equal(
      fs.readFileSync(path.join(userDataPath, "audio", audioFile)).includes(secret),
      false
    );
    assert.equal(
      fs.readFileSync(path.join(userDataPath, "audio", "audio-index.v1.enc")).includes(
        Buffer.from("account-a-record-42")
      ),
      false
    );
    assert.deepEqual(storage.getAudioBuffer("account-a-record-42"), secret);
    assert.equal(fs.statSync(path.join(userDataPath, "audio")).mode & 0o777, 0o700);
    assert.equal(
      fs.statSync(path.join(userDataPath, "audio", audioFile)).mode & 0o777,
      0o600
    );

    const cleanup = storage.cleanupExpiredAudio(1);
    assert.equal(cleanup.deleted, 1);
    assert.equal(storage.getAudioBuffer("account-a-record-42"), null);
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

test("audio tampering fails closed instead of returning corrupted plaintext", () => {
  const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-tamper-"));
  const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-temp-"));
  const crypto = cryptoService();
  const storage = new AudioStorageManager({ userDataPath, tempPath, cryptoService: crypto });
  try {
    storage.saveAudio("record-1", Buffer.from("audio"), new Date());
    const audioFile = fs
      .readdirSync(path.join(userDataPath, "audio"))
      .find((name) => name.endsWith(".webm.enc"));
    const target = path.join(userDataPath, "audio", audioFile);
    const contents = fs.readFileSync(target);
    contents[contents.length - 1] ^= 0xff;
    fs.writeFileSync(target, contents, { mode: 0o600 });
    assert.throws(
      () => storage.getAudioBuffer("record-1"),
      LocalDataCorruptionError
    );
  } finally {
    fs.rmSync(userDataPath, { recursive: true, force: true });
    fs.rmSync(tempPath, { recursive: true, force: true });
  }
});

for (const checkpoint of [
  "replacement_authenticated",
  "journal_persisted",
  "replacement_promoted",
  "manifest_persisted",
  "source_deleted",
]) {
  test(`audio overwrite resumes safely after ${checkpoint}`, () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-crash-"));
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-temp-"));
    const crypto = cryptoService();
    try {
      const initial = new AudioStorageManager({ userDataPath, tempPath, cryptoService: crypto });
      assert.equal(initial.saveAudio("record-1", Buffer.from("old audio")).success, true);
      const crashing = new AudioStorageManager({
        userDataPath,
        tempPath,
        cryptoService: crypto,
        faultInjector(name) {
          if (name === checkpoint) throw new Error("simulated crash");
        },
      });
      assert.equal(crashing.saveAudio("record-1", Buffer.from("new audio")).success, false);
      const recovered = new AudioStorageManager({ userDataPath, tempPath, cryptoService: crypto });
      const audio = recovered.getAudioBuffer("record-1");
      assert.ok(
        audio.equals(Buffer.from("old audio")) || audio.equals(Buffer.from("new audio")),
        "recovery must preserve a complete authenticated version"
      );
      assert.equal(
        fs.readdirSync(path.join(userDataPath, "audio")).some((name) => name.endsWith(".pending")),
        false
      );
    } finally {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });
}

for (const checkpoint of [
  "replacement_authenticated",
  "journal_persisted",
  "replacement_promoted",
  "manifest_persisted",
  "source_deleted",
]) {
  test(`legacy audio migration resumes safely after ${checkpoint}`, () => {
    const userDataPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-legacy-"));
    const tempPath = fs.mkdtempSync(path.join(os.tmpdir(), "voicelab-audio-temp-"));
    const crypto = cryptoService();
    const audioDir = path.join(userDataPath, "audio");
    fs.mkdirSync(audioDir, { recursive: true });
    fs.writeFileSync(path.join(audioDir, "record-legacy-42.webm"), Buffer.from("legacy audio"));
    try {
      assert.throws(
        () =>
          new AudioStorageManager({
            userDataPath,
            tempPath,
            cryptoService: crypto,
            faultInjector(name) {
              if (name === checkpoint) throw new Error("simulated crash");
            },
          }),
        /simulated crash/
      );
      const recovered = new AudioStorageManager({ userDataPath, tempPath, cryptoService: crypto });
      assert.deepEqual(recovered.getAudioBuffer("42"), Buffer.from("legacy audio"));
      const files = fs.readdirSync(audioDir);
      assert.equal(files.includes("record-legacy-42.webm"), false);
      assert.equal(files.some((name) => name.endsWith(".pending")), false);
    } finally {
      fs.rmSync(userDataPath, { recursive: true, force: true });
      fs.rmSync(tempPath, { recursive: true, force: true });
    }
  });
}

test("local transcripts stay isolated across account switches and require explicit legacy ownership", () => {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`
    CREATE TABLE transcriptions (
      id INTEGER PRIMARY KEY,
      client_transcription_id TEXT,
      text TEXT NOT NULL,
      raw_text TEXT,
      error_message TEXT,
      error_code TEXT,
      status TEXT DEFAULT 'completed',
      deleted_at TEXT,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      privacy_scope_id TEXT NOT NULL DEFAULT 'device-local'
    );
    CREATE TABLE custom_dictionary (
      id INTEGER PRIMARY KEY,
      client_dict_id TEXT,
      word TEXT,
      source TEXT,
      updated_at TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
  `);
  const db = sqliteAdapter(sqlite);
  const protection = new LocalDataProtection(db, cryptoService(), path.join(os.tmpdir(), "scope.db"));
  const manager = Object.create(DatabaseManager.prototype);
  manager.db = db;
  manager.localDataProtection = protection;
  manager.setDictionary = () => ({ success: true });
  const store = new DesktopSyncStore(manager);
  manager.desktopSyncStore = store;
  const insert = sqlite.prepare(`
    INSERT INTO transcriptions (
      id, client_transcription_id, text, status, privacy_scope_id
    ) VALUES (?, ?, ?, 'completed', ?)
  `);
  for (const [id, clientId, clear, scope] of [
    [1, "legacy-1", "legacy", "device-local"],
    [2, "account-a-1", "account a", "account:account-a"],
    [3, "account-b-1", "account b", "account:account-b"],
  ]) {
    insert.run(
      id,
      clientId,
      protection.protect("transcriptions", clientId, "text", clear),
      scope
    );
  }
  sqlite.prepare(`
    INSERT INTO sync_accounts (
      account_id, device_id, active, dictionary_enabled, preferences_enabled,
      transcripts_enabled, audio_enabled
    ) VALUES ('account-a', 'device', 1, 1, 1, 1, 0),
             ('account-b', 'device', 0, 1, 1, 1, 0)
  `).run();

  assert.deepEqual(manager.getTranscriptions().map((row) => row.text), ["account a"]);
  assert.equal(store.getState().requiresLegacyDecision, true);
  store.decideLegacyAttachment("keep_local");
  assert.deepEqual(manager.getTranscriptions().map((row) => row.text), ["account a"]);

  store.pause();
  assert.deepEqual(manager.getTranscriptions().map((row) => row.text), ["legacy"]);
  sqlite.prepare("UPDATE sync_accounts SET active = CASE WHEN account_id = 'account-b' THEN 1 ELSE 0 END").run();
  assert.deepEqual(manager.getTranscriptions().map((row) => row.text), ["account b"]);
  assert.throws(
    () => store.decideLegacyAttachment("attach"),
    /another local account profile/
  );
  sqlite.close();
});
