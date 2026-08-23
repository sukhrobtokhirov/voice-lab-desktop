const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), "utf8");

test("new installations show onboarding before the live reauthentication gate", () => {
  const router = read("src/AppRouter.jsx");

  assert.doesNotMatch(router, /needsReauth|setNeedsReauth/);
  assert.match(router, /isControlPanel && authLoaded && !isSignedIn/);

  const authGate = router.indexOf("isControlPanel && authLoaded && !isSignedIn");
  const onboarding = router.indexOf("isControlPanel && showOnboarding");
  const dashboard = router.indexOf("<ControlPanel initialSettingsSection=");
  assert.ok(
    onboarding > -1 && onboarding < authGate,
    "onboarding must render before the auth gate"
  );
  assert.ok(authGate > -1 && authGate < dashboard, "auth gate must render before dashboard");
});

test("browser sign-in starts only after an explicit user action", () => {
  const authentication = read("src/components/AuthenticationStep.tsx");

  assert.match(authentication, /onClick=\{start\}/);
  assert.doesNotMatch(authentication, /autoStarted|void start\(\)/);
  assert.doesNotMatch(authentication, /authErrorMessage|authErrorRequestId|authErrorFields/);
  assert.match(authentication, /hasStarted/);
});

test("onboarding returns to account authorization when its session is lost", () => {
  const onboarding = read("src/components/OnboardingFlow.tsx");

  assert.match(onboarding, /useAuth\(\)/);
  assert.match(onboarding, /authLoaded && !isSignedIn && stepIndex > authStepIndex/);
  assert.match(onboarding, /go\("mode"\)/);
});

test("macOS accessibility action performs one explicit native request", () => {
  const permissions = read("src/hooks/usePermissions.ts");
  const prompt = permissions.indexOf("promptAccessibilityPermission");
  const settings = permissions.indexOf(
    'openSystemSettings("accessibility", window.electronAPI?.openAccessibilitySettings)',
    prompt
  );

  assert.ok(prompt > -1, "macOS TCC prompt must be requested");
  assert.equal(settings, -1, "the native prompt must not race a second Settings action");
  assert.match(permissions, /if \(accessibilityRequestInFlight\.current\) return/);
});

test("macOS accessibility prompt is only reachable from the explicit permissions action", () => {
  const controlPanel = read("src/components/ControlPanel.tsx");
  const permissions = read("src/hooks/usePermissions.ts");
  const main = read("main.js");

  assert.doesNotMatch(controlPanel, /promptAccessibilityPermission/);
  assert.doesNotMatch(controlPanel, /requestAccessibilityAfterSignIn/);
  assert.doesNotMatch(main, /setTimeout\(checkAndNotifyAccessibility/);
  assert.match(
    permissions,
    /const requestAccessibilityPermission = useCallback[\s\S]*promptAccessibilityPermission/
  );
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
