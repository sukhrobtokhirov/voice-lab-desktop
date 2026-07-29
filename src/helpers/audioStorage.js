const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const debugLogger = require("./debugLogger");
const secretCrypto = require("./secretCrypto");

const ENCRYPTED_SUFFIX = ".webm.enc";

class AudioStorageManager {
  constructor() {
    this.audioDir = path.join(app.getPath("userData"), "audio");
    this.playbackDir = path.join(app.getPath("temp"), "voicelab-audio-playback");
    this.ensureAudioDir();
  }

  ensureAudioDir() {
    try {
      fs.mkdirSync(this.audioDir, { recursive: true, mode: 0o700 });
      fs.chmodSync(this.audioDir, 0o700);
      fs.rmSync(this.playbackDir, { recursive: true, force: true });
      fs.mkdirSync(this.playbackDir, { recursive: true, mode: 0o700 });
    } catch (error) {
      debugLogger.error(
        "Failed to create audio directory",
        { error: error.message },
        "audio-storage"
      );
    }
  }

  _buildFilename(transcriptionId, timestamp) {
    if (timestamp) {
      const d = new Date(timestamp);
      if (!isNaN(d.getTime())) {
        const pad = (n) => String(n).padStart(2, "0");
        const date = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
        const time = `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
        return `OpenWhispr-${date}-${time}-${transcriptionId}${ENCRYPTED_SUFFIX}`;
      }
    }
    return `OpenWhispr-${transcriptionId}${ENCRYPTED_SUFFIX}`;
  }

  saveAudio(transcriptionId, audioBuffer, timestamp) {
    try {
      const filename = this._buildFilename(transcriptionId, timestamp);
      const filePath = path.join(this.audioDir, filename);
      if (!secretCrypto.isAvailable()) {
        throw new Error("Secure audio storage is unavailable");
      }
      fs.writeFileSync(filePath, secretCrypto.encryptBuffer(Buffer.from(audioBuffer)), {
        mode: 0o600,
      });
      debugLogger.debug(
        "Audio saved",
        { transcriptionId, filename, size: audioBuffer.length },
        "audio-storage"
      );
      return { success: true, path: filePath };
    } catch (error) {
      debugLogger.error(
        "Failed to save audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return { success: false };
    }
  }

  _findStoredAudioPath(transcriptionId) {
    try {
      const files = fs.readdirSync(this.audioDir);
      const match = files.find(
        (f) =>
          f.endsWith(`-${transcriptionId}${ENCRYPTED_SUFFIX}`) ||
          f === `${transcriptionId}${ENCRYPTED_SUFFIX}` ||
          f.endsWith(`-${transcriptionId}.webm`) ||
          f === `${transcriptionId}.webm`
      );
      if (match) return path.join(this.audioDir, match);
    } catch {}
    return null;
  }

  getAudioPath(transcriptionId) {
    const audioBuffer = this.getAudioBuffer(transcriptionId);
    if (!audioBuffer) return null;
    try {
      const playbackPath = path.join(this.playbackDir, `${transcriptionId}.webm`);
      fs.writeFileSync(playbackPath, audioBuffer, { mode: 0o600 });
      return playbackPath;
    } catch (error) {
      debugLogger.error(
        "Failed to prepare temporary audio playback",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return null;
    }
  }

  getAudioBuffer(transcriptionId) {
    const filePath = this._findStoredAudioPath(transcriptionId);
    if (!filePath) return null;
    try {
      const contents = fs.readFileSync(filePath);
      if (filePath.endsWith(ENCRYPTED_SUFFIX)) {
        return secretCrypto.decryptBuffer(contents);
      }
      if (!secretCrypto.isAvailable()) return null;
      const encryptedPath = `${filePath}.enc`;
      fs.writeFileSync(encryptedPath, secretCrypto.encryptBuffer(contents), { mode: 0o600 });
      fs.rmSync(filePath, { force: true });
      return contents;
    } catch (error) {
      debugLogger.error(
        "Failed to read audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return null;
    }
  }

  deleteAudio(transcriptionId) {
    try {
      const filePath = this._findStoredAudioPath(transcriptionId);
      if (filePath) {
        fs.unlinkSync(filePath);
        debugLogger.debug("Audio deleted", { transcriptionId }, "audio-storage");
      }
      fs.rmSync(path.join(this.playbackDir, `${transcriptionId}.webm`), { force: true });
      return { success: true };
    } catch (error) {
      debugLogger.error(
        "Failed to delete audio",
        { transcriptionId, error: error.message },
        "audio-storage"
      );
      return { success: false };
    }
  }

  cleanupExpiredAudio(retentionDays, databaseManager) {
    try {
      const cutoffMs = Date.now() - retentionDays * 86400000;
      const files = fs
        .readdirSync(this.audioDir)
        .filter((f) => f.endsWith(".webm") || f.endsWith(ENCRYPTED_SUFFIX));
      const expiredIds = [];
      let kept = 0;

      for (const file of files) {
        const filePath = path.join(this.audioDir, file);
        try {
          const stats = fs.statSync(filePath);
          if (stats.mtimeMs < cutoffMs) {
            fs.unlinkSync(filePath);
            // Extract ID from "OpenWhispr-...-{id}.webm" or legacy "{id}.webm"
            const basename = file.endsWith(ENCRYPTED_SUFFIX)
              ? file.slice(0, -ENCRYPTED_SUFFIX.length)
              : path.basename(file, ".webm");
            const lastDash = basename.lastIndexOf("-");
            const id = lastDash !== -1 ? basename.slice(lastDash + 1) : basename;
            expiredIds.push(id);
          } else {
            kept++;
          }
        } catch (error) {
          debugLogger.error(
            "Failed to process audio file during cleanup",
            { file, error: error.message },
            "audio-storage"
          );
        }
      }

      if (expiredIds.length > 0 && databaseManager) {
        databaseManager.clearAudioFlags(expiredIds);
      }

      debugLogger.info(
        "Audio cleanup complete",
        { deleted: expiredIds.length, kept, retentionDays },
        "audio-storage"
      );
      return { deleted: expiredIds.length, kept };
    } catch (error) {
      debugLogger.error("Audio cleanup failed", { error: error.message }, "audio-storage");
      return { deleted: 0, kept: 0 };
    }
  }

  deleteAllAudio() {
    try {
      const files = fs
        .readdirSync(this.audioDir)
        .filter((f) => f.endsWith(".webm") || f.endsWith(ENCRYPTED_SUFFIX));
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(this.audioDir, file));
        } catch (error) {
          debugLogger.error(
            "Failed to delete audio file",
            { file, error: error.message },
            "audio-storage"
          );
        }
      }
      fs.rmSync(this.playbackDir, { recursive: true, force: true });
      fs.mkdirSync(this.playbackDir, { recursive: true, mode: 0o700 });
      debugLogger.info("All audio deleted", { count: files.length }, "audio-storage");
      return { deleted: files.length };
    } catch (error) {
      debugLogger.error("Failed to delete all audio", { error: error.message }, "audio-storage");
      return { deleted: 0 };
    }
  }

  getStorageUsage() {
    try {
      const files = fs
        .readdirSync(this.audioDir)
        .filter((f) => f.endsWith(".webm") || f.endsWith(ENCRYPTED_SUFFIX));
      let totalBytes = 0;
      for (const file of files) {
        try {
          const stats = fs.statSync(path.join(this.audioDir, file));
          totalBytes += stats.size;
        } catch {
          // Skip files that can't be stat'd
        }
      }
      return { fileCount: files.length, totalBytes };
    } catch (error) {
      debugLogger.error("Failed to get storage usage", { error: error.message }, "audio-storage");
      return { fileCount: 0, totalBytes: 0 };
    }
  }
}

module.exports = AudioStorageManager;
