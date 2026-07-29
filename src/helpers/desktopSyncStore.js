const { randomUUID } = require("crypto");

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);
const DEFAULT_LANGUAGE = "und";
const MAX_BATCH = 100;
const PORTABLE_PREFERENCE_KEYS = new Set([
  "preferred_language",
  "ui_language",
  "theme",
  "auto_paste_enabled",
  "cleanup_enabled",
  "audio_cues_enabled",
  "pause_media_on_dictation",
  "translation_targets",
]);
const COLLECTION_FLAG = {
  dictionary: "dictionary_enabled",
  preference: "preferences_enabled",
  transcript: "transcripts_enabled",
};

function cleanDisplayForm(value) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
    .normalize("NFC")
    .trim();
}

function cleanTranscriptText(value) {
  return String(value || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
    .normalize("NFC")
    .trim();
}

function normalizeKey(value) {
  return cleanDisplayForm(value)
    .normalize("NFKC")
    .replace(/[\u0060\u00b4\u02bb\u02bc\u2018\u2019\u201b\u2032\uff07]/g, "\u02bb")
    .replace(/\s+/gu, " ")
    .toLocaleLowerCase("und");
}

function safeJson(value, fallback = null) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function publicEntry(row) {
  if (!row) return null;
  return {
    id: row.id,
    displayForm: row.display_form,
    normalizedKey: row.normalized_key,
    language: row.language,
    replacement: row.replacement,
    pronunciation: row.pronunciation,
    context: row.context,
    source: row.source,
    version: Number(row.version || 0),
    deletedAt: row.deleted_at,
    syncStatus: row.sync_status,
    lastErrorCode: row.last_error_code,
    updatedAt: row.updated_at,
  };
}

function normalizeTranscriptSource(value) {
  const source = String(value || "").trim().toLowerCase();
  if (source === "local" || source.startsWith("local-")) return "local";
  if (source === "byok") return "byok";
  if (!source || ["aisha", "voicelab", "voicelab-cloud", "openwhispr"].includes(source)) {
    return null;
  }
  return "byok";
}

class DesktopSyncStore {
  constructor(databaseManager) {
    this.databaseManager = databaseManager;
    this.db = databaseManager.db;
    this.db.pragma("foreign_keys = ON");
    this.init();
  }

  addColumnIfMissing(table, column, definition) {
    const columns = new Set(this.db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name));
    if (!columns.has(column)) this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }

  init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sync_accounts (
        account_id TEXT PRIMARY KEY,
        device_id TEXT NOT NULL,
        schema_version INTEGER NOT NULL DEFAULT 1,
        active INTEGER NOT NULL DEFAULT 0,
        dictionary_enabled INTEGER NOT NULL DEFAULT 1,
        preferences_enabled INTEGER NOT NULL DEFAULT 1,
        transcripts_enabled INTEGER NOT NULL DEFAULT 0,
        audio_enabled INTEGER NOT NULL DEFAULT 0,
        supported_languages_json TEXT NOT NULL DEFAULT '[]',
        auto_detection_supported INTEGER NOT NULL DEFAULT 0,
        legacy_attach_decision TEXT,
        consent_version INTEGER NOT NULL DEFAULT 0,
        transcripts_enabled_at TEXT,
        last_bootstrap_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sync_state (
        account_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        cursor TEXT,
        last_success_at TEXT,
        last_error_code TEXT,
        PRIMARY KEY (account_id, collection),
        FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS desktop_dictionary_entries (
        id TEXT NOT NULL,
        account_id TEXT NOT NULL,
        normalized_key TEXT NOT NULL,
        display_form TEXT NOT NULL,
        language TEXT NOT NULL DEFAULT 'und',
        replacement TEXT,
        pronunciation TEXT,
        context TEXT,
        source TEXT NOT NULL DEFAULT 'manual',
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'saved_local',
        current_mutation_id TEXT,
        last_error_code TEXT,
        snapshot_seen INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, id),
        FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS portable_preferences (
        account_id TEXT NOT NULL,
        record_id TEXT,
        preference_key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        snapshot_seen INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, preference_key),
        FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS desktop_synced_transcripts (
        account_id TEXT NOT NULL,
        id TEXT NOT NULL,
        local_transcription_id INTEGER,
        title TEXT NOT NULL DEFAULT '',
        text TEXT NOT NULL DEFAULT '',
        language TEXT NOT NULL DEFAULT 'und',
        source TEXT NOT NULL,
        source_created_at TEXT,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        origin TEXT NOT NULL DEFAULT 'local',
        version INTEGER NOT NULL DEFAULT 0,
        deleted_at TEXT,
        sync_status TEXT NOT NULL DEFAULT 'saved_local',
        current_mutation_id TEXT,
        last_error_code TEXT,
        snapshot_seen INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (account_id, id),
        UNIQUE (account_id, local_transcription_id),
        FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sync_outbox (
        mutation_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        device_id TEXT NOT NULL,
        collection TEXT NOT NULL,
        record_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        base_version INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        expected_local_version INTEGER NOT NULL,
        idempotency_key TEXT NOT NULL,
        outbox_sequence INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT,
        dead_lettered_at TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS legacy_dictionary_profile (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        owner_account_id TEXT,
        decision TEXT,
        decided_at TEXT
      );
    `);

    this.addColumnIfMissing("sync_accounts", "transcripts_enabled_at", "TEXT");
    this.addColumnIfMissing("sync_accounts", "consent_version", "INTEGER NOT NULL DEFAULT 0");
    this.addColumnIfMissing("portable_preferences", "record_id", "TEXT");
    this.addColumnIfMissing("portable_preferences", "snapshot_seen", "INTEGER NOT NULL DEFAULT 1");
    this.addColumnIfMissing("sync_outbox", "outbox_sequence", "INTEGER");
    this.addColumnIfMissing("sync_outbox", "dead_lettered_at", "TEXT");
    this.addColumnIfMissing("desktop_synced_transcripts", "source_created_at", "TEXT");

    const dictionaryInfo = this.db.prepare("PRAGMA table_info(desktop_dictionary_entries)").all();
    const dictionaryPk = dictionaryInfo
      .filter((row) => Number(row.pk) > 0)
      .sort((a, b) => Number(a.pk) - Number(b.pk))
      .map((row) => row.name);
    if (dictionaryPk.join(",") !== "account_id,id") {
      const migrateDictionary = this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE desktop_dictionary_entries_v2 (
            id TEXT NOT NULL,
            account_id TEXT NOT NULL,
            normalized_key TEXT NOT NULL,
            display_form TEXT NOT NULL,
            language TEXT NOT NULL DEFAULT 'und',
            replacement TEXT,
            pronunciation TEXT,
            context TEXT,
            source TEXT NOT NULL DEFAULT 'manual',
            version INTEGER NOT NULL DEFAULT 0,
            deleted_at TEXT,
            sync_status TEXT NOT NULL DEFAULT 'saved_local',
            current_mutation_id TEXT,
            last_error_code TEXT,
            snapshot_seen INTEGER NOT NULL DEFAULT 1,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (account_id, id),
            FOREIGN KEY (account_id) REFERENCES sync_accounts(account_id) ON DELETE CASCADE
          );
          INSERT INTO desktop_dictionary_entries_v2 (
            id, account_id, normalized_key, display_form, language, replacement,
            pronunciation, context, source, version, deleted_at, sync_status,
            current_mutation_id, last_error_code, created_at, updated_at
          )
          SELECT id, account_id, normalized_key, display_form, language, replacement,
                 pronunciation, context, source, version, deleted_at, sync_status,
                 current_mutation_id, last_error_code, created_at, updated_at
          FROM desktop_dictionary_entries;
          DROP TABLE desktop_dictionary_entries;
          ALTER TABLE desktop_dictionary_entries_v2 RENAME TO desktop_dictionary_entries;
        `);
      });
      migrateDictionary();
    } else {
      this.addColumnIfMissing("desktop_dictionary_entries", "snapshot_seen", "INTEGER NOT NULL DEFAULT 1");
    }

    const migrate = this.db.transaction(() => {
      const missingPreferences = this.db
        .prepare("SELECT account_id, preference_key FROM portable_preferences WHERE record_id IS NULL")
        .all();
      const updatePreference = this.db.prepare(
        "UPDATE portable_preferences SET record_id = ? WHERE account_id = ? AND preference_key = ?"
      );
      for (const row of missingPreferences) updatePreference.run(randomUUID(), row.account_id, row.preference_key);
      this.db.exec("UPDATE sync_outbox SET outbox_sequence = rowid WHERE outbox_sequence IS NULL");
    });
    migrate();

    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_desktop_dictionary_unique_active
        ON desktop_dictionary_entries(account_id, language, normalized_key)
        WHERE deleted_at IS NULL;
      CREATE INDEX IF NOT EXISTS idx_desktop_dictionary_account
        ON desktop_dictionary_entries(account_id, deleted_at, updated_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_portable_preferences_record
        ON portable_preferences(account_id, record_id);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sync_outbox_account_sequence
        ON sync_outbox(account_id, outbox_sequence);
      CREATE INDEX IF NOT EXISTS idx_sync_outbox_due
        ON sync_outbox(account_id, dead_lettered_at, outbox_sequence);
      CREATE INDEX IF NOT EXISTS idx_synced_transcripts_account
        ON desktop_synced_transcripts(account_id, deleted_at, updated_at);
    `);
  }

  nextOutboxSequence(accountId) {
    return Number(this.db.prepare(
      "SELECT COALESCE(MAX(outbox_sequence), 0) AS value FROM sync_outbox WHERE account_id = ?"
    ).get(accountId)?.value || 0) + 1;
  }

  activeAccount() {
    return this.db.prepare("SELECT * FROM sync_accounts WHERE active = 1 LIMIT 1").get() || null;
  }

  collectionEnabled(account, collection) {
    const field = COLLECTION_FLAG[collection];
    return Boolean(field && Number(account?.[field]) === 1);
  }

  bindAccount(bootstrap) {
    const accountId = String(bootstrap?.account_id || "").trim();
    const deviceId = String(bootstrap?.device_id || "").trim();
    if (!accountId || !deviceId) throw new Error("Sync bootstrap is missing account or device");
    const enabled = bootstrap.enabled || {};
    const previous = this.db.prepare("SELECT * FROM sync_accounts WHERE account_id = ?").get(accountId);
    const transcriptEnabled = enabled.transcripts === true ? 1 : 0;
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE sync_accounts SET active = 0").run();
      this.db.prepare(`
        INSERT INTO sync_accounts (
          account_id, device_id, schema_version, active, dictionary_enabled,
          preferences_enabled, transcripts_enabled, audio_enabled,
          supported_languages_json, auto_detection_supported, consent_version,
          transcripts_enabled_at,
          last_bootstrap_at
        ) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(account_id) DO UPDATE SET
          device_id = excluded.device_id,
          schema_version = excluded.schema_version,
          active = 1,
          dictionary_enabled = excluded.dictionary_enabled,
          preferences_enabled = excluded.preferences_enabled,
          transcripts_enabled = excluded.transcripts_enabled,
          audio_enabled = excluded.audio_enabled,
          supported_languages_json = excluded.supported_languages_json,
          auto_detection_supported = excluded.auto_detection_supported,
          consent_version = excluded.consent_version,
          transcripts_enabled_at = excluded.transcripts_enabled_at,
          last_bootstrap_at = CURRENT_TIMESTAMP
      `).run(
        accountId,
        deviceId,
        Number(bootstrap.schema_version || 1),
        enabled.dictionary === false ? 0 : 1,
        enabled.preferences === false ? 0 : 1,
        transcriptEnabled,
        enabled.audio === true ? 1 : 0,
        JSON.stringify(Array.isArray(bootstrap.supported_languages) ? bootstrap.supported_languages : []),
        bootstrap.auto_detection_supported === true ? 1 : 0,
        Number(bootstrap.consent_version || 0),
        transcriptEnabled
          ? bootstrap.consent?.transcript_text_enabled_at
            || previous?.transcripts_enabled_at
            || null
          : null
      );
      this.quarantineDisabledCollections(accountId);
      this.replaceEnabledCollections(
        accountId,
        bootstrap.snapshot && typeof bootstrap.snapshot === "object"
          ? bootstrap.snapshot
          : {},
        enabled
      );
      this.setCursor(accountId, bootstrap.cursor || null);
    });
    transaction();
    return this.getState();
  }

  quarantineDisabledCollections(accountId) {
    const account = this.db.prepare("SELECT * FROM sync_accounts WHERE account_id = ?").get(accountId);
    if (!account) return;
    for (const collection of Object.keys(COLLECTION_FLAG)) {
      if (this.collectionEnabled(account, collection)) continue;
      this.db.prepare("DELETE FROM sync_outbox WHERE account_id = ? AND collection = ?")
        .run(accountId, collection);
      if (collection === "dictionary") {
        this.db.prepare(`UPDATE desktop_dictionary_entries
          SET sync_status = 'saved_local', current_mutation_id = NULL,
              last_error_code = 'SYNC_CATEGORY_DISABLED'
          WHERE account_id = ? AND current_mutation_id IS NOT NULL`).run(accountId);
      }
      if (collection === "transcript") this.revokeTranscriptCollection(accountId);
    }
  }

  revokeTranscriptCollection(accountId) {
    const rows = this.db.prepare(
      "SELECT * FROM desktop_synced_transcripts WHERE account_id = ?"
    ).all(accountId);
    for (const row of rows) {
      if (row.local_transcription_id == null) continue;
      if (row.origin === "remote") {
        this.databaseManager.deleteSyncedTranscriptMirror?.(row.local_transcription_id, accountId);
      } else {
        this.databaseManager.detachSyncedTranscriptMirror?.(row.local_transcription_id, accountId);
      }
    }
    this.db.prepare("DELETE FROM desktop_synced_transcripts WHERE account_id = ?").run(accountId);
    this.db.prepare("DELETE FROM sync_outbox WHERE account_id = ? AND collection = 'transcript'")
      .run(accountId);
  }

  replaceEnabledCollections(accountId, snapshot, enabled) {
    const pendingRows = this.db.prepare(`
      SELECT * FROM sync_outbox
      WHERE account_id = ? AND dead_lettered_at IS NULL
      ORDER BY outbox_sequence
    `).all(accountId);
    const pendingByCollection = new Map();
    for (const row of pendingRows) {
      const rows = pendingByCollection.get(row.collection) || [];
      rows.push(row);
      pendingByCollection.set(row.collection, rows);
    }

    if (enabled.dictionary !== false) {
      this.db.prepare("DELETE FROM desktop_dictionary_entries WHERE account_id = ?").run(accountId);
      for (const record of Array.isArray(snapshot.dictionary) ? snapshot.dictionary : []) {
        this.applyDictionaryChange(accountId, {
          collection: "dictionary",
          record_id: record.id,
          operation: "upsert",
          version: record.version,
          payload: record,
        });
      }
      this.rebaseOutboxCollection(
        accountId,
        "dictionary",
        pendingByCollection.get("dictionary") || []
      );
    }

    if (enabled.preferences !== false) {
      this.db.prepare("DELETE FROM portable_preferences WHERE account_id = ?").run(accountId);
      for (const record of Array.isArray(snapshot.preference) ? snapshot.preference : []) {
        this.applyPreferenceChange(accountId, {
          collection: "preference",
          record_id: record.id,
          operation: "upsert",
          version: record.version,
          payload: record,
        });
      }
      this.rebaseOutboxCollection(
        accountId,
        "preference",
        pendingByCollection.get("preference") || []
      );
    }

    if (enabled.transcripts === true) {
      const previous = this.db.prepare(`
        SELECT * FROM desktop_synced_transcripts WHERE account_id = ?
      `).all(accountId);
      const pendingIds = new Set(
        (pendingByCollection.get("transcript") || []).map((row) => row.record_id)
      );
      const localLinks = new Map(previous.map((row) => [row.id, row]));
      for (const row of previous) {
        if (pendingIds.has(row.id) || row.local_transcription_id == null) continue;
        this.databaseManager.deleteSyncedTranscriptMirror?.(
          row.local_transcription_id,
          accountId
        );
      }
      this.db.prepare("DELETE FROM desktop_synced_transcripts WHERE account_id = ?").run(accountId);
      for (const record of Array.isArray(snapshot.transcript) ? snapshot.transcript : []) {
        this.applyTranscriptChange(accountId, {
          collection: "transcript",
          record_id: record.id,
          operation: "upsert",
          version: record.version,
          payload: record,
          changed_at: record.updated_at,
        });
      }
      this.rebaseOutboxCollection(
        accountId,
        "transcript",
        pendingByCollection.get("transcript") || [],
        localLinks
      );
    }
  }

  rebaseOutboxCollection(accountId, collection, rows, localLinks = new Map()) {
    for (const row of rows) {
      let recordId = row.record_id;
      const payload = safeJson(row.payload_json, {});
      if (collection === "dictionary" && row.operation === "upsert") {
        const normalized = normalizeKey(payload.display_form);
        const canonical = this.db.prepare(`
          SELECT id FROM desktop_dictionary_entries
          WHERE account_id = ? AND language = ? AND normalized_key = ?
        `).get(accountId, payload.language || DEFAULT_LANGUAGE, normalized);
        if (canonical?.id) {
          this.remapCanonicalId(accountId, collection, recordId, canonical.id);
          recordId = canonical.id;
        }
      } else if (collection === "preference" && row.operation === "upsert") {
        const canonical = this.db.prepare(`
          SELECT record_id FROM portable_preferences
          WHERE account_id = ? AND preference_key = ?
        `).get(accountId, String(payload.key || ""));
        if (canonical?.record_id) {
          this.remapCanonicalId(accountId, collection, recordId, canonical.record_id);
          recordId = canonical.record_id;
        }
      }

      let current = null;
      if (collection === "dictionary") {
        current = this.db.prepare(`
          SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?
        `).get(accountId, recordId);
      } else if (collection === "preference") {
        current = this.db.prepare(`
          SELECT * FROM portable_preferences WHERE account_id = ? AND record_id = ?
        `).get(accountId, recordId);
      } else {
        current = this.db.prepare(`
          SELECT * FROM desktop_synced_transcripts WHERE account_id = ? AND id = ?
        `).get(accountId, recordId);
      }
      const baseVersion = Number(current?.version || 0);
      const localVersion = baseVersion + 1;

      if (collection === "transcript" && row.operation === "upsert") {
        const previous = localLinks.get(row.record_id);
        const sourceCreatedAt =
          payload.source_created_at
          || payload.created_at
          || safeJson(previous?.metadata_json, {})?.created_at
          || previous?.source_created_at;
        if (sourceCreatedAt && !payload.source_created_at) {
          payload.source_created_at = sourceCreatedAt;
          this.db.prepare(`
            UPDATE sync_outbox SET payload_json = ?
            WHERE account_id = ? AND mutation_id = ?
          `).run(JSON.stringify(payload), accountId, row.mutation_id);
        }
        this.db.prepare(`
          INSERT INTO desktop_synced_transcripts (
            account_id, id, local_transcription_id, title, text, language, source,
            source_created_at, metadata_json, origin, version, sync_status,
            current_mutation_id, snapshot_seen
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved_local', ?, 1)
          ON CONFLICT(account_id, id) DO UPDATE SET
            local_transcription_id = COALESCE(
              desktop_synced_transcripts.local_transcription_id,
              excluded.local_transcription_id
            ),
            title = excluded.title,
            text = excluded.text,
            language = excluded.language,
            source = excluded.source,
            source_created_at = excluded.source_created_at,
            metadata_json = excluded.metadata_json,
            origin = excluded.origin,
            version = excluded.version,
            deleted_at = NULL,
            sync_status = 'saved_local',
            current_mutation_id = excluded.current_mutation_id
        `).run(
          accountId,
          recordId,
          previous?.local_transcription_id || null,
          cleanDisplayForm(payload.title).slice(0, 240),
          cleanTranscriptText(payload.text),
          payload.language || DEFAULT_LANGUAGE,
          normalizeTranscriptSource(payload.source) || "local",
          sourceCreatedAt || null,
          JSON.stringify(payload.metadata || {}),
          previous?.origin || "local",
          localVersion,
          row.mutation_id
        );
      } else if (collection === "transcript" && row.operation === "delete") {
        if (current?.local_transcription_id != null) {
          this.databaseManager.deleteSyncedTranscriptMirror?.(
            current.local_transcription_id,
            accountId
          );
        }
        if (current) {
          this.db.prepare(`
            UPDATE desktop_synced_transcripts SET
              deleted_at = CURRENT_TIMESTAMP,
              version = ?,
              sync_status = 'saved_local',
              current_mutation_id = ?,
              snapshot_seen = 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE account_id = ? AND id = ?
          `).run(localVersion, row.mutation_id, accountId, recordId);
        }
      } else if (collection === "dictionary" && row.operation === "upsert") {
        const displayForm = cleanDisplayForm(payload.display_form);
        this.db.prepare(`
          INSERT INTO desktop_dictionary_entries (
            account_id, id, normalized_key, display_form, language, replacement,
            pronunciation, context, source, version, sync_status,
            current_mutation_id, snapshot_seen
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved_local', ?, 1)
          ON CONFLICT(account_id, id) DO UPDATE SET
            normalized_key = excluded.normalized_key,
            display_form = excluded.display_form,
            language = excluded.language,
            replacement = excluded.replacement,
            pronunciation = excluded.pronunciation,
            context = excluded.context,
            source = excluded.source,
            version = excluded.version,
            deleted_at = NULL,
            sync_status = 'saved_local',
            current_mutation_id = excluded.current_mutation_id
        `).run(
          accountId,
          recordId,
          normalizeKey(displayForm),
          displayForm,
          payload.language || DEFAULT_LANGUAGE,
          payload.replacement || null,
          payload.pronunciation || null,
          payload.context || null,
          payload.source === "learned" ? "learned" : "manual",
          localVersion,
          row.mutation_id
        );
      } else if (collection === "dictionary" && row.operation === "delete") {
        if (current) {
          this.db.prepare(`
            UPDATE desktop_dictionary_entries SET
              deleted_at = CURRENT_TIMESTAMP,
              version = ?,
              sync_status = 'saved_local',
              current_mutation_id = ?,
              snapshot_seen = 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE account_id = ? AND id = ?
          `).run(localVersion, row.mutation_id, accountId, recordId);
        }
      } else if (collection === "preference" && row.operation === "upsert") {
        this.db.prepare(`
          INSERT INTO portable_preferences (
            account_id, record_id, preference_key, value_json, version,
            deleted_at, snapshot_seen
          ) VALUES (?, ?, ?, ?, ?, NULL, 1)
          ON CONFLICT(account_id, preference_key) DO UPDATE SET
            record_id = excluded.record_id,
            value_json = excluded.value_json,
            version = excluded.version,
            deleted_at = NULL,
            snapshot_seen = 1
        `).run(
          accountId,
          recordId,
          String(payload.key || ""),
          JSON.stringify(payload.value),
          localVersion
        );
      } else if (collection === "preference" && row.operation === "delete") {
        if (current) {
          this.db.prepare(`
            UPDATE portable_preferences SET
              deleted_at = CURRENT_TIMESTAMP,
              version = ?,
              snapshot_seen = 1,
              updated_at = CURRENT_TIMESTAMP
            WHERE account_id = ? AND record_id = ?
          `).run(localVersion, accountId, recordId);
        }
      }

      this.db.prepare(`
        UPDATE sync_outbox SET
          record_id = ?, base_version = ?, expected_local_version = ?,
          attempt_count = 0, next_attempt_at = 0, last_error_code = NULL
        WHERE account_id = ? AND mutation_id = ?
      `).run(recordId, baseVersion, localVersion, accountId, row.mutation_id);
    }
  }

  pause() {
    this.db.prepare("UPDATE sync_accounts SET active = 0").run();
  }

  legacyOwner() {
    return this.db.prepare("SELECT * FROM legacy_dictionary_profile WHERE singleton = 1").get() || null;
  }

  legacyRows(accountId = null) {
    const ownership = this.legacyOwner();
    if (ownership?.owner_account_id && ownership.owner_account_id !== accountId) return [];
    return this.db.prepare(`
      SELECT id, word, COALESCE(source, 'manual') AS source,
             COALESCE(updated_at, created_at, CURRENT_TIMESTAMP) AS updated_at
      FROM custom_dictionary WHERE deleted_at IS NULL ORDER BY id
    `).all();
  }

  legacyPublicEntry(row) {
    return {
      id: `legacy:${row.id}`,
      displayForm: row.word,
      normalizedKey: normalizeKey(row.word),
      language: DEFAULT_LANGUAGE,
      replacement: null,
      pronunciation: null,
      context: null,
      source: row.source === "learned" ? "learned" : "manual",
      version: 0,
      deletedAt: null,
      syncStatus: "saved_local",
      lastErrorCode: null,
      updatedAt: row.updated_at,
    };
  }

  getState() {
    const account = this.activeAccount();
    const legacy = this.legacyRows(account?.account_id || null);
    if (!account) {
      return {
        accountId: null,
        entries: legacy.map((row) => this.legacyPublicEntry(row)),
        vocabulary: legacy.map((row) => row.word),
        legacyCount: legacy.length,
        legacyAttachDecision: null,
        requiresLegacyDecision: false,
        supportedLanguages: [],
        autoDetectionSupported: false,
        portablePreferences: {},
        enabled: { dictionary: false, preferences: false, transcripts: false, audio: false },
      };
    }
    const rows = this.db.prepare(`
      SELECT * FROM desktop_dictionary_entries
      WHERE account_id = ? AND deleted_at IS NULL
      ORDER BY display_form COLLATE NOCASE
    `).all(account.account_id);
    const preferences = Object.fromEntries(this.db.prepare(`
      SELECT preference_key, value_json FROM portable_preferences
      WHERE account_id = ? AND deleted_at IS NULL
    `).all(account.account_id).map((row) => [row.preference_key, safeJson(row.value_json)]));
    return {
      accountId: account.account_id,
      entries: rows.map(publicEntry),
      vocabulary: rows.map((row) => row.display_form),
      legacyCount: legacy.length,
      legacyAttachDecision: account.legacy_attach_decision,
      requiresLegacyDecision: legacy.length > 0 && !account.legacy_attach_decision,
      supportedLanguages: safeJson(account.supported_languages_json, []),
      autoDetectionSupported: account.auto_detection_supported === 1,
      portablePreferences: preferences,
      enabled: {
        dictionary: account.dictionary_enabled === 1,
        preferences: account.preferences_enabled === 1,
        transcripts: account.transcripts_enabled === 1,
        audio: account.audio_enabled === 1,
      },
    };
  }

  queueOutbox(account, collection, recordId, operation, baseVersion, payload, localVersion) {
    const mutationId = randomUUID();
    this.db.prepare(`
      INSERT INTO sync_outbox (
        mutation_id, account_id, device_id, collection, record_id, operation,
        base_version, payload_json, expected_local_version, idempotency_key,
        outbox_sequence
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mutationId,
      account.account_id,
      account.device_id,
      collection,
      recordId,
      operation,
      Number(baseVersion || 0),
      JSON.stringify(payload || {}),
      Number(localVersion || 0),
      mutationId,
      this.nextOutboxSequence(account.account_id)
    );
    return mutationId;
  }

  setPortablePreferences(preferences) {
    const account = this.activeAccount();
    if (!account || !this.collectionEnabled(account, "preference")) return this.getState();
    const transaction = this.db.transaction(() => {
      for (const [key, value] of Object.entries(preferences || {})) {
        if (!PORTABLE_PREFERENCE_KEYS.has(key)) continue;
        const valueJson = JSON.stringify(value);
        if (Buffer.byteLength(valueJson, "utf8") > 16_384) continue;
        const current = this.db.prepare(`
          SELECT * FROM portable_preferences WHERE account_id = ? AND preference_key = ?
        `).get(account.account_id, key);
        if (current?.value_json === valueJson && !current.deleted_at) continue;
        const version = Number(current?.version || 0) + 1;
        const recordId = current?.record_id || randomUUID();
        this.db.prepare(`
          INSERT INTO portable_preferences (
            account_id, record_id, preference_key, value_json, version,
            deleted_at, snapshot_seen, updated_at
          ) VALUES (?, ?, ?, ?, ?, NULL, 1, CURRENT_TIMESTAMP)
          ON CONFLICT(account_id, preference_key) DO UPDATE SET
            record_id = COALESCE(portable_preferences.record_id, excluded.record_id),
            value_json = excluded.value_json,
            version = excluded.version,
            deleted_at = NULL,
            snapshot_seen = 1,
            updated_at = CURRENT_TIMESTAMP
        `).run(account.account_id, recordId, key, valueJson, version);
        this.queueOutbox(account, "preference", recordId, "upsert", Number(current?.version || 0), { key, value }, version);
      }
    });
    transaction();
    return this.getState();
  }

  queueDictionaryMutation(account, entry, operation, baseVersion) {
    const payload = operation === "delete" ? {} : {
      display_form: entry.display_form,
      language: entry.language,
      replacement: entry.replacement,
      pronunciation: entry.pronunciation,
      context: entry.context,
      source: entry.source,
    };
    const mutationId = this.queueOutbox(
      account,
      "dictionary",
      entry.id,
      operation,
      baseVersion,
      payload,
      entry.version
    );
    this.db.prepare(`
      UPDATE desktop_dictionary_entries
      SET current_mutation_id = ?, sync_status = 'saved_local', last_error_code = NULL
      WHERE id = ? AND account_id = ?
    `).run(mutationId, entry.id, account.account_id);
    return mutationId;
  }

  createEntry(input) {
    const account = this.activeAccount();
    const displayForm = cleanDisplayForm(input?.displayForm);
    const language = cleanDisplayForm(input?.language || DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE;
    const normalizedKey = normalizeKey(displayForm);
    if (!displayForm || !normalizedKey) throw new Error("Word is required");
    if (!account) {
      const existingWords = this.legacyRows(null).map((row) => row.word);
      const duplicate = existingWords.some((word) => normalizeKey(word) === normalizedKey);
      if (!duplicate) this.databaseManager.setDictionary([...existingWords, displayForm], input?.source);
      const entry = this.legacyRows(null).find((row) => normalizeKey(row.word) === normalizedKey);
      return { entry: entry ? this.legacyPublicEntry(entry) : null, duplicate };
    }
    const existing = this.db.prepare(`
      SELECT * FROM desktop_dictionary_entries
      WHERE account_id = ? AND language = ? AND normalized_key = ? AND deleted_at IS NULL
    `).get(account.account_id, language, normalizedKey);
    if (existing) return { entry: publicEntry(existing), duplicate: true };
    const id = randomUUID();
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO desktop_dictionary_entries (
          id, account_id, normalized_key, display_form, language, replacement,
          pronunciation, context, source, version, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'saved_local')
      `).run(
        id,
        account.account_id,
        normalizedKey,
        displayForm,
        language,
        input?.replacement || null,
        input?.pronunciation || null,
        input?.context || null,
        input?.source === "learned" ? "learned" : "manual"
      );
      const row = this.db.prepare(
        "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
      ).get(account.account_id, id);
      this.queueDictionaryMutation(account, row, "upsert", 0);
    });
    transaction();
    const row = this.db.prepare(
      "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
    ).get(account.account_id, id);
    return { entry: publicEntry(row), duplicate: false };
  }

  updateEntry(id, input) {
    if (String(id).startsWith("legacy:")) {
      const account = this.activeAccount();
      const legacyId = Number(String(id).slice(7));
      const displayForm = cleanDisplayForm(input?.displayForm);
      if (!account || !this.legacyRows(account.account_id).some((row) => row.id === legacyId)) {
        throw new Error("Dictionary entry not found");
      }
      if (!Number.isInteger(legacyId) || !displayForm) throw new Error("Invalid dictionary entry");
      this.db.prepare(`UPDATE custom_dictionary SET word = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL`).run(displayForm, legacyId);
      return this.legacyPublicEntry(this.legacyRows(account.account_id).find((row) => row.id === legacyId));
    }
    const account = this.activeAccount();
    if (!account) throw new Error("No active sync account");
    const current = this.db.prepare(
      "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
    ).get(account.account_id, id);
    if (!current || current.deleted_at) throw new Error("Dictionary entry not found");
    const displayForm = cleanDisplayForm(input?.displayForm ?? current.display_form);
    const language = cleanDisplayForm(input?.language ?? current.language) || DEFAULT_LANGUAGE;
    const normalizedKey = normalizeKey(displayForm);
    const nextVersion = Number(current.version) + 1;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE desktop_dictionary_entries SET
          normalized_key = ?, display_form = ?, language = ?, replacement = ?,
          pronunciation = ?, context = ?, source = ?, version = ?,
          updated_at = CURRENT_TIMESTAMP, deleted_at = NULL
        WHERE account_id = ? AND id = ?
      `).run(
        normalizedKey,
        displayForm,
        language,
        input?.replacement ?? current.replacement,
        input?.pronunciation ?? current.pronunciation,
        input?.context ?? current.context,
        input?.source ?? current.source,
        nextVersion,
        account.account_id,
        id
      );
      const row = this.db.prepare(
        "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
      ).get(account.account_id, id);
      this.queueDictionaryMutation(account, row, "upsert", Number(current.version));
    });
    transaction();
    return publicEntry(this.db.prepare(
      "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
    ).get(account.account_id, id));
  }

  deleteEntry(id) {
    if (String(id).startsWith("legacy:")) {
      const account = this.activeAccount();
      const legacyId = Number(String(id).slice(7));
      if (!account || !this.legacyRows(account.account_id).some((row) => row.id === legacyId)) return false;
      return this.db.prepare("DELETE FROM custom_dictionary WHERE id = ?").run(legacyId).changes > 0;
    }
    const account = this.activeAccount();
    if (!account) throw new Error("No active sync account");
    const current = this.db.prepare(
      "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
    ).get(account.account_id, id);
    if (!current || current.deleted_at) return false;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE desktop_dictionary_entries
        SET deleted_at = CURRENT_TIMESTAMP, version = version + 1,
            updated_at = CURRENT_TIMESTAMP, sync_status = 'saved_local'
        WHERE account_id = ? AND id = ?
      `).run(account.account_id, id);
      const row = this.db.prepare(
        "SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?"
      ).get(account.account_id, id);
      this.queueDictionaryMutation(account, row, "delete", Number(current.version));
    });
    transaction();
    return true;
  }

  replaceVocabulary(words, source = "manual") {
    const account = this.activeAccount();
    if (!account) return this.databaseManager.setDictionary(words, source);
    const desired = new Map();
    for (const value of Array.isArray(words) ? words : []) {
      const displayForm = cleanDisplayForm(value);
      const key = normalizeKey(displayForm);
      if (key) desired.set(`${DEFAULT_LANGUAGE}:${key}`, displayForm);
    }
    const current = this.db.prepare(`
      SELECT * FROM desktop_dictionary_entries WHERE account_id = ? AND deleted_at IS NULL
    `).all(account.account_id);
    for (const row of current) {
      if (!desired.has(`${row.language}:${row.normalized_key}`)) this.deleteEntry(row.id);
      else desired.delete(`${row.language}:${row.normalized_key}`);
    }
    for (const displayForm of desired.values()) this.createEntry({ displayForm, language: DEFAULT_LANGUAGE, source });
    return { success: true, entries: this.getState().entries };
  }

  decideLegacyAttachment(decision) {
    const account = this.activeAccount();
    if (!account) throw new Error("No active sync account");
    if (!["attach", "keep_local"].includes(decision)) throw new Error("Invalid legacy decision");
    const owner = this.legacyOwner();
    if (owner?.owner_account_id && owner.owner_account_id !== account.account_id) {
      throw new Error("Legacy dictionary already belongs to another local account profile");
    }
    const rows = this.legacyRows(account.account_id);
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO legacy_dictionary_profile (singleton, owner_account_id, decision, decided_at)
        VALUES (1, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(singleton) DO UPDATE SET
          owner_account_id = COALESCE(legacy_dictionary_profile.owner_account_id, excluded.owner_account_id),
          decision = excluded.decision,
          decided_at = CURRENT_TIMESTAMP
      `).run(account.account_id, decision);
      if (decision === "attach") {
        for (const row of rows) this.createEntry({
          displayForm: row.word,
          language: DEFAULT_LANGUAGE,
          source: row.source,
        });
      }
      this.db.prepare("UPDATE sync_accounts SET legacy_attach_decision = ? WHERE account_id = ?")
        .run(decision === "attach" ? "attached" : "keep_local", account.account_id);
    });
    transaction();
    return this.getState();
  }

  captureLocalTranscript(transcription, options = {}) {
    const account = this.activeAccount();
    const source = normalizeTranscriptSource(options.syncSource || options.provider || transcription?.provider);
    const text = cleanTranscriptText(transcription?.text);
    if (!account || !this.collectionEnabled(account, "transcript") || !source || !text) return null;
    if (String(transcription?.status || "completed") !== "completed") return null;
    const recordId = String(transcription?.client_transcription_id || randomUUID());
    const existing = this.db.prepare(`
      SELECT * FROM desktop_synced_transcripts WHERE account_id = ? AND id = ?
    `).get(account.account_id, recordId);
    if (existing) return existing;
    const sourceDateCandidate =
      options.sourceCreatedAt
      || transcription.timestamp
      || transcription.created_at
      || new Date().toISOString();
    const sourceCreatedAt = new Date(sourceDateCandidate);
    const consentStartedAt = new Date(account.transcripts_enabled_at || "");
    if (
      !Number.isFinite(sourceCreatedAt.getTime())
      || !Number.isFinite(consentStartedAt.getTime())
      || sourceCreatedAt < consentStartedAt
    ) {
      return null;
    }
    const sourceCreatedAtIso = sourceCreatedAt.toISOString();
    const metadata = {
      local_transcription_id: transcription.id,
      created_at: sourceCreatedAtIso,
      duration_ms: options.audioDurationMs ?? transcription.audio_duration_ms ?? null,
      provider: options.provider || transcription.provider || null,
      model: options.model || transcription.model || null,
      route_kind: options.routeKind || transcription.route_kind || null,
    };
    const title = cleanDisplayForm(options.title || text.split(/\s+/u).slice(0, 10).join(" ")).slice(0, 240);
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO desktop_synced_transcripts (
          account_id, id, local_transcription_id, title, text, language, source,
          source_created_at, metadata_json, origin, version, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'local', 1, 'saved_local')
      `).run(
        account.account_id,
        recordId,
        transcription.id,
        title,
        text,
        cleanDisplayForm(options.language || "und") || "und",
        source,
        sourceCreatedAtIso,
        JSON.stringify(metadata)
      );
      const mutationId = this.queueOutbox(account, "transcript", recordId, "upsert", 0, {
        title,
        text,
        language: cleanDisplayForm(options.language || "und") || "und",
        source,
        source_created_at: sourceCreatedAtIso,
        metadata,
      }, 1);
      this.db.prepare(`
        UPDATE desktop_synced_transcripts SET current_mutation_id = ?
        WHERE account_id = ? AND id = ?
      `).run(mutationId, account.account_id, recordId);
      this.databaseManager.linkLocalTranscriptionToSync?.(
        transcription.id,
        account.account_id,
        recordId,
        1,
        source
      );
    });
    transaction();
    return this.db.prepare(`
      SELECT * FROM desktop_synced_transcripts WHERE account_id = ? AND id = ?
    `).get(account.account_id, recordId);
  }

  updateLocalTranscript(localTranscriptionId, transcription) {
    const account = this.activeAccount();
    if (!account || !this.collectionEnabled(account, "transcript")) return null;
    const current = this.db.prepare(`
      SELECT * FROM desktop_synced_transcripts
      WHERE account_id = ? AND local_transcription_id = ? AND deleted_at IS NULL
    `).get(account.account_id, localTranscriptionId);
    if (!current) return null;
    const text = cleanTranscriptText(transcription?.text);
    if (!text || text === current.text) return current;
    const version = Number(current.version) + 1;
    const metadata = safeJson(current.metadata_json, {});
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE desktop_synced_transcripts
        SET text = ?, version = ?, sync_status = 'saved_local', updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ? AND id = ?
      `).run(text, version, account.account_id, current.id);
      const mutationId = this.queueOutbox(account, "transcript", current.id, "upsert", Number(current.version), {
        title: current.title,
        text,
        language: current.language,
        source: current.source,
        source_created_at: current.source_created_at,
        metadata,
      }, version);
      this.db.prepare(`UPDATE desktop_synced_transcripts SET current_mutation_id = ?
        WHERE account_id = ? AND id = ?`).run(mutationId, account.account_id, current.id);
    });
    transaction();
    return true;
  }

  deleteLocalTranscript(localTranscriptionId) {
    const account = this.activeAccount();
    if (!account) return false;
    const current = this.db.prepare(`
      SELECT * FROM desktop_synced_transcripts
      WHERE account_id = ? AND local_transcription_id = ? AND deleted_at IS NULL
    `).get(account.account_id, localTranscriptionId);
    if (!current) return false;
    const version = Number(current.version) + 1;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`
        UPDATE desktop_synced_transcripts
        SET deleted_at = CURRENT_TIMESTAMP, version = ?, sync_status = 'saved_local',
            updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ? AND id = ?
      `).run(version, account.account_id, current.id);
      if (this.collectionEnabled(account, "transcript")) {
        const mutationId = this.queueOutbox(account, "transcript", current.id, "delete", Number(current.version), {}, version);
        this.db.prepare(`UPDATE desktop_synced_transcripts SET current_mutation_id = ?
          WHERE account_id = ? AND id = ?`).run(mutationId, account.account_id, current.id);
      }
    });
    transaction();
    return true;
  }

  deleteAllLocalTranscripts() {
    const account = this.activeAccount();
    if (!account) return;
    const rows = this.db.prepare(`
      SELECT local_transcription_id FROM desktop_synced_transcripts
      WHERE account_id = ? AND deleted_at IS NULL
    `).all(account.account_id);
    for (const row of rows) if (row.local_transcription_id != null) this.deleteLocalTranscript(row.local_transcription_id);
  }

  prepareMutationBatch(limit = MAX_BATCH) {
    const account = this.activeAccount();
    if (!account) return null;
    this.quarantineDisabledCollections(account.account_id);
    const enabledCollections = Object.keys(COLLECTION_FLAG)
      .filter((collection) => this.collectionEnabled(account, collection));
    if (!enabledCollections.length) return null;
    const placeholders = enabledCollections.map(() => "?").join(",");
    const row = this.db.prepare(`
      SELECT * FROM sync_outbox
      WHERE account_id = ? AND dead_lettered_at IS NULL
        AND collection IN (${placeholders})
      ORDER BY outbox_sequence LIMIT 1
    `).get(account.account_id, ...enabledCollections);
    if (!row || Number(row.next_attempt_at) > Date.now()) return null;
    if (row.collection === "dictionary") {
      this.db.prepare(`UPDATE desktop_dictionary_entries SET sync_status = 'syncing'
        WHERE account_id = ? AND id = ? AND current_mutation_id = ?`)
        .run(account.account_id, row.record_id, row.mutation_id);
    } else if (row.collection === "transcript") {
      this.db.prepare(`UPDATE desktop_synced_transcripts SET sync_status = 'syncing'
        WHERE account_id = ? AND id = ? AND current_mutation_id = ?`)
        .run(account.account_id, row.record_id, row.mutation_id);
    }
    return {
      accountId: account.account_id,
      idempotencyKey: row.idempotency_key,
      payload: {
        schema_version: Number(account.schema_version || 1),
        base_cursor: this.getCursor(account.account_id),
        mutations: [{
          mutation_id: row.mutation_id,
          collection: row.collection,
          record_id: row.record_id,
          operation: row.operation,
          base_version: Number(row.base_version),
          payload: safeJson(row.payload_json, {}),
        }],
      },
    };
  }

  remapCanonicalId(accountId, collection, oldId, newId) {
    if (!newId || oldId === newId) return oldId;
    if (collection === "dictionary") {
      const source = this.db.prepare(`SELECT * FROM desktop_dictionary_entries
        WHERE account_id = ? AND id = ?`).get(accountId, oldId);
      const target = this.db.prepare(`SELECT * FROM desktop_dictionary_entries
        WHERE account_id = ? AND id = ?`).get(accountId, newId);
      if (source && !target) {
        this.db.prepare(`UPDATE desktop_dictionary_entries SET id = ?
          WHERE account_id = ? AND id = ?`).run(newId, accountId, oldId);
      } else if (source && target) {
        this.db.prepare(`UPDATE desktop_dictionary_entries SET
          normalized_key = ?, display_form = ?, language = ?, replacement = ?,
          pronunciation = ?, context = ?, source = ?, version = ?, deleted_at = ?,
          sync_status = ?, current_mutation_id = ?, last_error_code = ?, updated_at = CURRENT_TIMESTAMP
          WHERE account_id = ? AND id = ?`).run(
          source.normalized_key,
          source.display_form,
          source.language,
          source.replacement,
          source.pronunciation,
          source.context,
          source.source,
          source.version,
          source.deleted_at,
          source.sync_status,
          source.current_mutation_id,
          source.last_error_code,
          accountId,
          newId
        );
        this.db.prepare("DELETE FROM desktop_dictionary_entries WHERE account_id = ? AND id = ?")
          .run(accountId, oldId);
      }
    } else if (collection === "preference") {
      this.db.prepare(`UPDATE portable_preferences SET record_id = ?
        WHERE account_id = ? AND record_id = ?`).run(newId, accountId, oldId);
    } else if (collection === "transcript") {
      const target = this.db.prepare(`SELECT id FROM desktop_synced_transcripts
        WHERE account_id = ? AND id = ?`).get(accountId, newId);
      if (!target) this.db.prepare(`UPDATE desktop_synced_transcripts SET id = ?
        WHERE account_id = ? AND id = ?`).run(newId, accountId, oldId);
      else this.db.prepare("DELETE FROM desktop_synced_transcripts WHERE account_id = ? AND id = ?")
        .run(accountId, oldId);
      this.databaseManager.remapSyncedTranscriptMirror?.(accountId, oldId, newId);
    }
    this.db.prepare(`UPDATE sync_outbox SET record_id = ?
      WHERE account_id = ? AND collection = ? AND record_id = ?`).run(newId, accountId, collection, oldId);
    return newId;
  }

  applyMutationResponse(response, batch = null, expectedAccountId = batch?.accountId) {
    const account = this.activeAccount();
    if (!account || !expectedAccountId || account.account_id !== expectedAccountId) return false;
    const results = Array.isArray(response?.results) ? response.results : [];
    const transaction = this.db.transaction(() => {
      for (const result of results) {
        const outbox = this.db.prepare(`SELECT * FROM sync_outbox
          WHERE mutation_id = ? AND account_id = ?`).get(result.mutation_id, expectedAccountId);
        if (!outbox) continue;
        const canonicalId = String(result.record_id || result.current?.id || outbox.record_id);
        this.remapCanonicalId(expectedAccountId, outbox.collection, outbox.record_id, canonicalId);
        const applied = ["applied", "unchanged", "replayed"].includes(result.status)
          || (result.status === "not_found" && outbox.operation === "delete");
        if (applied) {
          const version = Number(result.version ?? result.record?.version ?? outbox.expected_local_version);
          if (outbox.collection === "dictionary") {
            this.db.prepare(`UPDATE desktop_dictionary_entries
              SET version = MAX(version, ?), sync_status = 'synced', current_mutation_id = NULL,
                  last_error_code = NULL, snapshot_seen = 1
              WHERE account_id = ? AND id = ? AND current_mutation_id = ?`)
              .run(version, expectedAccountId, canonicalId, outbox.mutation_id);
          } else if (outbox.collection === "preference") {
            this.db.prepare(`UPDATE portable_preferences SET version = MAX(version, ?), snapshot_seen = 1
              WHERE account_id = ? AND record_id = ?`).run(version, expectedAccountId, canonicalId);
          } else if (outbox.collection === "transcript") {
            this.db.prepare(`UPDATE desktop_synced_transcripts
              SET version = MAX(version, ?), sync_status = 'synced', current_mutation_id = NULL,
                  last_error_code = NULL, snapshot_seen = 1
              WHERE account_id = ? AND id = ? AND current_mutation_id = ?`)
              .run(version, expectedAccountId, canonicalId, outbox.mutation_id);
            this.databaseManager.updateSyncedTranscriptVersion?.(expectedAccountId, canonicalId, version);
          }
          this.db.prepare("DELETE FROM sync_outbox WHERE mutation_id = ? AND account_id = ?")
            .run(outbox.mutation_id, expectedAccountId);
          continue;
        }
        if (result.status !== "conflict") continue;
        const serverVersion = Number(
          result.current?.version ?? result.current_version ?? result.server_version ?? result.version
        );
        if (!Number.isFinite(serverVersion) || serverVersion < 0) {
          this.deadLetter(outbox, "SYNC_VERSION_CONFLICT");
          continue;
        }
        const nextMutationId = randomUUID();
        this.db.prepare(`
          INSERT INTO sync_outbox (
            mutation_id, account_id, device_id, collection, record_id, operation,
            base_version, payload_json, expected_local_version, idempotency_key,
            outbox_sequence
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          nextMutationId,
          expectedAccountId,
          outbox.device_id,
          outbox.collection,
          canonicalId,
          outbox.operation,
          serverVersion,
          outbox.payload_json,
          outbox.expected_local_version,
          nextMutationId,
          this.nextOutboxSequence(expectedAccountId)
        );
        const table = outbox.collection === "dictionary"
          ? "desktop_dictionary_entries"
          : outbox.collection === "transcript" ? "desktop_synced_transcripts" : null;
        if (table) this.db.prepare(`UPDATE ${table}
          SET current_mutation_id = ?, sync_status = 'saved_local', last_error_code = NULL
          WHERE account_id = ? AND id = ? AND current_mutation_id = ?`)
          .run(nextMutationId, expectedAccountId, canonicalId, outbox.mutation_id);
        this.db.prepare("DELETE FROM sync_outbox WHERE mutation_id = ? AND account_id = ?")
          .run(outbox.mutation_id, expectedAccountId);
      }
    });
    transaction();
    return true;
  }

  deadLetter(outbox, code) {
    this.db.prepare(`UPDATE sync_outbox SET dead_lettered_at = CURRENT_TIMESTAMP,
      last_error_code = ? WHERE mutation_id = ? AND account_id = ?`)
      .run(code, outbox.mutation_id, outbox.account_id);
    const table = outbox.collection === "dictionary"
      ? "desktop_dictionary_entries"
      : outbox.collection === "transcript" ? "desktop_synced_transcripts" : null;
    if (table) this.db.prepare(`UPDATE ${table} SET sync_status = 'error', last_error_code = ?
      WHERE account_id = ? AND id = ? AND current_mutation_id = ?`)
      .run(code, outbox.account_id, outbox.record_id, outbox.mutation_id);
  }

  markBatchFailure(batch, error) {
    if (!batch) return;
    const status = Number(error?.status || 0);
    const isAuthPause = status === 401;
    const retryable = RETRYABLE_STATUS.has(status) || (!status && !isAuthPause);
    const retryAfter = Number(error?.retryAfterSeconds || 0) * 1000;
    const transaction = this.db.transaction(() => {
      for (const mutation of batch.payload.mutations) {
        const outbox = this.db.prepare(`SELECT * FROM sync_outbox
          WHERE mutation_id = ? AND account_id = ?`).get(mutation.mutation_id, batch.accountId);
        if (!outbox) continue;
        if (isAuthPause) {
          this.db.prepare(`UPDATE sync_outbox SET last_error_code = 'AUTH_EXPIRED', next_attempt_at = 0
            WHERE mutation_id = ? AND account_id = ?`).run(outbox.mutation_id, batch.accountId);
          continue;
        }
        const attempt = Number(outbox.attempt_count || 0) + 1;
        if (!retryable) {
          this.deadLetter(outbox, error?.code || "SYNC_FAILED");
          continue;
        }
        const delay = Math.max(retryAfter, Math.min(15 * 60_000, 1000 * 2 ** Math.min(attempt, 9)));
        this.db.prepare(`UPDATE sync_outbox SET attempt_count = ?, next_attempt_at = ?,
          last_error_code = ?, dead_lettered_at = NULL
          WHERE mutation_id = ? AND account_id = ?`).run(
          attempt,
          Date.now() + delay + Math.floor(Math.random() * 750),
          error?.code || "SYNC_FAILED",
          outbox.mutation_id,
          batch.accountId
        );
      }
    });
    transaction();
  }

  setCursor(accountId, cursor) {
    this.db.prepare(`
      INSERT INTO sync_state (account_id, collection, cursor, last_success_at, last_error_code)
      VALUES (?, 'account', ?, CURRENT_TIMESTAMP, NULL)
      ON CONFLICT(account_id, collection) DO UPDATE SET
        cursor = excluded.cursor, last_success_at = CURRENT_TIMESTAMP, last_error_code = NULL
    `).run(accountId, cursor || null);
  }

  getCursor(accountId = null) {
    const expected = accountId || this.activeAccount()?.account_id;
    if (!expected) return null;
    return this.db.prepare(`SELECT cursor FROM sync_state
      WHERE account_id = ? AND collection = 'account'`).get(expected)?.cursor || null;
  }

  beginSnapshotReconciliation(accountId) {
    const account = this.activeAccount();
    if (!account || account.account_id !== accountId) return false;
    const transaction = this.db.transaction(() => {
      this.db.prepare(`UPDATE desktop_dictionary_entries SET snapshot_seen = 0
        WHERE account_id = ? AND sync_status = 'synced' AND current_mutation_id IS NULL`).run(accountId);
      this.db.prepare(`UPDATE portable_preferences SET snapshot_seen = 0
        WHERE account_id = ? AND NOT EXISTS (
          SELECT 1 FROM sync_outbox o WHERE o.account_id = portable_preferences.account_id
            AND o.collection = 'preference' AND o.record_id = portable_preferences.record_id
        )`).run(accountId);
      this.db.prepare(`UPDATE desktop_synced_transcripts SET snapshot_seen = 0
        WHERE account_id = ? AND sync_status = 'synced' AND current_mutation_id IS NULL`).run(accountId);
    });
    transaction();
    return true;
  }

  completeSnapshotReconciliation(accountId) {
    const account = this.activeAccount();
    if (!account || account.account_id !== accountId) return false;
    const staleTranscripts = this.db.prepare(`SELECT local_transcription_id FROM desktop_synced_transcripts
      WHERE account_id = ? AND snapshot_seen = 0 AND current_mutation_id IS NULL`).all(accountId);
    const transaction = this.db.transaction(() => {
      this.db.prepare(`DELETE FROM desktop_dictionary_entries
        WHERE account_id = ? AND snapshot_seen = 0 AND current_mutation_id IS NULL`).run(accountId);
      this.db.prepare(`DELETE FROM portable_preferences
        WHERE account_id = ? AND snapshot_seen = 0 AND NOT EXISTS (
          SELECT 1 FROM sync_outbox o WHERE o.account_id = portable_preferences.account_id
            AND o.collection = 'preference' AND o.record_id = portable_preferences.record_id
        )`).run(accountId);
      this.db.prepare(`DELETE FROM desktop_synced_transcripts
        WHERE account_id = ? AND snapshot_seen = 0 AND current_mutation_id IS NULL`).run(accountId);
    });
    transaction();
    for (const row of staleTranscripts) {
      if (row.local_transcription_id != null) {
        this.databaseManager.deleteSyncedTranscriptMirror?.(row.local_transcription_id, accountId);
      }
    }
    return true;
  }

  applyPreferenceChange(accountId, change) {
    const id = String(change.record_id || "");
    if (!id) return;
    if (change.operation === "delete") {
      this.db.prepare(`DELETE FROM portable_preferences
        WHERE account_id = ? AND record_id = ?`).run(accountId, id);
      return;
    }
    const payload = change.payload || {};
    const key = String(payload.key || "");
    if (!PORTABLE_PREFERENCE_KEYS.has(key)) return;
    this.db.prepare(`
      INSERT INTO portable_preferences (
        account_id, record_id, preference_key, value_json, version,
        deleted_at, snapshot_seen, updated_at
      ) VALUES (?, ?, ?, ?, ?, NULL, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(account_id, preference_key) DO UPDATE SET
        record_id = excluded.record_id,
        value_json = excluded.value_json,
        version = excluded.version,
        deleted_at = NULL,
        snapshot_seen = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(accountId, id, key, JSON.stringify(payload.value), Number(change.version || 0));
  }

  applyDictionaryChange(accountId, change) {
    const id = String(change.record_id || "");
    if (!id) return;
    const local = this.db.prepare(`SELECT * FROM desktop_dictionary_entries
      WHERE account_id = ? AND id = ?`).get(accountId, id);
    const serverVersion = Number(change.version || 0);
    if (local?.current_mutation_id) {
      if (serverVersion > Number(local.version)) this.db.prepare(`UPDATE desktop_dictionary_entries
        SET sync_status = 'conflict', last_error_code = 'SYNC_VERSION_CONFLICT', snapshot_seen = 1
        WHERE account_id = ? AND id = ?`).run(accountId, id);
      return;
    }
    if (change.operation === "delete") {
      if (local) this.db.prepare(`UPDATE desktop_dictionary_entries
        SET deleted_at = CURRENT_TIMESTAMP, version = ?, sync_status = 'synced',
            snapshot_seen = 1, updated_at = CURRENT_TIMESTAMP
        WHERE account_id = ? AND id = ?`).run(serverVersion, accountId, id);
      return;
    }
    if (local && Number(local.version) > serverVersion) return;
    const payload = change.payload || {};
    const displayForm = cleanDisplayForm(payload.display_form);
    if (!displayForm) return;
    this.db.prepare(`
      INSERT INTO desktop_dictionary_entries (
        id, account_id, normalized_key, display_form, language, replacement,
        pronunciation, context, source, version, sync_status, snapshot_seen, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', 1, CURRENT_TIMESTAMP)
      ON CONFLICT(account_id, id) DO UPDATE SET
        normalized_key = excluded.normalized_key,
        display_form = excluded.display_form,
        language = excluded.language,
        replacement = excluded.replacement,
        pronunciation = excluded.pronunciation,
        context = excluded.context,
        source = excluded.source,
        version = excluded.version,
        deleted_at = NULL,
        sync_status = 'synced',
        current_mutation_id = NULL,
        last_error_code = NULL,
        snapshot_seen = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      id,
      accountId,
      normalizeKey(displayForm),
      displayForm,
      payload.language || DEFAULT_LANGUAGE,
      payload.replacement || null,
      payload.pronunciation || null,
      payload.context || null,
      payload.source === "learned" ? "learned" : "manual",
      serverVersion
    );
  }

  applyTranscriptChange(accountId, change) {
    const id = String(change.record_id || "");
    if (!id) return;
    const current = this.db.prepare(`SELECT * FROM desktop_synced_transcripts
      WHERE account_id = ? AND id = ?`).get(accountId, id);
    const version = Number(change.version || 0);
    if (current?.current_mutation_id) {
      if (version > Number(current.version)) this.db.prepare(`UPDATE desktop_synced_transcripts
        SET sync_status = 'conflict', last_error_code = 'SYNC_VERSION_CONFLICT', snapshot_seen = 1
        WHERE account_id = ? AND id = ?`).run(accountId, id);
      return;
    }
    if (change.operation === "delete") {
      if (current?.local_transcription_id != null) {
        this.databaseManager.deleteSyncedTranscriptMirror?.(current.local_transcription_id, accountId);
      }
      this.db.prepare("DELETE FROM desktop_synced_transcripts WHERE account_id = ? AND id = ?")
        .run(accountId, id);
      return;
    }
    const payload = change.payload || {};
    const source = normalizeTranscriptSource(payload.source);
    const text = cleanTranscriptText(payload.text);
    if (!source || !text) return;
    const mirror = this.databaseManager.upsertSyncedTranscriptMirror?.(accountId, {
      id,
      version,
      title: cleanDisplayForm(payload.title).slice(0, 240),
      text,
      language: cleanDisplayForm(payload.language || DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE,
      source,
      sourceCreatedAt: payload.source_created_at,
      metadata: payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {},
      updatedAt: change.changed_at || payload.updated_at || null,
    });
    this.db.prepare(`
      INSERT INTO desktop_synced_transcripts (
        account_id, id, local_transcription_id, title, text, language, source,
        source_created_at, metadata_json, origin, version, sync_status,
        snapshot_seen, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced', 1, CURRENT_TIMESTAMP)
      ON CONFLICT(account_id, id) DO UPDATE SET
        local_transcription_id = COALESCE(desktop_synced_transcripts.local_transcription_id, excluded.local_transcription_id),
        title = excluded.title,
        text = excluded.text,
        language = excluded.language,
        source = excluded.source,
        source_created_at = excluded.source_created_at,
        metadata_json = excluded.metadata_json,
        version = excluded.version,
        deleted_at = NULL,
        sync_status = 'synced',
        current_mutation_id = NULL,
        last_error_code = NULL,
        snapshot_seen = 1,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      accountId,
      id,
      mirror?.id ?? current?.local_transcription_id ?? null,
      cleanDisplayForm(payload.title).slice(0, 240),
      text,
      cleanDisplayForm(payload.language || DEFAULT_LANGUAGE) || DEFAULT_LANGUAGE,
      source,
      payload.source_created_at || null,
      JSON.stringify(payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}),
      current?.origin || "remote",
      version
    );
  }

  applyChanges(response, expectedAccountId) {
    const account = this.activeAccount();
    if (!account || !expectedAccountId || account.account_id !== expectedAccountId) return false;
    const changes = Array.isArray(response?.changes) ? response.changes : [];
    const transaction = this.db.transaction(() => {
      for (const change of changes) {
        if (!this.collectionEnabled(account, change.collection)) continue;
        if (change.collection === "preference") this.applyPreferenceChange(expectedAccountId, change);
        else if (change.collection === "dictionary") this.applyDictionaryChange(expectedAccountId, change);
        else if (change.collection === "transcript") this.applyTranscriptChange(expectedAccountId, change);
      }
      if (response?.next_cursor) this.setCursor(expectedAccountId, response.next_cursor);
    });
    transaction();
    return true;
  }
}

module.exports = DesktopSyncStore;
module.exports.cleanDisplayForm = cleanDisplayForm;
module.exports.cleanTranscriptText = cleanTranscriptText;
module.exports.normalizeKey = normalizeKey;
module.exports.normalizeTranscriptSource = normalizeTranscriptSource;
