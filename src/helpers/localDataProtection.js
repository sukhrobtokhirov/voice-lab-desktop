const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { LocalDataCorruptionError } = require("./localDataCrypto");

const SCHEMA_VERSION = 2;
const BATCH_SIZE = 200;

function tableExists(db, table) {
  return Boolean(
    db
      .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(table)
  );
}

function columnsFor(db, table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
}

function normalizeDictionaryValue(value) {
  return String(value || "")
    .normalize("NFKC")
    .replace(/[\u0060\u00b4\u02bb\u02bc\u2018\u2019\u201b\u2032\uff07]/g, "\u02bb")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleLowerCase("und");
}

const CORE_DEFINITIONS = [
  {
    table: "transcriptions",
    fields: ["text", "raw_text", "error_message"],
    identity: (row) => row.client_transcription_id || `legacy:${row.id}`,
  },
  {
    table: "notes",
    fields: [
      "title",
      "content",
      "enhanced_content",
      "enhancement_prompt",
      "enhanced_at_content_hash",
      "transcript",
      "source_file",
      "participants",
    ],
    identity: (row) =>
      `${row.privacy_scope_id || "device-local"}:${row.client_note_id || `legacy:${row.id}`}`,
  },
  {
    table: "agent_conversations",
    fields: ["title"],
    identity: (row) =>
      `${row.privacy_scope_id || "device-local"}:${row.client_conversation_id || `legacy:${row.id}`}`,
  },
  {
    table: "agent_messages",
    fields: ["content", "metadata"],
    identity: (row) =>
      `${row.privacy_scope_id || "device-local"}:${row.client_message_id || `legacy:${row.id}`}`,
  },
  {
    table: "custom_dictionary",
    fields: ["word"],
    identity: (row) => row.client_dict_id || `legacy:${row.id}`,
    index: {
      column: "word_hmac",
      namespace: "custom_dictionary:word",
      value: (row, plaintext) => normalizeDictionaryValue(plaintext.word),
    },
  },
  {
    table: "google_calendar_tokens",
    fields: ["access_token", "refresh_token"],
    identity: (row) => row.google_email,
  },
];

const SYNC_DEFINITIONS = [
  {
    table: "desktop_dictionary_entries",
    fields: ["display_form", "replacement", "pronunciation", "context"],
    identity: (row) => `${row.account_id}:${row.id}`,
    index: {
      column: "normalized_key",
      namespace: "desktop_dictionary_entries:normalized_key",
      value: (row, plaintext) =>
        `${String(row.language || "und")}\0${normalizeDictionaryValue(plaintext.display_form)}`,
    },
  },
  {
    table: "desktop_synced_transcripts",
    fields: ["title", "text", "metadata_json"],
    identity: (row) => `${row.account_id}:${row.id}`,
  },
  {
    table: "sync_outbox",
    fields: ["payload_json"],
    identity: (row) => `${row.account_id}:${row.mutation_id}`,
  },
];

class LocalDataProtection {
  constructor(db, cryptoService, databasePath) {
    this.db = db;
    this.crypto = cryptoService;
    this.databasePath = databasePath;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS local_data_migrations (
        migration_name TEXT PRIMARY KEY,
        schema_version INTEGER NOT NULL,
        key_version INTEGER NOT NULL,
        last_rowid INTEGER NOT NULL DEFAULT 0,
        completed_at TEXT
      )
    `);
    this.db.pragma("secure_delete = ON");
    this.applyPermissions();
  }

  applyPermissions() {
    const parent = path.dirname(this.databasePath);
    fs.mkdirSync(parent, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(parent, 0o700);
    } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      const target = `${this.databasePath}${suffix}`;
      if (!fs.existsSync(target)) continue;
      try {
        fs.chmodSync(target, 0o600);
      } catch {}
    }
  }

  ensureCoreSchema() {
    if (tableExists(this.db, "custom_dictionary")) {
      const columns = columnsFor(this.db, "custom_dictionary");
      if (!columns.has("word_hmac")) {
        this.db.exec("ALTER TABLE custom_dictionary ADD COLUMN word_hmac TEXT");
      }
      this.db.exec(
        "CREATE INDEX IF NOT EXISTS idx_custom_dictionary_word_hmac ON custom_dictionary(word_hmac, deleted_at)"
      );
    }
  }

  migrateCore() {
    this.ensureCoreSchema();
    for (const definition of CORE_DEFINITIONS) this._migrateDefinition(definition);
    this.applyPermissions();
  }

  migrateSync() {
    if (tableExists(this.db, "desktop_dictionary_entries")) {
      this.db.exec("DROP INDEX IF EXISTS idx_desktop_dictionary_unique_active");
    }
    for (const definition of SYNC_DEFINITIONS) this._migrateDefinition(definition);
    if (tableExists(this.db, "desktop_dictionary_entries")) {
      this.db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_dictionary_unique_active
          ON desktop_dictionary_entries(account_id, language, normalized_key)
          WHERE deleted_at IS NULL
      `);
    }
    this.applyPermissions();
  }

  _migrationName(definition) {
    return `field-encryption:${definition.table}:v${SCHEMA_VERSION}`;
  }

  _migrateDefinition(definition, { forceReencrypt = false } = {}) {
    if (!tableExists(this.db, definition.table)) return;
    const availableColumns = columnsFor(this.db, definition.table);
    const fields = definition.fields.filter((field) => availableColumns.has(field));
    if (fields.length === 0) return;
    const name = this._migrationName(definition);
    const state = this.db
      .prepare("SELECT * FROM local_data_migrations WHERE migration_name = ?")
      .get(name);
    const currentKeyVersion = this.crypto.currentVersion;
    if (
      state?.completed_at
      && Number(state.schema_version) === SCHEMA_VERSION
      && Number(state.key_version) === currentKeyVersion
      && !forceReencrypt
    ) {
      this._verifyDefinition(definition, fields);
      return;
    }
    let lastRowid =
      state
      && Number(state.schema_version) === SCHEMA_VERSION
      && Number(state.key_version) === currentKeyVersion
        ? Number(state.last_rowid || 0)
        : 0;
    this.db
      .prepare(`
        INSERT INTO local_data_migrations (
          migration_name, schema_version, key_version, last_rowid, completed_at
        ) VALUES (?, ?, ?, ?, NULL)
        ON CONFLICT(migration_name) DO UPDATE SET
          schema_version = excluded.schema_version,
          key_version = excluded.key_version,
          last_rowid = excluded.last_rowid,
          completed_at = NULL
      `)
      .run(name, SCHEMA_VERSION, currentKeyVersion, lastRowid);

    while (true) {
      const rows = this.db
        .prepare(
          `SELECT rowid AS __local_rowid, * FROM ${definition.table}
           WHERE rowid > ? ORDER BY rowid LIMIT ?`
        )
        .all(lastRowid, BATCH_SIZE);
      if (rows.length === 0) break;
      this.db.exec("BEGIN IMMEDIATE");
      try {
        for (const row of rows) {
          const identity = String(definition.identity(row));
          if (!identity) {
            throw new LocalDataCorruptionError(
              `Sensitive row in ${definition.table} has no stable identity`
            );
          }
          const plaintext = {};
          const assignments = [];
          const values = [];
          for (const field of fields) {
            const value = row[field];
            if (value === null || value === undefined) {
              plaintext[field] = value;
              continue;
            }
            const context = { table: definition.table, row: identity, field };
            const clear = this.crypto.decryptText(value, context, { allowPlaintext: true });
            plaintext[field] = clear;
            const shouldEncrypt =
              !this.crypto.isEncryptedText(value)
              || this.crypto.encryptedTextVersion(value) !== currentKeyVersion
              || forceReencrypt;
            if (shouldEncrypt) {
              assignments.push(`${field} = ?`);
              values.push(this.crypto.encryptText(clear, context));
            }
          }
          if (definition.index) {
            const indexValue = this.crypto.deterministicIndex(
              definition.index.namespace,
              definition.index.value(row, plaintext)
            );
            if (row[definition.index.column] !== indexValue) {
              assignments.push(`${definition.index.column} = ?`);
              values.push(indexValue);
            }
          }
          if (assignments.length > 0) {
            values.push(row.__local_rowid);
            this.db
              .prepare(
                `UPDATE ${definition.table} SET ${assignments.join(", ")} WHERE rowid = ?`
              )
              .run(...values);
          }
          lastRowid = Number(row.__local_rowid);
        }
        this.db
          .prepare(
            "UPDATE local_data_migrations SET last_rowid = ? WHERE migration_name = ?"
          )
          .run(lastRowid, name);
        this.db.exec("COMMIT");
      } catch (error) {
        try {
          this.db.exec("ROLLBACK");
        } catch {}
        throw error;
      }
    }
    this.db
      .prepare(
        `UPDATE local_data_migrations
         SET key_version = ?, last_rowid = 0, completed_at = CURRENT_TIMESTAMP
         WHERE migration_name = ?`
      )
      .run(currentKeyVersion, name);
    this._verifyDefinition(definition, fields);
  }

  _verifyDefinition(definition, fields) {
    const rows = this.db.prepare(`SELECT * FROM ${definition.table}`).all();
    for (const row of rows) {
      const identity = String(definition.identity(row));
      for (const field of fields) {
        if (row[field] === null || row[field] === undefined) continue;
        this.crypto.decryptText(row[field], {
          table: definition.table,
          row: identity,
          field,
        });
      }
    }
  }

  protect(table, row, field, value) {
    return this.crypto.encryptText(value, { table, row: String(row), field });
  }

  reveal(table, row, field, value) {
    return this.crypto.decryptText(value, { table, row: String(row), field });
  }

  index(namespace, value) {
    return this.crypto.deterministicIndex(namespace, value);
  }

  rotateKeyAndReencrypt() {
    const version = this.crypto.rotateKey();
    for (const definition of CORE_DEFINITIONS) {
      this._migrateDefinition(definition, { forceReencrypt: true });
    }
    for (const definition of SYNC_DEFINITIONS) {
      this._migrateDefinition(definition, { forceReencrypt: true });
    }
    return version;
  }

  activeFieldKeyVersions() {
    const versions = new Set();
    for (const definition of [...CORE_DEFINITIONS, ...SYNC_DEFINITIONS]) {
      if (!tableExists(this.db, definition.table)) continue;
      const available = columnsFor(this.db, definition.table);
      const fields = definition.fields.filter((field) => available.has(field));
      for (const row of this.db.prepare(`SELECT ${fields.join(", ")} FROM ${definition.table}`).all()) {
        for (const field of fields) {
          const version = this.crypto.encryptedTextVersion(row[field]);
          if (version) versions.add(version);
        }
      }
    }
    return versions;
  }

  async createBackup(destination) {
    const target = path.resolve(destination);
    fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
    fs.chmodSync(path.dirname(target), 0o700);
    await this.db.backup(target);
    fs.chmodSync(target, 0o600);
    const keyringTarget = `${target}.keys.enc`;
    this.crypto.backupKeyring(keyringTarget);
    const manifest = {
      format: 1,
      created_at: new Date().toISOString(),
      database: path.basename(target),
      keyring: path.basename(keyringTarget),
      database_sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex"),
      keyring_sha256: crypto
        .createHash("sha256")
        .update(fs.readFileSync(keyringTarget))
        .digest("hex"),
      restore_scope: "same-os-profile",
    };
    const manifestPath = `${target}.manifest.json`;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), { mode: 0o600 });
    fs.chmodSync(manifestPath, 0o600);
    return { database: target, keyring: keyringTarget, manifest: manifestPath };
  }

  verifyBackup(destination) {
    const target = path.resolve(destination);
    const manifestPath = `${target}.manifest.json`;
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    const keyringTarget = `${target}.keys.enc`;
    const databaseHash = crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex");
    const keyringHash = crypto
      .createHash("sha256")
      .update(fs.readFileSync(keyringTarget))
      .digest("hex");
    if (
      manifest.database_sha256 !== databaseHash
      || manifest.keyring_sha256 !== keyringHash
    ) {
      throw new LocalDataCorruptionError("Local data backup authentication failed");
    }
    return manifest;
  }

  secureCheckpoint() {
    this.db.pragma("wal_checkpoint(TRUNCATE)");
    this.db.pragma("incremental_vacuum");
    this.applyPermissions();
  }
}

module.exports = {
  CORE_DEFINITIONS,
  LocalDataProtection,
  SCHEMA_VERSION,
  SYNC_DEFINITIONS,
  normalizeDictionaryValue,
};
