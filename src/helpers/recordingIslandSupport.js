const os = require("os");

// The implementation stays in the repository for future macOS work, but the
// experimental presentation is deliberately dormant. The standard floating
// mic remains the only shipped recording surface until the native menu-bar
// behavior is reliable.
const RECORDING_ISLAND_ENABLED = process.env.VOICELAB_RECORDING_ISLAND_ENABLED === "1";

/**
 * The recording island is deliberately limited to Macs with an M2-or-newer
 * Apple Silicon chip. Unknown hardware fails closed so a future edge case
 * cannot show a window layout that has not been tested.
 */
function supportsRecordingIsland() {
  if (
    !RECORDING_ISLAND_ENABLED ||
    process.platform !== "darwin" ||
    process.arch !== "arm64"
  ) {
    return false;
  }

  const chipModel = os.cpus()?.[0]?.model || "";
  return /\bApple M(?:[2-9]|[1-9]\d+)\b/i.test(chipModel);
}

module.exports = { supportsRecordingIsland };
