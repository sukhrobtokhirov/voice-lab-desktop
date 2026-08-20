const RUNTIME_AUTH_DEFAULTS = Object.freeze({
  development: Object.freeze({
    apiBaseUrl: "http://localhost:8000",
    browserOrigins: Object.freeze(["http://localhost:3000"]),
  }),
  staging: Object.freeze({
    apiBaseUrl: "https://api-staging.voicelab.uz",
    browserOrigins: Object.freeze(["https://staging.voicelab.uz"]),
  }),
  production: Object.freeze({
    apiBaseUrl: "https://api.voicelab.uz",
    browserOrigins: Object.freeze(["https://voicelab.uz"]),
  }),
});

function validateOrigin(value, label, channel) {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${label} must be a valid origin`);
  }
  const localDevelopment =
    channel === "development" &&
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if ((!localDevelopment && url.protocol !== "https:") || url.username || url.password) {
    throw new Error(`${label} must use a trusted HTTPS origin`);
  }
  if ((url.pathname && url.pathname !== "/") || url.search || url.hash) {
    throw new Error(`${label} must be an origin without path, query, or fragment`);
  }
  return url.origin;
}

function resolveDesktopRuntimeAuthConfig({ channel, isPackaged, scheme, env = process.env }) {
  const defaults = RUNTIME_AUTH_DEFAULTS[channel];
  if (!defaults) throw new Error("VoiceLab desktop channel is invalid");

  // Production trust anchors must never come from the writable user profile or
  // inherited process environment. Development and staging retain overrides for
  // local testing and pre-production deployments.
  const pinProductionOrigins = isPackaged === true && channel === "production";
  const apiBaseUrl = (
    pinProductionOrigins ? defaults.apiBaseUrl : env.VOICELAB_DESKTOP_API_URL || defaults.apiBaseUrl
  ).trim();
  const configuredOrigins = pinProductionOrigins
    ? []
    : String(env.VOICELAB_DESKTOP_AUTH_ORIGINS || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  const browserOrigins = configuredOrigins.length
    ? configuredOrigins
    : [...defaults.browserOrigins];
  const normalizedApiOrigin = validateOrigin(apiBaseUrl, "VOICELAB_DESKTOP_API_URL", channel);
  const normalizedBrowserOrigins = browserOrigins.map((origin) =>
    validateOrigin(origin, "VOICELAB_DESKTOP_AUTH_ORIGINS", channel)
  );
  const configuredAuthOrigin = pinProductionOrigins
    ? normalizedBrowserOrigins[0]
    : String(env.VOICELAB_DESKTOP_AUTH_URL || normalizedBrowserOrigins[0]).trim();
  const authWebBaseUrl = validateOrigin(configuredAuthOrigin, "VOICELAB_DESKTOP_AUTH_URL", channel);
  if (!normalizedBrowserOrigins.includes(authWebBaseUrl)) {
    throw new Error("VOICELAB_DESKTOP_AUTH_URL must be included in VOICELAB_DESKTOP_AUTH_ORIGINS");
  }
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) {
    throw new Error("VoiceLab OAuth protocol is invalid");
  }
  return {
    apiBaseUrl: normalizedApiOrigin,
    authWebBaseUrl,
    authorizationOrigins: normalizedBrowserOrigins,
    billingOrigin: normalizedBrowserOrigins[0],
    scheme,
  };
}

module.exports = { RUNTIME_AUTH_DEFAULTS, resolveDesktopRuntimeAuthConfig };
