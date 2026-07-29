const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeReleaseNotes,
  publicUpdateInfo,
} = require("../../src/helpers/releaseNotes");

test("release notes are normalized as bounded markdown text, not trusted HTML", () => {
  const input = `<img src=x onerror="globalThis.pwned=true">\u0000\n# Safe heading`;
  const output = normalizeReleaseNotes(input);
  assert.match(output, /<img src=x/);
  assert.doesNotMatch(output, /\u0000/);
  assert.ok(Buffer.byteLength(output, "utf8") <= 32 * 1024);
});

test("updater metadata exposed to renderers excludes artifact file details", () => {
  const output = publicUpdateInfo({
    version: "2.0.0",
    releaseName: "Release",
    releaseNotes: "<script>alert(1)</script>",
    files: [{ url: "https://example.test/app.zip", sha512: "secret" }],
    path: "/private/app.zip",
  });
  assert.equal(output.version, "2.0.0");
  assert.equal(Object.hasOwn(output, "files"), false);
  assert.equal(Object.hasOwn(output, "path"), false);
});
