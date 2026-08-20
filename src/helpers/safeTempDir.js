const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

let cachedSafeTempDir = null;

// Returns a safe temp directory for native binaries on Windows.
// Falls back to ProgramData when TEMP contains spaces or non-ASCII characters,
// as native media binaries such as FFmpeg may not handle these paths correctly.
function getSafeTempDir() {
  if (cachedSafeTempDir) return cachedSafeTempDir;

  const systemTemp = os.tmpdir();
  let tempBase = systemTemp;

  // On non-Windows platforms, use system temp directly
  // On Windows, check for problematic characters: non-ASCII or spaces
  const hasProblematicChars = !/^[\x21-\x7E]*$/.test(systemTemp);
  if (process.platform === "win32" && hasProblematicChars) {
    const fallbackBase = process.env.ProgramData || "C:\\ProgramData";
    const fallback = path.join(fallbackBase, "VoiceLab", "temp");
    try {
      fs.mkdirSync(fallback, { recursive: true, mode: 0o700 });
      tempBase = fallback;
    } catch {
      const rootFallback = path.join(process.env.SystemDrive || "C:", "VoiceLab", "temp");
      try {
        fs.mkdirSync(rootFallback, { recursive: true, mode: 0o700 });
        tempBase = rootFallback;
      } catch {
        tempBase = systemTemp;
      }
    }
  }

  // Never place sensitive recordings directly in a shared system temp directory.
  // mkdtemp creates an unpredictable, process-private directory atomically.
  cachedSafeTempDir = fs.mkdtempSync(path.join(tempBase, "voicelab-"));
  try {
    fs.chmodSync(cachedSafeTempDir, 0o700);
  } catch {
    // Windows ACLs are authoritative; chmod may be unsupported on some filesystems.
  }
  return cachedSafeTempDir;
}

function reserveSafeTempFile(prefix = "vlab-", suffix = "") {
  if (!/^[A-Za-z0-9._-]*$/.test(prefix) || !/^[A-Za-z0-9._-]*$/.test(suffix)) {
    throw new Error("Invalid temporary file name");
  }

  const tempPath = path.join(getSafeTempDir(), `${prefix}${crypto.randomUUID()}${suffix}`);
  const fd = fs.openSync(tempPath, "wx", 0o600);
  fs.closeSync(fd);
  try {
    fs.chmodSync(tempPath, 0o600);
  } catch {
    // Windows ACLs are authoritative; chmod may be unsupported on some filesystems.
  }
  return tempPath;
}

function getReservedTempWriteOptions(tempPath) {
  const resolvedPath = path.resolve(tempPath);
  if (path.dirname(resolvedPath) !== path.resolve(getSafeTempDir())) {
    throw new Error("Temporary file is outside the private directory");
  }

  const beforeOpen = fs.lstatSync(resolvedPath);
  if (!beforeOpen.isFile() || beforeOpen.isSymbolicLink()) {
    throw new Error("Temporary file is not a regular file");
  }

  return {
    flags: fs.constants.O_WRONLY | fs.constants.O_TRUNC | (fs.constants.O_NOFOLLOW || 0),
    mode: 0o600,
  };
}

module.exports = { getSafeTempDir, reserveSafeTempFile, getReservedTempWriteOptions };
