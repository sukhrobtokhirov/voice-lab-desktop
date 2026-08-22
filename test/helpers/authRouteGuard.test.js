const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("control panel derives its reauthentication gate from live auth state", () => {
  const router = read("src/AppRouter.jsx");

  assert.doesNotMatch(router, /needsReauth|setNeedsReauth/);
  assert.match(router, /isControlPanel && authLoaded && !isSignedIn/);

  const authGate = router.indexOf("isControlPanel && authLoaded && !isSignedIn");
  const onboarding = router.indexOf("isControlPanel && showOnboarding");
  const dashboard = router.indexOf("<ControlPanel initialSettingsSection=");
  assert.ok(authGate > -1 && authGate < onboarding, "auth gate must render before onboarding");
  assert.ok(authGate > -1 && authGate < dashboard, "auth gate must render before dashboard");
});

test("expired sessions show the reauthentication reason without reopening the browser", () => {
  const authentication = read("src/components/AuthenticationStep.tsx");

  assert.match(authentication, /AUTH_EXPIRED: "auth\.desktopUnauthorized"/);
  assert.match(
    authentication,
    /authStatus === "signed-out"[\s\S]*authErrorCode \? localizedAuthError\(t, authErrorCode\) : null/
  );
  assert.match(authentication, /Boolean\(authErrorCode\)/);

  const errorGuard = authentication.indexOf("Boolean(authErrorCode)");
  const automaticStart = authentication.indexOf("void start()", errorGuard);
  assert.ok(errorGuard > -1 && automaticStart > errorGuard);
});

test("onboarding returns to account authorization when its session is lost", () => {
  const onboarding = read("src/components/OnboardingFlow.tsx");

  assert.match(onboarding, /useAuth\(\)/);
  assert.match(onboarding, /authLoaded && !isSignedIn && stepIndex > authStepIndex/);
  assert.match(onboarding, /go\("mode"\)/);
});

test("macOS accessibility action registers the running build before opening settings", () => {
  const permissions = read("src/hooks/usePermissions.ts");
  const prompt = permissions.indexOf("promptAccessibilityPermission");
  const settings = permissions.indexOf(
    'openSystemSettings("accessibility", window.electronAPI?.openAccessibilitySettings)',
    prompt
  );

  assert.ok(prompt > -1, "macOS TCC prompt must be requested");
  assert.ok(settings > prompt, "System Settings fallback must follow the TCC prompt");
});

test("macOS activation cannot start a duplicate packaged main-window load", () => {
  const windows = read("src/helpers/windowManager.js");

  assert.match(windows, /this\._mainWindowCreationPromise = null/);
  assert.match(windows, /if \(this\._mainWindowCreationPromise\)/);
  assert.match(windows, /return this\._mainWindowCreationPromise/);
  assert.match(windows, /const creation = this\._createMainWindow\(\)/);
  assert.match(windows, /this\._mainWindowCreationPromise = creation/);

  const promiseGuard = windows.indexOf("if (this._mainWindowCreationPromise)");
  const liveWindowGuard = windows.indexOf("if (this.mainWindow && !this.mainWindow.isDestroyed())");
  assert.ok(promiseGuard > -1 && promiseGuard < liveWindowGuard);

  assert.match(windows, /this\._windowLoadPromises = new WeakMap\(\)/);
  assert.match(windows, /this\._windowLoadPromises\.get\(window\)/);
  assert.match(windows, /this\._controlPanelCreationPromise = null/);
  assert.match(windows, /if \(this\._controlPanelCreationPromise\)/);
});

test("restricted renderer preloads do not call missing dictionary mutation capabilities", () => {
  const settings = read("src/stores/settingsStore.ts");

  assert.match(settings, /const saveDictionary = window\.electronAPI\?\.setDictionary/);
  assert.match(settings, /if \(!saveDictionary\)/);
  assert.doesNotMatch(settings, /electronAPI\s*\n\s*\?\.setDictionary\(words\)/);
});

test("macOS Chromium profile storage never opens the system Keychain", () => {
  const main = read("main.js");
  const electronImport = main.indexOf('} = require("electron")');
  const mockKeychain = main.indexOf('app.commandLine.appendSwitch("use-mock-keychain")');
  const ready = main.indexOf("app.whenReady");

  assert.ok(mockKeychain > electronImport, "switch must be registered after Electron loads");
  assert.ok(ready === -1 || mockKeychain < ready, "switch must be registered before app ready");
});

test("onboarding navigation uses an existing translated common action", () => {
  const onboarding = read("src/components/OnboardingFlow.tsx");

  assert.match(onboarding, /t\("common\.next"\)/);
  assert.doesNotMatch(onboarding, /t\("common\.continue"\)/);
});

test("onboarding replaces an unsupported automatic language and keeps actions visible", () => {
  const onboarding = read("src/components/OnboardingFlow.tsx");

  assert.match(onboarding, /item\.value !== "auto" && !item\.disabled/);
  assert.match(onboarding, /setLanguage\(fallback\.value\)/);
  assert.match(onboarding, /<footer className="[^"]*shrink-0/);
  assert.match(onboarding, /<main className="[^"]*min-h-0/);
});

test("settings keeps both interface and transcription language selectors reachable", () => {
  const modal = read("src/components/SettingsModal.tsx");
  const settings = read("src/components/SettingsPage.tsx");

  assert.match(modal, /CANONICAL_SECTIONS[\s\S]*"general"/);
  assert.match(modal, /id: "general"/);
  assert.doesNotMatch(modal, /general: "speechToText"/);
  assert.match(settings, /value=\{uiLanguage\}/);
  assert.match(settings, /onChange=\{setUiLanguage\}/);
  assert.match(settings, /value=\{preferredLanguage\}/);
  assert.match(settings, /updateTranscriptionSettings\(\{ preferredLanguage: value \}\)/);
});
