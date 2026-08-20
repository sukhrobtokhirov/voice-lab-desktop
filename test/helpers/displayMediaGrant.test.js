const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  DISPLAY_MEDIA_GRANT_TTL_MS,
  DisplayMediaGrantManager,
} = require("../../src/helpers/displayMediaGrant");

const projectDir = path.resolve(__dirname, "../..");
const TRUSTED_URL = "file:///opt/VoiceLab/resources/app.asar/src/dist/index.html?panel=true";

function identity(overrides = {}) {
  return {
    webContentsId: 17,
    processId: 2201,
    routingId: 9,
    url: TRUSTED_URL,
    isTopLevel: true,
    ...overrides,
  };
}

test("display-media grant is bound to one trusted top-level frame and consumed once", () => {
  let now = 1_000;
  const grants = new DisplayMediaGrantManager({
    now: () => now,
    isAllowedUrl: (url) => url === TRUSTED_URL,
  });

  assert.deepEqual(grants.arm(identity()), { expiresInMs: DISPLAY_MEDIA_GRANT_TTL_MS });
  assert.equal(grants.consume(identity({ isTopLevel: false })), false);
  assert.equal(grants.consume(identity({ routingId: 10 })), false);
  assert.equal(grants.consume(identity({ processId: 2202 })), false);
  assert.equal(grants.consume(identity({ webContentsId: 18 })), false);
  assert.equal(grants.consume(identity({ url: `${TRUSTED_URL}#changed` })), false);

  assert.equal(grants.consume(identity()), true);
  assert.equal(grants.consume(identity()), false);
  now += 1;
});

test("display-media grant rejects untrusted initiators and expires quickly", () => {
  let now = 5_000;
  const grants = new DisplayMediaGrantManager({
    now: () => now,
    isAllowedUrl: (url) => url === TRUSTED_URL,
  });

  assert.throws(() => grants.arm(identity({ url: "https://attacker.example" })), {
    code: "DISPLAY_MEDIA_INITIATOR_FORBIDDEN",
  });
  grants.arm(identity());
  now += DISPLAY_MEDIA_GRANT_TTL_MS;
  assert.equal(grants.consume(identity()), false);
});

test("Windows capture integration arms immediately before getDisplayMedia and verifies frame IDs", () => {
  const store = fs.readFileSync(
    path.join(projectDir, "src", "stores", "meetingRecordingStore.ts"),
    "utf8"
  );
  const armIndex = store.indexOf("armDisplayMediaCapture?.()");
  const captureIndex = store.indexOf("navigator.mediaDevices.getDisplayMedia", armIndex);
  assert.ok(armIndex > 0 && captureIndex > armIndex);

  const main = fs.readFileSync(path.join(projectDir, "main.js"), "utf8");
  const handlerStart = main.indexOf("setDisplayMediaRequestHandler");
  const sourceLookup = main.indexOf("desktopCapturer", handlerStart);
  const handler = main.slice(handlerStart, sourceLookup);
  assert.match(handler, /webContents\.fromFrame\(frame\)/);
  assert.match(handler, /processId: frame\?\.processId/);
  assert.match(handler, /routingId: frame\?\.routingId/);
  assert.match(handler, /frame\.parent === null && frame\.top === frame/);
  assert.match(handler, /displayMediaGrantManager\?\.consume/);
});
