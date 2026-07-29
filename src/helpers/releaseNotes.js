const MAX_RELEASE_NOTES_LENGTH = 32 * 1024;

function normalizeReleaseNotes(input) {
  const value = Array.isArray(input)
    ? input
        .map((entry) =>
          typeof entry === "string"
            ? entry
            : typeof entry?.note === "string"
              ? entry.note
              : ""
        )
        .filter(Boolean)
        .join("\n\n")
    : typeof input === "string"
      ? input
      : "";
  return value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .slice(0, MAX_RELEASE_NOTES_LENGTH);
}

function publicUpdateInfo(info) {
  if (!info || typeof info !== "object") return null;
  return {
    version: typeof info.version === "string" ? info.version.slice(0, 64) : "",
    releaseDate: typeof info.releaseDate === "string" ? info.releaseDate.slice(0, 64) : "",
    releaseNotes: normalizeReleaseNotes(info.releaseNotes),
  };
}

module.exports = { normalizeReleaseNotes, publicUpdateInfo };
