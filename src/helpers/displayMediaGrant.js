const DISPLAY_MEDIA_GRANT_TTL_MS = 5_000;

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0 ? value : null;
}

class DisplayMediaGrantManager {
  constructor({ now = Date.now, isAllowedUrl } = {}) {
    if (typeof isAllowedUrl !== "function") {
      throw new TypeError("Display-media URL validator is required");
    }
    this.now = now;
    this.isAllowedUrl = isAllowedUrl;
    this.grant = null;
  }

  arm({ webContentsId, processId, routingId, url }) {
    const identity = {
      webContentsId: positiveInteger(webContentsId),
      processId: positiveInteger(processId),
      routingId: positiveInteger(routingId),
      url: typeof url === "string" ? url : "",
    };
    if (
      !identity.webContentsId ||
      !identity.processId ||
      !identity.routingId ||
      !this.isAllowedUrl(identity.url)
    ) {
      const error = new Error("Display-media capture initiator is not trusted");
      error.code = "DISPLAY_MEDIA_INITIATOR_FORBIDDEN";
      throw error;
    }
    const armedAt = this.now();
    this.grant = {
      ...identity,
      armedAt,
      expiresAt: armedAt + DISPLAY_MEDIA_GRANT_TTL_MS,
    };
    return { expiresInMs: DISPLAY_MEDIA_GRANT_TTL_MS };
  }

  consume({ webContentsId, processId, routingId, url, isTopLevel }) {
    const grant = this.grant;
    if (!grant) return false;
    if (grant.expiresAt <= this.now()) {
      this.grant = null;
      return false;
    }
    const matches =
      isTopLevel === true &&
      positiveInteger(webContentsId) === grant.webContentsId &&
      positiveInteger(processId) === grant.processId &&
      positiveInteger(routingId) === grant.routingId &&
      url === grant.url &&
      this.isAllowedUrl(url);
    if (!matches) return false;

    // Consume before any asynchronous source lookup so a second request from
    // the same frame cannot reuse the approval while capture setup is pending.
    this.grant = null;
    return true;
  }

  clear() {
    this.grant = null;
  }
}

module.exports = { DISPLAY_MEDIA_GRANT_TTL_MS, DisplayMediaGrantManager };
