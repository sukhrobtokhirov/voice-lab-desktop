const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const secretCrypto = require("./secretCrypto");
const {
  LocalDataCorruptionError,
  LocalDataCrypto,
} = require("./localDataCrypto");

const WAV_ENCRYPTED_SUFFIX = ".wav.enc";
const LEGACY_WEBM_ENCRYPTED_SUFFIX = ".webm.enc";
const MANIFEST_NAME = "audio-index.v1.enc";
const JOURNAL_NAME = "audio-journal.v1.enc";
const MANIFEST_CONTEXT = {
  table: "audio_manifest",
  row: "singleton",
  field: "records",
};
const JOURNAL_CONTEXT = {
  table: "audio_journal",
  row: "singleton",
  field: "operation",
};

function atomicWrite(target, contents) {
  const temporary = `${target}.tmp-${process.pid}-${crypto.randomBytes(6).toString("hex")}`;
  fs.writeFileSync(temporary, contents, { mode: 0o600 });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}

class AudioStorageManager {
  constructor({
    userDataPath = app.getPath("userData"),
    tempPath = app.getPath("temp"),
    cryptoService = null,
    faultInjector = null,
  } = {}) {
    this.audioDir = path.join(userDataPath, "audio");
    this.playbackDir = path.join(tempPath, "voicelab-audio-playback");
    this.manifestPath = path.join(this.audioDir, MANIFEST_NAME);
    this.journalPath = path.join(this.audioDir, JOURNAL_NAME);
    this.crypto =
      cryptoService || LocalDataCrypto.forUserDataPath(userDataPath);
    this.playbackPaths = new Map();
    this.faultInjector = faultInjector;
    this.ensureAudioDir();
    this.manifest = this._loadManifest();
    this._recoverJournal();
    this._cleanupPendingFiles();
    this._migrateLegacyAudio();
  }

  ensureAudioDir() {
    fs.mkdirSync(this.audioDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.audioDir, 0o700);
    fs.rmSync(this.playbackDir, { recursive: true, force: true });
    fs.mkdirSync(this.playbackDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.playbackDir, 0o700);
  }

  _emptyManifest() {
    return { format: 1, records: {} };
  }

  _loadManifest() {
    if (!fs.existsSync(this.manifestPath)) return this._emptyManifest();
    fs.chmodSync(this.manifestPath, 0o600);
    try {
      const clear = this.crypto.decryptBytes(
        fs.readFileSync(this.manifestPath),
        MANIFEST_CONTEXT
      );
      const parsed = JSON.parse(clear.toString("utf8"));
      if (parsed?.format !== 1 || !parsed.records || typeof parsed.records !== "object") {
        throw new Error("invalid manifest shape");
      }
      return parsed;
    } catch (error) {
      throw new LocalDataCorruptionError("Encrypted audio manifest is corrupted", error);
    }
  }

  _saveManifest() {
    const encrypted = this.crypto.encryptBytes(
      Buffer.from(JSON.stringify(this.manifest), "utf8"),
      MANIFEST_CONTEXT
    );
    atomicWrite(this.manifestPath, encrypted);
  }

  _checkpoint(name) {
    this.faultInjector?.(name);
  }

  _loadJournal() {
    if (!fs.existsSync(this.journalPath)) return null;
    try {
      return JSON.parse(
        this.crypto.decryptBytes(fs.readFileSync(this.journalPath), JOURNAL_CONTEXT).toString("utf8")
      );
    } catch (error) {
      throw new LocalDataCorruptionError("Encrypted audio journal is corrupted", error);
    }
  }

  _saveJournal(journal) {
    atomicWrite(
      this.journalPath,
      this.crypto.encryptBytes(Buffer.from(JSON.stringify(journal), "utf8"), JOURNAL_CONTEXT)
    );
  }

  _clearJournal() {
    fs.rmSync(this.journalPath, { force: true });
  }

  _pendingFilename(finalName) {
    return `${finalName}.pending`;
  }

  _verifyEncryptedFile(target, transcriptionId, expected = null) {
    const plaintext = this.crypto.decryptBytes(fs.readFileSync(target), {
      table: "audio",
      row: String(transcriptionId),
      field: "contents",
    });
    if (expected && !crypto.timingSafeEqual(plaintext, expected)) {
      throw new LocalDataCorruptionError("Encrypted audio replacement verification failed");
    }
    return plaintext;
  }

  _recoverJournal() {
    const journal = this._loadJournal();
    if (!journal) return;
    const pendingPath = path.join(this.audioDir, path.basename(journal.pending_file));
    const finalPath = path.join(this.audioDir, path.basename(journal.new_record.file));
    if (!fs.existsSync(finalPath) && fs.existsSync(pendingPath)) {
      fs.renameSync(pendingPath, finalPath);
      fs.chmodSync(finalPath, 0o600);
    }
    if (!fs.existsSync(finalPath)) {
      this._clearJournal();
      return;
    }
    this._verifyEncryptedFile(finalPath, journal.transcription_id);
    this.manifest.records[String(journal.transcription_id)] = journal.new_record;
    this._saveManifest();
    if (journal.old_file && journal.old_file !== journal.new_record.file) {
      fs.rmSync(path.join(this.audioDir, path.basename(journal.old_file)), { force: true });
    }
    if (journal.legacy_source) {
      fs.rmSync(path.join(this.audioDir, path.basename(journal.legacy_source)), { force: true });
    }
    this._clearJournal();
  }

  _cleanupPendingFiles() {
    for (const filename of fs.readdirSync(this.audioDir)) {
      if (filename.endsWith(".pending")) {
        fs.rmSync(path.join(this.audioDir, filename), { force: true });
      }
    }
  }

  _commitReplacement(id, plaintext, record, { oldFile = null, legacySource = null } = {}) {
    const pendingName = this._pendingFilename(record.file);
    const pendingPath = path.join(this.audioDir, pendingName);
    const finalPath = path.join(this.audioDir, record.file);
    atomicWrite(
      pendingPath,
      this.crypto.encryptBytes(plaintext, {
        table: "audio",
        row: String(id),
        field: "contents",
      })
    );
    this._verifyEncryptedFile(pendingPath, id, plaintext);
    this._checkpoint("replacement_authenticated");
    this._saveJournal({
      format: 1,
      transcription_id: String(id),
      pending_file: pendingName,
      new_record: record,
      old_file: oldFile,
      legacy_source: legacySource,
    });
    this._checkpoint("journal_persisted");
    fs.renameSync(pendingPath, finalPath);
    fs.chmodSync(finalPath, 0o600);
    this._checkpoint("replacement_promoted");
    this.manifest.records[String(id)] = record;
    this._saveManifest();
    this._checkpoint("manifest_persisted");
    if (oldFile && oldFile !== record.file) {
      fs.rmSync(path.join(this.audioDir, path.basename(oldFile)), { force: true });
    }
    if (legacySource) {
      fs.rmSync(path.join(this.audioDir, path.basename(legacySource)), { force: true });
    }
    this._checkpoint("source_deleted");
    this._clearJournal();
    return finalPath;
  }

  _opaqueFilename(format = "wav") {
    const suffix = format === "wav" ? WAV_ENCRYPTED_SUFFIX : LEGACY_WEBM_ENCRYPTED_SUFFIX;
    return `${crypto.randomUUID()}${suffix}`;
  }

  _legacyTranscriptionId(filename) {
    const suffix = filename.endsWith(WAV_ENCRYPTED_SUFFIX)
      ? WAV_ENCRYPTED_SUFFIX
      : filename.endsWith(LEGACY_WEBM_ENCRYPTED_SUFFIX)
        ? LEGACY_WEBM_ENCRYPTED_SUFFIX
        : filename.endsWith(".wav")
          ? ".wav"
      : filename.endsWith(".webm")
        ? ".webm"
        : null;
    if (!suffix) return null;
    const basename = filename.slice(0, -suffix.length);
    const lastDash = basename.lastIndexOf("-");
    return lastDash >= 0 ? basename.slice(lastDash + 1) : basename;
  }

  _migrateLegacyAudio() {
    const knownFiles = new Set(
      Object.values(this.manifest.records).map((record) => record.file)
    );
    let changed = false;
    for (const filename of fs.readdirSync(this.audioDir)) {
      if (
        filename === MANIFEST_NAME
        || filename === JOURNAL_NAME
        || knownFiles.has(filename)
        || filename.includes(".tmp-")
        || filename.endsWith(".pending")
      ) {
        continue;
      }
      const transcriptionId = this._legacyTranscriptionId(filename);
      if (!transcriptionId) continue;
      const sourcePath = path.join(this.audioDir, filename);
      const stat = fs.statSync(sourcePath);
      const isWav = filename.endsWith(".wav") || filename.endsWith(WAV_ENCRYPTED_SUFFIX);
      const format = isWav ? "wav" : "webm";
      const destinationName = this._opaqueFilename(format);
      const contents = fs.readFileSync(sourcePath);
      let plaintext;
      if (
        filename.endsWith(WAV_ENCRYPTED_SUFFIX) ||
        filename.endsWith(LEGACY_WEBM_ENCRYPTED_SUFFIX)
      ) {
        plaintext = secretCrypto.decryptBuffer(contents);
      } else {
        plaintext = contents;
      }
      const context = {
        table: "audio",
        row: String(transcriptionId),
        field: "contents",
      };
      void context;
      const record = {
        file: destinationName,
        created_at: stat.birthtime?.toISOString?.() || new Date(stat.mtimeMs).toISOString(),
        updated_at: new Date().toISOString(),
        key_version: this.crypto.currentVersion,
        size: plaintext.length,
        format,
      };
      this._commitReplacement(transcriptionId, plaintext, record, {
        legacySource: filename,
      });
      knownFiles.add(destinationName);
      changed = true;
    }
    if (changed || !fs.existsSync(this.manifestPath)) this._saveManifest();
  }

  _record(transcriptionId) {
    return this.manifest.records[String(transcriptionId)] || null;
  }

  saveAudio(transcriptionId, audioBuffer, timestamp, { format = "wav" } = {}) {
    try {
      if (format !== "wav") throw new Error("New recordings must use WAV format");
      const id = String(transcriptionId);
      const existing = this._record(id);
      const filename = this._opaqueFilename(format);
      const input = Buffer.from(audioBuffer);
      const parsedTimestamp = timestamp ? new Date(timestamp) : new Date();
      const record = {
        file: filename,
        created_at: Number.isFinite(parsedTimestamp.getTime())
          ? parsedTimestamp.toISOString()
          : new Date().toISOString(),
        updated_at: new Date().toISOString(),
        key_version: this.crypto.currentVersion,
        size: input.length,
        format,
      };
      const filePath = this._commitReplacement(id, input, record, {
        oldFile: existing?.file || null,
      });
      debugLogger.debug(
        "Encrypted audio saved",
        { size: input.length },
        "audio-storage"
      );
      return { success: true, path: filePath };
    } catch (error) {
      debugLogger.error(
        "Failed to save encrypted audio",
        { code: error.code || "AUDIO_SAVE_FAILED" },
        "audio-storage"
      );
      return { success: false, code: error.code || "AUDIO_SAVE_FAILED" };
    }
  }

  _findStoredAudioPath(transcriptionId) {
    const record = this._record(transcriptionId);
    if (!record?.file) return null;
    const filePath = path.join(this.audioDir, path.basename(record.file));
    return fs.existsSync(filePath) ? filePath : null;
  }

  getAudioPath(transcriptionId) {
    const audioBuffer = this.getAudioBuffer(transcriptionId);
    if (!audioBuffer) return null;
    try {
      const id = String(transcriptionId);
      const record = this._record(id);
      const previous = this.playbackPaths.get(id);
      if (previous) fs.rmSync(previous, { force: true });
      const playbackPath = path.join(
        this.playbackDir,
        `${crypto.randomUUID()}.${record?.format === "wav" ? "wav" : "webm"}`
      );
      fs.writeFileSync(playbackPath, audioBuffer, { mode: 0o600 });
      fs.chmodSync(playbackPath, 0o600);
      this.playbackPaths.set(id, playbackPath);
      return playbackPath;
    } catch (error) {
      debugLogger.error(
        "Failed to prepare temporary audio playback",
        { code: error.code || "AUDIO_PLAYBACK_FAILED" },
        "audio-storage"
      );
      return null;
    }
  }

  getAudioBuffer(transcriptionId) {
    const id = String(transcriptionId);
    const filePath = this._findStoredAudioPath(id);
    if (!filePath) return null;
    try {
      const contents = fs.readFileSync(filePath);
      const plaintext = this.crypto.decryptBytes(contents, {
        table: "audio",
        row: id,
        field: "contents",
      });
      const version = this.crypto.encryptedBytesVersion(contents);
      if (version !== this.crypto.currentVersion) {
        atomicWrite(
          filePath,
          this.crypto.encryptBytes(plaintext, {
            table: "audio",
            row: id,
            field: "contents",
          })
        );
        this.manifest.records[id].key_version = this.crypto.currentVersion;
        this.manifest.records[id].updated_at = new Date().toISOString();
        this._saveManifest();
      }
      return plaintext;
    } catch (error) {
      debugLogger.error(
        "Encrypted audio authentication failed",
        { code: error.code || "AUDIO_CORRUPTED" },
        "audio-storage"
      );
      if (error instanceof LocalDataCorruptionError) throw error;
      throw new LocalDataCorruptionError("Encrypted audio could not be read", error);
    }
  }

  deleteAudio(transcriptionId) {
    try {
      const id = String(transcriptionId);
      const record = this._record(id);
      if (record?.file) fs.rmSync(path.join(this.audioDir, record.file), { force: true });
      delete this.manifest.records[id];
      const playbackPath = this.playbackPaths.get(id);
      if (playbackPath) fs.rmSync(playbackPath, { force: true });
      this.playbackPaths.delete(id);
      this._saveManifest();
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Failed to delete audio",
        { code: error.code || "AUDIO_DELETE_FAILED" },
        "audio-storage"
      );
      return { success: false };
    }
  }

  cleanupExpiredAudio(retentionDays, databaseManager) {
    const days = Number(retentionDays);
    if (!Number.isInteger(days) || days < 0 || days > 3650) {
      throw new TypeError("Audio retention days must be an integer between 0 and 3650");
    }
    const cutoffMs = Date.now() - days * 86400000;
    const expiredIds = [];
    for (const [id, record] of Object.entries(this.manifest.records)) {
      const createdAt = Date.parse(record.created_at || record.updated_at || "");
      if (Number.isFinite(createdAt) && createdAt < cutoffMs) {
        if (record.file) fs.rmSync(path.join(this.audioDir, record.file), { force: true });
        delete this.manifest.records[id];
        expiredIds.push(id);
      }
    }
    this._saveManifest();
    if (expiredIds.length > 0 && databaseManager) {
      databaseManager.clearAudioFlags(expiredIds);
    }
    return {
      deleted: expiredIds.length,
      kept: Object.keys(this.manifest.records).length,
    };
  }

  deleteAllAudio() {
    let deleted = 0;
    for (const record of Object.values(this.manifest.records)) {
      if (!record.file) continue;
      fs.rmSync(path.join(this.audioDir, record.file), { force: true });
      deleted += 1;
    }
    this.manifest = this._emptyManifest();
    this._saveManifest();
    fs.rmSync(this.playbackDir, { recursive: true, force: true });
    fs.mkdirSync(this.playbackDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(this.playbackDir, 0o700);
    this.playbackPaths.clear();
    return { deleted };
  }

  rotateEncryptionKey() {
    let rotated = 0;
    for (const id of Object.keys(this.manifest.records)) {
      const filePath = this._findStoredAudioPath(id);
      if (!filePath) continue;
      const contents = fs.readFileSync(filePath);
      if (this.crypto.encryptedBytesVersion(contents) === this.crypto.currentVersion) continue;
      const plaintext = this.crypto.decryptBytes(contents, {
        table: "audio",
        row: id,
        field: "contents",
      });
      atomicWrite(
        filePath,
        this.crypto.encryptBytes(plaintext, {
          table: "audio",
          row: id,
          field: "contents",
        })
      );
      this.manifest.records[id].key_version = this.crypto.currentVersion;
      rotated += 1;
    }
    this._saveManifest();
    return { rotated, keyVersion: this.crypto.currentVersion };
  }

  activeKeyVersions() {
    const versions = new Set();
    for (const id of Object.keys(this.manifest.records)) {
      const filePath = this._findStoredAudioPath(id);
      if (!filePath) continue;
      const version = this.crypto.encryptedBytesVersion(fs.readFileSync(filePath));
      if (version) versions.add(version);
    }
    return versions;
  }

  backupEncryptedAudio(destination) {
    const target = path.resolve(destination);
    fs.mkdirSync(target, { recursive: true, mode: 0o700 });
    fs.chmodSync(target, 0o700);
    for (const record of Object.values(this.manifest.records)) {
      if (!record.file) continue;
      fs.copyFileSync(
        path.join(this.audioDir, record.file),
        path.join(target, path.basename(record.file))
      );
      fs.chmodSync(path.join(target, path.basename(record.file)), 0o600);
    }
    fs.copyFileSync(this.manifestPath, path.join(target, MANIFEST_NAME));
    fs.chmodSync(path.join(target, MANIFEST_NAME), 0o600);
    this.crypto.backupKeyring(path.join(target, "local-data-keys.v1.enc"));
    return { directory: target, files: Object.keys(this.manifest.records).length };
  }

  getStorageUsage() {
    let totalBytes = 0;
    let fileCount = 0;
    for (const record of Object.values(this.manifest.records)) {
      if (!record.file) continue;
      try {
        totalBytes += fs.statSync(path.join(this.audioDir, record.file)).size;
        fileCount += 1;
      } catch {}
    }
    return { fileCount, totalBytes };
  }
}

module.exports = AudioStorageManager;
module.exports.MANIFEST_CONTEXT = MANIFEST_CONTEXT;
