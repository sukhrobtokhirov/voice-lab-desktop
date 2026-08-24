/**
 * Prefer Electron's main-process clipboard. Browser clipboard access can be
 * unavailable in desktop windows even after a user clicks Copy.
 */
export async function writeTextToClipboard(text: string): Promise<void> {
  if (!text) throw new Error("Clipboard text is required");

  let bridgeError: unknown;
  const writeWithElectron = window.electronAPI?.writeClipboard;

  if (typeof writeWithElectron === "function") {
    try {
      const result = await writeWithElectron(text);
      if (result?.success !== false) return;
      bridgeError = new Error("Electron clipboard write failed");
    } catch (error) {
      bridgeError = error;
    }
  }

  try {
    await navigator.clipboard.writeText(text);
  } catch (webClipboardError) {
    throw bridgeError ?? webClipboardError;
  }
}
