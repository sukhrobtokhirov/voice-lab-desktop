const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

function handlerBlock(source, channel) {
  const start = source.indexOf(`this._handle("${channel}"`);
  assert.notEqual(start, -1, `Expected ${channel} handler`);
  const end = source.indexOf("\n    this._handle(", start + 1);
  return source.slice(start, end === -1 ? source.length : end);
}

function stringValues(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === "object") return Object.values(value).flatMap(stringValues);
  return [];
}

test("authenticated status does not bootstrap desktop sync", () => {
  const source = read("src/helpers/ipcHandlers.js");
  const listenerStart = source.indexOf('this.desktopAuthManager?.on?.("status"');
  const listenerEnd = source.indexOf("this.oauthProtocolRegistered", listenerStart);
  const listener = source.slice(listenerStart, listenerEnd);

  assert.notEqual(listenerStart, -1);
  assert.match(listener, /handleAuthStatus/);
  assert.doesNotMatch(listener, /_bootstrapDesktopSync|_runDesktopSync|getSyncBootstrap/);
});

test("renderer startup and editing paths cannot activate desktop sync", () => {
  const router = read("src/AppRouter.jsx");
  const syncService = read("src/services/SyncService.ts");

  assert.doesNotMatch(router, /SyncService|startAutoSync/);
  assert.match(syncService, /canSync\(\): boolean \{\s*return false;/);
  assert.doesNotMatch(syncService, /electronAPI|setInterval|addEventListener|desktopSyncRun/);
});

test("post-login usage exposes static STT capabilities without wallet or pricing requests", () => {
  const usage = read("src/hooks/useUsage.ts");
  const ipcHandlers = read("src/helpers/ipcHandlers.js");
  const config = handlerBlock(ipcHandlers, "get-stt-config");

  assert.doesNotMatch(usage, /cloudUsage|cloud-usage|getWallet/);
  assert.doesNotMatch(usage, /desktopPricing|loadPricing|pricingRequest/);
  assert.match(usage, /desktopSubscription/);
  assert.match(usage, /SUPPORTED_LANGUAGES = \["uz", "en", "ru"\]/);
  assert.match(usage, /autoDetectionSupported: false/);
  assert.doesNotMatch(usage, /subscriptionFromUser|subscription_status|subscriptionStatus/);
  assert.match(config, /supportedLanguages: \["uz", "en", "ru"\]/);
  assert.match(config, /autoDetectionSupported: false/);
  assert.doesNotMatch(config, /maxDurationSeconds|dailyMinutes|maxRecordingSeconds/);
  assert.doesNotMatch(config, /getWallet|cloudUsage|proxyFetch/);
});

test("cloud health is a local auth check and billing remains an explicit link", () => {
  const source = read("src/helpers/ipcHandlers.js");
  const health = handlerBlock(source, "cloud-health-check");

  assert.match(health, /getPublicStatus/);
  assert.match(health, /authenticated/);
  assert.doesNotMatch(health, /getWallet|proxyFetch|net\.fetch/);
  assert.match(source, /this\._handle\("open-voicelab-billing"/);
  assert.doesNotMatch(source, /this\._handle\("desktop-pricing"/);
  assert.match(source, /this\._handle\("desktop-subscription"/);
  assert.doesNotMatch(source, /getDesktopPricing/);
  assert.match(source, /getDesktopUsage/);
  assert.match(source, /shell\.openExternal\(this\.voiceLabApiClient\.getBillingUrl\(source\)\)/);
});

test("renderer branding and browser protocol guidance are VoiceLab-only", () => {
  const index = read("src/index.html");
  const shareDialog = read("src/components/notes/ShareNoteDialog.tsx");
  const inferenceEditor = read("src/components/settings/InferenceConfigEditor.tsx");

  assert.match(index, /<title>VoiceLab<\/title>/);
  assert.doesNotMatch(index, /OpenWhispr/i);
  assert.doesNotMatch(shareDialog, /notes\.openwhispr\.com|SHARE_VIEWER_BASE_URL/);
  assert.match(inferenceEditor, /id: "voicelab"/);
  assert.match(inferenceEditor, /mode === "voicelab" \? "openwhispr" : mode/);

  const localeDir = path.join(root, "src", "locales");
  for (const locale of fs.readdirSync(localeDir)) {
    const file = path.join(localeDir, locale, "translation.json");
    if (!fs.existsSync(file)) continue;
    const values = stringValues(JSON.parse(fs.readFileSync(file, "utf8")));
    const visibleText = values.join("\n");
    assert.doesNotMatch(visibleText, /open ?whispr|open-whispr/i, locale);
    assert.match(visibleText, /voicelab:\/\//, locale);
    assert.ok(values.length > 0);
  }
});

test("VoiceLab AI remains hidden behind its disabled product flag", () => {
  const features = read("src/lib/features.ts");
  const sidebar = read("src/components/ControlPanelSidebar.tsx");
  const controlPanel = read("src/components/ControlPanel.tsx");
  const history = read("src/components/HistoryView.tsx");

  assert.match(features, /export const VOICELAB_AI_ENABLED = false/);
  assert.match(sidebar, /VOICELAB_AI_ENABLED[\s\S]*label: "VoiceLab AI"/);
  assert.match(controlPanel, /VOICELAB_AI_ENABLED && activeView === "chat"/);
  assert.match(history, /VOICELAB_AI_ENABLED && !useCleanupModel/);
});

test("usage UI uses the desktop entitlement and keeps website billing reachable", () => {
  const hook = read("src/hooks/useUsage.ts");
  const display = read("src/components/UsageDisplay.tsx");

  assert.doesNotMatch(
    hook,
    /balanceCredits|availableCredits|reservedCredits|estimatedCredits|chargedCredits|topUpUrl/
  );
  assert.doesNotMatch(hook, /plan: "free"/);
  assert.match(hook, /result\.entitlement\.active/);
  assert.match(
    hook,
    /status: entitlement \? \(entitlement\.active \? "active" : "inactive"\) : "unknown"/
  );
  assert.match(hook, /\[isSignedIn, user\?\.id, loadSubscription\]/);
  assert.match(display, /if \(!usage\) return null/);
  assert.doesNotMatch(display, /usage\.plans|planPrice|priceCompact/);
  assert.match(display, /usage\.openBillingPortal\(\)/);
  assert.doesNotMatch(display, /Live balance|AI Credit wallet/);
});
