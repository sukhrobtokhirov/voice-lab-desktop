const fs = require("fs");
const path = require("path");
const debugLogger = require("./debugLogger");

let macOSPanelAddon;

function resolveMacOSPanelAddon() {
  if (process.platform !== "darwin") return null;
  if (macOSPanelAddon !== undefined) return macOSPanelAddon;

  const candidates = new Set([
    path.join(__dirname, "..", "..", "resources", "bin", "macos-paste-addon.node"),
  ]);
  if (process.resourcesPath) {
    candidates.add(path.join(process.resourcesPath, "bin", "macos-paste-addon.node"));
    candidates.add(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "resources",
        "bin",
        "macos-paste-addon.node"
      )
    );
  }

  for (const candidate of candidates) {
    try {
      if (!fs.statSync(candidate).isFile()) continue;
      const addon = require(candidate);
      if (
        typeof addon?.configureStatusPanel !== "function" ||
        typeof addon?.restorePanelWindow !== "function"
      ) {
        continue;
      }
      macOSPanelAddon = addon;
      return addon;
    } catch (error) {
      debugLogger.warn(
        "Failed to load the native macOS status-panel bridge",
        { path: candidate, error: error?.message },
        "window"
      );
    }
  }

  macOSPanelAddon = null;
  return null;
}

function configureStatusPanel(window, { x, y }) {
  const addon = resolveMacOSPanelAddon();
  if (!addon || !window || window.isDestroyed()) return false;

  try {
    addon.configureStatusPanel(window.getNativeWindowHandle(), x, y);
    return true;
  } catch (error) {
    debugLogger.warn(
      "Could not configure native macOS status panel",
      { error: error?.message },
      "window"
    );
    return false;
  }
}

function restorePanelWindow(window) {
  const addon = resolveMacOSPanelAddon();
  if (!addon || !window || window.isDestroyed()) return false;

  try {
    addon.restorePanelWindow(window.getNativeWindowHandle());
    return true;
  } catch (error) {
    debugLogger.warn(
      "Could not restore native macOS panel behaviour",
      { error: error?.message },
      "window"
    );
    return false;
  }
}

module.exports = { configureStatusPanel, restorePanelWindow };
