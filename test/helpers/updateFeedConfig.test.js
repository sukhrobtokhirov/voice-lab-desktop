const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PRODUCTION_UPDATE_FEED,
  resolveUpdateFeed,
} = require("../../src/helpers/updateFeedConfig");

test("packaged update feed ignores environment overrides", () => {
  assert.deepEqual(
    resolveUpdateFeed({
      isPackaged: true,
      nodeEnv: "development",
      owner: "attacker",
      repo: "payloads",
    }),
    PRODUCTION_UPDATE_FEED
  );
});

test("non-development unpackaged builds also stay on the production feed", () => {
  assert.deepEqual(
    resolveUpdateFeed({
      isPackaged: false,
      nodeEnv: "production",
      owner: "attacker",
      repo: "payloads",
    }),
    PRODUCTION_UPDATE_FEED
  );
});

test("development accepts only bounded GitHub owner and repo overrides", () => {
  assert.equal(
    resolveUpdateFeed({
      isPackaged: false,
      nodeEnv: "development",
      owner: "voice-dev",
      repo: "desktop.dev",
    }).repo,
    "desktop.dev"
  );
  assert.deepEqual(
    resolveUpdateFeed({
      isPackaged: false,
      nodeEnv: "development",
      owner: "bad/value",
      repo: "bad value",
    }),
    PRODUCTION_UPDATE_FEED
  );
});
