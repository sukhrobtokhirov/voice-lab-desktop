const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "../..");
const workflowsDir = path.join(root, ".github", "workflows");
const releasePath = path.join(workflowsDir, "release-desktop.yml");
const release = fs.readFileSync(releasePath, "utf8");
const workflows = fs
  .readdirSync(workflowsDir)
  .filter((name) => name.endsWith(".yml") || name.endsWith(".yaml"))
  .map((name) => [name, fs.readFileSync(path.join(workflowsDir, name), "utf8")]);

test("no workflow builds with direct electron-builder publication", () => {
  for (const [name, contents] of workflows) {
    assert.doesNotMatch(contents, /--publish\s+(?:always|onTagOrDraft)/, name);
  }
});

test("release builds are private and promotion is the only writer", () => {
  assert.match(release, /permissions:\n\s+contents: read/);
  assert.match(release, /build-macos:[\s\S]*?--publish never/);
  assert.match(release, /build-linux:[\s\S]*?--publish never/);
  assert.match(release, /build-windows:[\s\S]*?--publish never/);
  assert.match(release, /promote-release:[\s\S]*?permissions:\n\s+contents: write/);
  assert.match(release, /environment: desktop-release-production/);
  assert.equal((release.match(/gh release create/g) || []).length, 1);
  assert.doesNotMatch(release.slice(0, release.indexOf("promote-release:")), /gh release (?:create|upload)/);
});

test("all release architectures depend on the complete test gate", () => {
  for (const job of ["build-macos", "build-linux", "build-windows"]) {
    assert.match(
      release,
      new RegExp(`  ${job}:[\\s\\S]*?needs: \\[validate-release, test-gate\\]`),
      job
    );
  }
  assert.match(
    release,
    /needs: \[validate-release, test-gate, build-macos, build-linux, build-windows\]/
  );
});

test("manual and tag releases resolve immutable version provenance", () => {
  const contract = fs.readFileSync(path.join(root, "scripts", "release-contract.js"), "utf8");
  assert.match(release, /workflow_dispatch:[\s\S]*?tag:/);
  assert.match(release, /git rev-list -n 1 "\$RELEASE_TAG"/);
  assert.match(release, /release-contract\.js provenance/);
  assert.match(contract, /tag \$\{tag\} must equal v\$\{PACKAGE\.version\}/);
});

test("promotion stays private until every uploaded asset is counted", () => {
  const draftIndex = release.indexOf("--draft");
  const countIndex = release.indexOf("actual_count=");
  const publicIndex = release.indexOf('gh release edit "$TAG" --draft=false');
  assert.ok(draftIndex > 0);
  assert.ok(countIndex > draftIndex);
  assert.ok(publicIndex > countIndex);
  assert.match(release, /trap cleanup_draft EXIT/);
});

test("package verification covers signing, notarization, sidecars, preloads, and secrets", () => {
  const afterPack = fs.readFileSync(path.join(root, "scripts", "afterPack.js"), "utf8");
  assert.match(afterPack, /writePackageVerification/);
  assert.match(afterPack, /preloads: configuredPreloadPaths/);
  assert.match(afterPack, /sidecars: sidecarCount/);
  assert.match(afterPack, /packagedResourcesSecretFree: true/);
  assert.match(release, /VOICELAB_SIGNATURE_VERIFIED/);
  assert.match(release, /VOICELAB_NOTARIZATION_VERIFIED/);
  assert.match(release, /stapler validate/);
  assert.match(release, /Get-AuthenticodeSignature/);
});
