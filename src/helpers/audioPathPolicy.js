const fs = require("fs");
const os = require("os");
const path = require("path");
const { app } = require("electron");
const { getSafeTempDir } = require("./safeTempDir");

const approvedAudioPaths = new Set();

function canonicalAllowedAudioDirs() {
  return [os.tmpdir(), getSafeTempDir(), app.getPath("userData")].map((directory) => {
    try {
      return fs.realpathSync(directory);
    } catch {
      return directory;
    }
  });
}

function approveAudioPath(filePath) {
  if (typeof filePath !== "string" || !filePath) return;
  try {
    approvedAudioPaths.add(fs.realpathSync(path.resolve(filePath)));
  } catch {
    // The selected file no longer exists or is unreadable.
  }
}

function resolveAllowedAudioPath(filePath) {
  if (typeof filePath !== "string" || !filePath) return null;
  try {
    const real = fs.realpathSync(path.resolve(filePath));
    if (approvedAudioPaths.has(real)) return real;
    const allowed = canonicalAllowedAudioDirs();
    return allowed.some((directory) => real === directory || real.startsWith(directory + path.sep))
      ? real
      : null;
  } catch {
    return null;
  }
}

module.exports = { approveAudioPath, resolveAllowedAudioPath };
