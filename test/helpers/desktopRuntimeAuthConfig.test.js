const assert = require("node:assert/strict");
const test = require("node:test");

const { resolveDesktopRuntimeAuthConfig } = require("../../src/helpers/desktopRuntimeAuthConfig");

test("packaged production pins VoiceLab auth trust anchors despite environment overrides", () => {
  const config = resolveDesktopRuntimeAuthConfig({
    channel: "production",
    isPackaged: true,
    scheme: "voicelab",
    env: {
      VOICELAB_DESKTOP_API_URL: "https://attacker.example",
      VOICELAB_DESKTOP_AUTH_ORIGINS: "https://attacker.example",
      VOICELAB_DESKTOP_AUTH_URL: "https://attacker.example",
    },
  });

  assert.deepEqual(config, {
    apiBaseUrl: "https://api.voicelab.uz",
    authWebBaseUrl: "https://voicelab.uz",
    authorizationOrigins: ["https://voicelab.uz"],
    billingOrigin: "https://voicelab.uz",
    scheme: "voicelab",
  });
});

test("development and staging retain validated endpoint overrides", () => {
  assert.deepEqual(
    resolveDesktopRuntimeAuthConfig({
      channel: "development",
      isPackaged: false,
      scheme: "voicelab-dev",
      env: {
        VOICELAB_DESKTOP_API_URL: "http://127.0.0.1:8800",
        VOICELAB_DESKTOP_AUTH_ORIGINS: "http://localhost:3300",
        VOICELAB_DESKTOP_AUTH_URL: "http://localhost:3300",
      },
    }),
    {
      apiBaseUrl: "http://127.0.0.1:8800",
      authWebBaseUrl: "http://localhost:3300",
      authorizationOrigins: ["http://localhost:3300"],
      billingOrigin: "http://localhost:3300",
      scheme: "voicelab-dev",
    }
  );

  assert.equal(
    resolveDesktopRuntimeAuthConfig({
      channel: "staging",
      isPackaged: true,
      scheme: "voicelab-staging",
      env: {
        VOICELAB_DESKTOP_API_URL: "https://api.preview.voicelab.uz",
        VOICELAB_DESKTOP_AUTH_ORIGINS: "https://preview.voicelab.uz",
      },
    }).apiBaseUrl,
    "https://api.preview.voicelab.uz"
  );
});

test("configurable channels still reject insecure or unbound origins", () => {
  assert.throws(
    () =>
      resolveDesktopRuntimeAuthConfig({
        channel: "staging",
        isPackaged: true,
        scheme: "voicelab-staging",
        env: { VOICELAB_DESKTOP_API_URL: "http://api.preview.voicelab.uz" },
      }),
    /trusted HTTPS origin/
  );
  assert.throws(
    () =>
      resolveDesktopRuntimeAuthConfig({
        channel: "staging",
        isPackaged: true,
        scheme: "voicelab-staging",
        env: {
          VOICELAB_DESKTOP_AUTH_ORIGINS: "https://preview.voicelab.uz",
          VOICELAB_DESKTOP_AUTH_URL: "https://attacker.example",
        },
      }),
    /must be included/
  );
});
