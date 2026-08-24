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

test("desktop push windows share the notification surface", () => {
  const overlays = [
    "src/components/MeetingNotificationCard.tsx",
    "src/components/UpdateNotificationOverlay.tsx",
  ];

  for (const relative of overlays) {
    const source = fs.readFileSync(path.join(root, relative), "utf8");
    assert.match(source, /PushNotificationCard/, `${relative} bypasses the shared push surface`);
  }
});
