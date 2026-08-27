const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const localesRoot = path.join(root, "src/locales");
const localeFiles = fs
  .readdirSync(localesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(localesRoot, entry.name, "translation.json"))
  .filter((file) => fs.existsSync(file));

const get = (object, key) => key.split(".").reduce((value, part) => value?.[part], object);

test("desktop accessibility labels exist in every locale", () => {
  const required = [
    "common.cancel",
    "common.close",
    "common.confirm",
    "common.copyError",
    "common.dismiss",
    "common.loading",
    "common.ok",
  ];

  for (const file of localeFiles) {
    const locale = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const key of required) {
      assert.equal(
        typeof get(locale, key),
        "string",
        `${path.basename(path.dirname(file))} is missing ${key}`
      );
      assert.notEqual(get(locale, key).trim(), "", `${key} must not be blank in ${file}`);
    }
  }
});

test("visible locale copy uses the current product name and cloud-only offline behavior", () => {
  for (const file of localeFiles) {
    const source = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\b(?:OpenWhispr|OpenWhisper|Whispr)\b/, file);
    assert.doesNotMatch(source, /VoiceLab Desktop/, file);

    const locale = JSON.parse(source);
    assert.doesNotMatch(
      locale.desktop.offline,
      /local dictation|lokal diktant|lokale(?:s|n)? Diktieren|dictado local|dictée locale|dettatura locale|локальная диктовка|ローカルディクテーション|本地听写|本地聽寫/i,
      `${file} must not claim that local transcription remains available`
    );
  }
});

test("critical Uzbek overlay copy is localized", () => {
  const english = require(path.join(localesRoot, "en/translation.json"));
  const uzbek = require(path.join(localesRoot, "uz/translation.json"));
  const keys = [
    "promptStudio.defaultTestInput",
    "updateNotification.title",
    "updateNotification.body",
    "updateNotification.cta",
    "transcriptionPreview.label",
    "transcriptionPreview.listening",
    "transcriptionPreview.polishing",
    "transcriptionPreview.waitingForInput",
    "meetingNotification.title",
    "meetingNotification.body.detected",
    "meetingNotification.start",
    "meetingNotification.join",
  ];

  for (const key of keys) {
    assert.notEqual(get(uzbek, key), get(english, key), `${key} still falls back to English`);
  }
});

test("compact overlay controls have localized accessible names", () => {
  const files = [
    "src/components/TranscriptionPreviewOverlay.tsx",
    "src/components/PushNotificationCard.tsx",
  ];

  for (const relative of files) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /aria-label=\{t\("common\.(?:close|dismiss)"\)\}/, relative);
    assert.doesNotMatch(source, /text-\[11px\]/, `${relative} uses inaccessible 11px copy`);
  }
});

test("meeting prompts keep the custom notification surface while updates use native notifications", () => {
  const meetingOverlay = fs.readFileSync(
    path.join(root, "src/components/MeetingNotificationCard.tsx"),
    "utf8"
  );
  const updater = fs.readFileSync(path.join(root, "src/updater.js"), "utf8");

  assert.match(meetingOverlay, /PushNotificationCard/);
  assert.match(updater, /Notification\.isSupported\(\)/);
  assert.match(updater, /new Notification\(/);
  assert.match(updater, /CREATIVE_UPDATE_MESSAGE_KEYS/);
  assert.match(updater, /Math\.floor\(Math\.random\(\) \* CREATIVE_UPDATE_MESSAGE_KEYS\.length\)/);
  assert.match(updater, /timeoutType: "never"/);
  assert.doesNotMatch(updater, /showUpdateNotification\(/);
});

test("creative native update copy is available in every supported locale", () => {
  const messageKeys = ["betterListener", "listenHarder", "improveItself", "fixedEarly"];

  for (const file of localeFiles) {
    const locale = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const messageKey of messageKeys) {
      for (const field of ["title", "description"]) {
        const value = get(locale, `updateNotification.messages.${messageKey}.${field}`);
        assert.equal(typeof value, "string", `${file} is missing ${messageKey}.${field}`);
        assert.notEqual(value.trim(), "", `${file} has blank ${messageKey}.${field}`);
      }
    }
  }
});

test("fake update notifications are explicitly limited to local development", () => {
  const main = fs.readFileSync(path.join(root, "main.js"), "utf8");
  const updater = fs.readFileSync(path.join(root, "src/updater.js"), "utf8");

  assert.match(main, /process\.env\.NODE_ENV === "development"/);
  assert.match(main, /process\.env\.VOICELAB_TEST_UPDATE_NOTIFICATION === "1"/);
  assert.match(
    main,
    /showNativeUpdateNotification\(\{ version: "1\.0\.2-test" \}, \{ preview: true \}\)/
  );
  assert.match(updater, /if \(preview\) \{/);
  assert.match(updater, /autoUpdater\.autoInstallOnAppQuit = true/);
  assert.match(updater, /shouldRemindAboutUpdate\(info\?\.version\)/);
  assert.match(updater, /readyToInstall: true/);
  assert.match(updater, /controlPanel\.update\.installButton/);
  assert.match(updater, /const TWO_HOURS_MS = 2 \* 60 \* 60 \* 1000/);
});
