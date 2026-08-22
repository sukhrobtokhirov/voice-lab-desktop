const assert = require("node:assert/strict");
const test = require("node:test");

const {
  compareVersions,
  isAllowedUpdate,
  isNewerVersion,
} = require("../../src/helpers/versionComparison");

test("update comparison accepts only a strictly newer semantic version", () => {
  assert.equal(isNewerVersion("1.7.17", "1.7.16"), true);
  assert.equal(isNewerVersion("1.8.0", "1.7.16"), true);
  assert.equal(isNewerVersion("2.0.0", "1.99.99"), true);
  assert.equal(isNewerVersion("1.7.16", "1.7.16"), false);
  assert.equal(isNewerVersion("1.7.15", "1.7.16"), false);
  assert.equal(isNewerVersion("v1.7.15", "1.7.16"), false);
});

test("stable releases outrank prereleases without enabling downgrade ambiguity", () => {
  assert.equal(compareVersions("1.8.0", "1.8.0-beta.2"), 1);
  assert.equal(compareVersions("1.8.0-beta.10", "1.8.0-beta.2"), 1);
  assert.equal(compareVersions("1.8.0-beta.2", "1.8.0"), -1);
  assert.equal(compareVersions("not-a-version", "1.8.0"), null);
  assert.equal(isNewerVersion("not-a-version", "1.8.0"), false);
});

test("the public 0.1.0 reset is the only legacy downgrade accepted", () => {
  assert.equal(isAllowedUpdate("0.1.0", "1.7.16"), true);
  assert.equal(isAllowedUpdate("0.0.9", "1.7.16"), false);
  assert.equal(isAllowedUpdate("1.7.15", "1.7.16"), false);
  assert.equal(isAllowedUpdate("1.7.15", "0.1.0"), false);
  assert.equal(isAllowedUpdate("0.1.1", "0.1.0"), true);
  assert.equal(isAllowedUpdate("1.0.0", "0.9.9"), true);
});

test("macOS updater explicitly disables downgrade and guards every update boundary", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const updater = fs.readFileSync(path.resolve(__dirname, "../../src/updater.js"), "utf8");

  assert.match(updater, /autoUpdater\.allowDowngrade = true/);
  assert.match(updater, /"update-available": \(info\) => \{[\s\S]*isAllowedUpdate/);
  assert.match(updater, /"update-downloaded": \(info\) => \{[\s\S]*isAllowedUpdate/);
  assert.match(updater, /async downloadUpdate\(\)[\s\S]*isAllowedUpdate/);
});
