const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

function handlerBlock(source, channel) {
  const start = source.indexOf(`this._handle("${channel}"`);
  assert.notEqual(start, -1, `Expected ${channel} handler`);
  const end = source.indexOf("\n    this._handle(", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

test("desktop billing reads public pricing and authenticated subscription only", () => {
  const client = read("src/helpers/voiceLabApiClient.js");
  const ipc = read("src/helpers/ipcHandlers.js");
  const pricing = handlerBlock(ipc, "desktop-pricing");
  const subscription = handlerBlock(ipc, "desktop-subscription");
  const openBilling = handlerBlock(ipc, "open-voicelab-billing");

  assert.match(client, /DESKTOP_PRICING_PATH/);
  assert.match(client, /DESKTOP_SUBSCRIPTION_PATH/);
  assert.match(client, /async getDesktopPricing\(\)/);
  assert.match(client, /async getDesktopSubscription\(/);
  assert.doesNotMatch(client, /billing\/desktop\/polar\/checkout/);
  assert.match(pricing, /getDesktopPricing/);
  assert.match(subscription, /getDesktopSubscription/);
  assert.match(openBilling, /shell\.openExternal/);
  assert.match(openBilling, /getBillingUrl/);
  assert.doesNotMatch(openBilling, /checkout|accessToken|refreshToken/);
});

test("renderer treats entitlement active as authoritative and never infers it from user fields", () => {
  const hook = read("src/hooks/useUsage.ts");

  assert.match(hook, /desktopSubscription/);
  assert.match(hook, /return result\.entitlement\.active/);
  assert.match(hook, /const isSubscribed = entitlement \? entitlement\.active : null/);
  assert.doesNotMatch(
    hook,
    /subscriptionFromUser|subscription_status|subscriptionStatus|is_subscribed|isSubscribed\s*\?\?/
  );
  assert.doesNotMatch(hook, /\["active", "trial", "trialing"\]/);
});

test("website billing refresh waits for app return and uses bounded documented delays", () => {
  const hook = read("src/hooks/useUsage.ts");

  assert.match(hook, /BILLING_POLL_DELAYS_MS = \[1_000, 2_000, 3_000, 5_000, 8_000\]/);
  assert.match(hook, /billingReturnArmed\.current = true/);
  assert.match(hook, /window\.addEventListener\("focus", refreshAfterBillingReturn\)/);
  assert.match(hook, /document\.addEventListener\("visibilitychange", refreshAfterBillingReturn\)/);
  assert.match(hook, /for \(const delay of BILLING_POLL_DELAYS_MS\)/);
  assert.match(hook, /active === true/);
  assert.match(hook, /openVoiceLabBilling\("dictate"\)/);
});

test("sidebar and settings show server plan limits and manual refresh", () => {
  const display = read("src/components/UsageDisplay.tsx");
  const sidebar = read("src/components/ControlPanelSidebar.tsx");

  assert.match(sidebar, /<UsageDisplay compact \/>/);
  assert.match(display, /usage\.plans\[0\]/);
  assert.match(display, /usage\.plans\.map/);
  assert.match(display, /entitlement\.dailySeconds/);
  assert.match(display, /entitlement\.maxRequestSeconds/);
  assert.match(display, /plan\.dailyMinutes/);
  assert.match(display, /plan\.maxRecordingSeconds/);
  assert.match(display, /usage\.refetch\(\)/);
  assert.match(display, /disabled=\{!usage\.billingAvailable \|\| usage\.checkoutLoading\}/);
});

test("every locale contains the desktop subscription and plan labels", () => {
  const localeRoot = path.join(root, "src", "locales");
  for (const locale of fs.readdirSync(localeRoot)) {
    const file = path.join(localeRoot, locale, "translation.json");
    if (!fs.existsSync(file)) continue;
    const messages = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of [
      "active",
      "noActivePlan",
      "checking",
      "choosePlan",
      "dailyLimit",
      "maxRecording",
      "refresh",
    ]) {
      assert.equal(typeof messages.desktop?.wallet?.[key], "string", `${locale}: ${key}`);
    }
    assert.equal(typeof messages.desktop?.subscriptionPrompt?.title, "string", locale);
    assert.equal(typeof messages.desktop?.subscriptionPrompt?.limitDescription, "string", locale);
  }
});
