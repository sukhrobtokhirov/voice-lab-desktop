const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const PATH_SEPARATOR = /[/\\]/;
const WINDOWS_ABSOLUTE_PATH = /^[a-zA-Z]:/;
const SAFE_NOTE_ID = /^[a-zA-Z0-9_-]{1,128}$/;

function assertSafeFolderName(folderName) {
  if (
    typeof folderName !== "string" ||
    folderName.length === 0 ||
    folderName.length > 120 ||
    folderName !== folderName.trim() ||
    folderName === "." ||
    folderName === ".." ||
    path.isAbsolute(folderName) ||
    WINDOWS_ABSOLUTE_PATH.test(folderName) ||
    PATH_SEPARATOR.test(folderName) ||
    CONTROL_CHARACTERS.test(folderName)
  ) {
    throw new TypeError("Invalid markdown mirror folder name");
  }
  return folderName;
}

class MarkdownMirror {
  constructor() {
    this._basePath = null;
    this._canonicalBasePath = null;
  }

  init(basePath) {
    try {
      const resolvedBasePath = path.resolve(basePath);
      fs.mkdirSync(resolvedBasePath, { recursive: true });
      const canonicalBasePath = fs.realpathSync(resolvedBasePath);
      this._basePath = resolvedBasePath;
      this._canonicalBasePath = canonicalBasePath;
      debugLogger.debug(
        "Markdown mirror initialized",
        { basePath: canonicalBasePath },
        "note-files"
      );
    } catch (err) {
      this._basePath = null;
      this._canonicalBasePath = null;
      debugLogger.error("Failed to init markdown mirror", { error: err.message }, "note-files");
    }
  }

  getBasePath() {
    return this._canonicalBasePath;
  }

  assertSafeFolderName(folderName) {
    return assertSafeFolderName(folderName);
  }

  _getVerifiedBasePath() {
    if (!this._basePath || !this._canonicalBasePath) {
      throw new Error("Markdown mirror is not initialized");
    }
    const currentBasePath = fs.realpathSync(this._basePath);
    if (currentBasePath !== this._canonicalBasePath) {
      throw new Error("Markdown mirror root changed after initialization");
    }
    return currentBasePath;
  }

  _assertContained(targetPath) {
    const basePath = this._getVerifiedBasePath();
    const resolvedTarget = path.resolve(targetPath);
    if (resolvedTarget === basePath || !resolvedTarget.startsWith(`${basePath}${path.sep}`)) {
      throw new Error("Markdown mirror target escapes its root");
    }
    return resolvedTarget;
  }

  _resolveFolder(folderName, { mustExist = false } = {}) {
    const safeName = assertSafeFolderName(folderName);
    const basePath = this._getVerifiedBasePath();
    const folderPath = this._assertContained(path.join(basePath, safeName));

    if (fs.existsSync(folderPath)) {
      const stat = fs.lstatSync(folderPath);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Markdown mirror folder must be a real directory");
      }
      const canonicalFolderPath = fs.realpathSync(folderPath);
      this._assertContained(canonicalFolderPath);
      return canonicalFolderPath;
    }

    if (mustExist) return null;
    return folderPath;
  }

  _safeNoteId(noteId) {
    const value = String(noteId ?? "");
    if (!SAFE_NOTE_ID.test(value)) {
      throw new TypeError("Invalid markdown mirror note id");
    }
    return value;
  }

  _writeFileAtomically(filePath, contents) {
    const containedPath = this._assertContained(filePath);
    const parentPath = this._assertContained(path.dirname(containedPath));
    if (fs.realpathSync(parentPath) !== parentPath) {
      throw new Error("Markdown mirror parent path is not canonical");
    }
    const temporaryPath = this._assertContained(
      path.join(parentPath, `.${path.basename(containedPath)}.${process.pid}.${Date.now()}.tmp`)
    );
    try {
      fs.writeFileSync(temporaryPath, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
      fs.renameSync(temporaryPath, containedPath);
    } finally {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {}
    }
  }

  _slugify(title) {
    return (title || "Untitled")
      .replace(/[/\\?%*:|"<>]/g, "-")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60);
  }

  _buildFrontmatter(note, folderName) {
    const escYaml = (str) => {
      if (!str) return '""';
      if (/[:#{}[\],&*?|>!%@`]/.test(str) || str.includes('"') || str.includes("'")) {
        return `"${str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
      }
      return str;
    };
    const lines = [
      "---",
      `id: ${note.id}`,
      `title: ${escYaml(note.title)}`,
      `type: ${note.note_type || "personal"}`,
      `folder: ${escYaml(folderName || "Personal")}`,
      `created: ${note.created_at || new Date().toISOString()}`,
      `updated: ${note.updated_at || new Date().toISOString()}`,
      "---",
    ];
    return lines.join("\n");
  }

  writeNote(note, folderName) {
    if (!this._basePath) return;
    try {
      const noteId = this._safeNoteId(note.id);
      const dirName = assertSafeFolderName(folderName || "Personal");
      const dirPath = this._resolveFolder(dirName);
      fs.mkdirSync(dirPath, { recursive: true });
      this._resolveFolder(dirName, { mustExist: true });

      // Remove stale files (title changed or note moved to different folder)
      const glob = this._globNoteFiles(noteId);
      const slug = this._slugify(note.title);
      const newFileName = `${noteId}-${slug}.md`;
      const newFilePath = this._assertContained(path.join(dirPath, newFileName));
      for (const existing of glob) {
        if (existing !== newFilePath) {
          try {
            fs.unlinkSync(this._assertContained(existing));
          } catch {}
        }
      }

      const frontmatter = this._buildFrontmatter(note, dirName);
      const body = note.enhanced_content || note.content || "";
      this._writeFileAtomically(newFilePath, `${frontmatter}\n\n${body}`);
    } catch (err) {
      debugLogger.error(
        "Failed to write note file",
        { noteId: note.id, error: err.message },
        "note-files"
      );
    }
  }

  writeTranscript(note, folderName, speakerMappings) {
    if (!this._basePath) return;
    try {
      const noteId = this._safeNoteId(note.id);
      const segments = JSON.parse(note.transcript || "[]");
      if (!segments.length) return;

      const dirName = assertSafeFolderName(folderName || "Personal");
      const dirPath = this._resolveFolder(dirName);
      fs.mkdirSync(dirPath, { recursive: true });
      this._resolveFolder(dirName, { mustExist: true });

      const slug = this._slugify(note.title);
      const newFileName = `${noteId}-${slug}-transcript.md`;
      const newFilePath = this._assertContained(path.join(dirPath, newFileName));

      const stale = this._globTranscriptFiles(noteId);
      for (const existing of stale) {
        if (existing !== newFilePath) {
          try {
            fs.unlinkSync(this._assertContained(existing));
          } catch {}
        }
      }

      const { formatMd } = require("./transcriptFormatter");
      this._writeFileAtomically(
        newFilePath,
        formatMd(note, segments, speakerMappings || {})
      );
    } catch (err) {
      debugLogger.error(
        "Failed to write transcript file",
        { noteId: note.id, error: err.message },
        "note-files"
      );
    }
  }

  deleteNote(noteId) {
    if (!this._basePath) return;
    try {
      const safeNoteId = this._safeNoteId(noteId);
      const files = [
        ...this._globNoteFiles(safeNoteId),
        ...this._globTranscriptFiles(safeNoteId),
      ];
      for (const f of files) {
        fs.unlinkSync(this._assertContained(f));
      }
    } catch (err) {
      debugLogger.error("Failed to delete note file", { noteId, error: err.message }, "note-files");
    }
  }

  ensureFolder(folderName) {
    if (!this._basePath) return;
    try {
      const folderPath = this._resolveFolder(folderName);
      fs.mkdirSync(folderPath, { recursive: true });
      this._resolveFolder(folderName, { mustExist: true });
    } catch (err) {
      debugLogger.error(
        "Failed to ensure folder",
        { folderName, error: err.message },
        "note-files"
      );
    }
  }

  renameFolder(oldName, newName) {
    if (!this._basePath) return;
    try {
      const oldPath = this._resolveFolder(oldName, { mustExist: true });
      const newPath = this._resolveFolder(newName);
      if (oldPath) {
        fs.renameSync(oldPath, newPath);
        this._resolveFolder(newName, { mustExist: true });
      }
    } catch (err) {
      debugLogger.error(
        "Failed to rename folder",
        { oldName, newName, error: err.message },
        "note-files"
      );
    }
  }

  deleteFolder(folderName) {
    if (!this._basePath) return;
    try {
      const dir = this._resolveFolder(folderName, { mustExist: true });
      if (dir) {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    } catch (err) {
      debugLogger.error(
        "Failed to delete folder",
        { folderName, error: err.message },
        "note-files"
      );
    }
  }

  rebuildAll(notes, folderMap, speakerMappingsMap) {
    if (!this._basePath) return;
    try {
      for (const note of notes) {
        const folderName = folderMap[note.folder_id] || "Personal";
        this.writeNote(note, folderName);
        if (note.transcript) {
          this.writeTranscript(note, folderName, speakerMappingsMap?.[note.id] || {});
        }
      }
      debugLogger.info("Markdown mirror rebuild complete", { count: notes.length }, "note-files");
    } catch (err) {
      debugLogger.error("Failed to rebuild all note files", { error: err.message }, "note-files");
    }
  }

  getNotePath(noteId) {
    if (!this._basePath) return null;
    const files = this._globNoteFiles(noteId);
    return files.length > 0 ? files[0] : null;
  }

  getFolderPath(folderName) {
    if (!this._basePath) return null;
    try {
      return this._resolveFolder(folderName, { mustExist: true });
    } catch {
      return null;
    }
  }

  _globNoteFiles(noteId) {
    if (!this._basePath) return [];
    const results = [];
    try {
      const prefix = `${this._safeNoteId(noteId)}-`;
      const basePath = this._getVerifiedBasePath();
      const dirs = fs.readdirSync(basePath, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
        const dirPath = this._resolveFolder(dir.name, { mustExist: true });
        if (!dirPath) continue;
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (file.startsWith(prefix) && file.endsWith(".md")) {
            results.push(this._assertContained(path.join(dirPath, file)));
          }
        }
      }
    } catch {}
    return results;
  }

  _globTranscriptFiles(noteId) {
    if (!this._basePath) return [];
    const results = [];
    try {
      const prefix = `${this._safeNoteId(noteId)}-`;
      const basePath = this._getVerifiedBasePath();
      const dirs = fs.readdirSync(basePath, { withFileTypes: true });
      for (const dir of dirs) {
        if (!dir.isDirectory() || dir.isSymbolicLink()) continue;
        const dirPath = this._resolveFolder(dir.name, { mustExist: true });
        if (!dirPath) continue;
        const files = fs.readdirSync(dirPath);
        for (const file of files) {
          if (
            file.startsWith(prefix) &&
            (file.endsWith("-transcript.md") || file.endsWith("-transcript.txt"))
          ) {
            results.push(this._assertContained(path.join(dirPath, file)));
          }
        }
      }
    } catch {}
    return results;
  }
}

const markdownMirror = new MarkdownMirror();
markdownMirror.assertSafeFolderName = assertSafeFolderName;

module.exports = markdownMirror;
