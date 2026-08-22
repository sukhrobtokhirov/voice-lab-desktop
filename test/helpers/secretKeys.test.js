const test = require("node:test");
const assert = require("node:assert");
const os = require("os");
const path = require("path");
const fs = require("fs");
const Module = require("module");

// Point Electron paths at an isolated directory before environment.js loads.
const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), "ow-secret-test-"));
process.resourcesPath = tmpUserData; // Electron-only global; harmless dummy for the .env fallback scan
const fakeElectron = {
  app: { getPath: () => tmpUserData },
};
const origLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "electron") return fakeElectron;
  return origLoad.call(this, request, ...rest);
};

const { BYOK_API_KEYS } = require("../../src/config/secretKeys");
const EnvironmentManager = require("../../src/helpers/environment");

test("manifest entries are unique and complete", () => {
  const seen = { base: new Set(), env: new Set(), storeKey: new Set() };
  for (const k of BYOK_API_KEYS) {
    for (const field of ["base", "env", "get", "save", "storeKey"]) {
      assert.ok(k[field], `${field} present on ${k.base}`);
    }
    for (const field of ["base", "env", "storeKey"]) {
      assert.ok(!seen[field].has(k[field]), `duplicate ${field}: ${k[field]}`);
      seen[field].add(k[field]);
    }
  }
});

test("every BYOK key round-trips through the generated accessors", () => {
  const env = new EnvironmentManager();
  for (const k of BYOK_API_KEYS) {
    assert.equal(typeof env[k.get], "function", `${k.get} generated`);
    assert.equal(typeof env[k.save], "function", `${k.save} generated`);

    const secret = `sk-test-${k.base}-123`;
    env[k.save](secret);
    assert.equal(env[k.get](), secret, `${k.base} round-trips`);
    assert.equal(process.env[k.env], secret, `${k.base} persisted to its env var`);

    env[k.save]("");
    assert.equal(env[k.get](), "", `${k.base} clears`);
    assert.equal(process.env[k.env], undefined, `${k.base} env var removed on clear`);
  }
});

test("openrouter is a first-class secret", () => {
  const or = BYOK_API_KEYS.find((k) => k.base === "openrouter");
  assert.ok(or, "openrouter present in manifest");
  assert.equal(or.env, "OPENROUTER_API_KEY");
  const env = new EnvironmentManager();
  env.saveOpenrouterKey("sk-or-abc");
  assert.equal(env.getOpenrouterKey(), "sk-or-abc");
});

test("preload exposes opaque credential operations instead of raw BYOK accessors", () => {
  const preloadSrc = fs.readFileSync(path.join(__dirname, "../../preload.js"), "utf8");
  assert.doesNotMatch(preloadSrc, /BYOK_KEY_BRIDGES/, "legacy raw-key bridge is absent");
  for (const k of BYOK_API_KEYS) {
    assert.doesNotMatch(
      preloadSrc,
      new RegExp(`\\b${k.get}\\s*:`),
      `${k.get} is not exposed to the renderer`
    );
    assert.doesNotMatch(
      preloadSrc,
      new RegExp(`\\b${k.save}\\s*:`),
      `${k.save} is not exposed to the renderer`
    );
  }
  assert.match(preloadSrc, /providerCredentialStatus:/);
  assert.match(preloadSrc, /providerSaveCredential:/);
});

test("scope-specific custom provider secrets never initialize from localStorage", () => {
  const source = fs.readFileSync(
    path.join(__dirname, "../../src/stores/settingsStore.ts"),
    "utf8"
  );
  for (const key of [
    "noteFormattingCustomApiKey",
    "translationCustomApiKey",
    "chatAgentCustomApiKey",
    "dictationAgentCustomApiKey",
  ]) {
    assert.doesNotMatch(source, new RegExp(`${key}: readString\\(`), key);
    assert.match(source, new RegExp(`set${key[0].toUpperCase()}${key.slice(1)}: createSecretSetter`));
  }
  assert.match(source, /providerSaveCredential\?\.\("cleanupCustom", legacyCustomSecret\)/);
});
