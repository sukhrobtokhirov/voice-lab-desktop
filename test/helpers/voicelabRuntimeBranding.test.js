const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("packaged and OS-visible desktop identity is VoiceLab", () => {
  const main = read("main.js");
  const pkg = JSON.parse(read("package.json"));
  const builder = JSON.parse(read("electron-builder.json"));

  assert.equal(pkg.name, "voicelab-desktop");
  assert.equal(pkg.desktopName, "voicelab.desktop");
  assert.equal(builder.appId, "uz.voicelab.desktop");
  assert.equal(builder.productName, "VoiceLab");
  assert.equal(builder.linux.syncDesktopName, true);
  assert.deepEqual(builder.protocols.schemes, ["voicelab"]);
  assert.match(main, /const BASE_WINDOWS_APP_ID = "uz\.voicelab\.desktop"/);
  assert.match(main, /app\.setDesktopName\("voicelab\.desktop"\)/);
  assert.match(main, /app\.setName\("VoiceLab"\)/);
  assert.doesNotMatch(main, /registerOpenWhisprProtocol|OPENWHISPR_PROTOCOL is invalid/);
});

test("runtime uses canonical VoiceLab env keys while accepting legacy aliases", () => {
  const main = read("main.js");
  const logger = read("src/helpers/debugLogger.js");
  const downloader = read("src/helpers/urlAudioDownloader.js");
  const example = read(".env.example");

  assert.match(main, /const CHANNEL_ENV = "VOICELAB_CHANNEL"/);
  assert.match(main, /const LEGACY_CHANNEL_ENV = "OPENWHISPR_CHANNEL"/);
  assert.match(logger, /process\.env\.VOICELAB_LOG_LEVEL/);
  assert.match(logger, /process\.env\.OPENWHISPR_LOG_LEVEL/);
  assert.match(downloader, /process\.env\.VOICELAB_YTDLP_CACHE_DIR/);
  assert.match(downloader, /process\.env\.OPENWHISPR_YTDLP_CACHE_DIR/);
  assert.match(example, /^VOICELAB_CHANNEL=development$/m);
  assert.match(example, /^VOICELAB_LOG_LEVEL=info$/m);
  assert.doesNotMatch(example, /OPENWHISPR_PROTOCOL|VITE_OPENWHISPR_PROTOCOL/);
});

test("main-process user-visible labels and metadata use VoiceLab", () => {
  const files = [
    "src/helpers/environment.js",
    "src/helpers/menuManager.js",
    "src/helpers/downloadUtils.js",
    "src/helpers/safeTempDir.js",
    "src/helpers/globeKeyManager.js",
    "src/helpers/ensureYdotool.js",
  ];
  for (const file of files) {
    assert.doesNotMatch(read(file), /OpenWhispr/, file);
  }

  const ipc = read("src/helpers/ipcHandlers.js");
  assert.match(ipc, /managers\.oauthProtocol \|\| "voicelab"/);
  assert.doesNotMatch(ipc, /OpenWhispr API URL|Not an OpenWhispr temp file/);
  assert.match(read("src/helpers/downloadUtils.js"), /const USER_AGENT = "VoiceLab\/1\.0"/);
  assert.match(read("src/helpers/urlAudioDownloader.js"), /const USER_AGENT = "VoiceLab\/1\.0"/);
  assert.match(read("src/helpers/menuManager.js"), /github\.com\/voicelab-uz\/desktop/);
});

test("shortcut and native helper display names use VoiceLab", () => {
  const gnome = read("src/helpers/gnomeShortcut.js");
  const kde = read("src/helpers/kdeShortcut.js");
  const hyprland = read("src/helpers/hyprlandShortcut.js");
  const clipboard = read("src/helpers/clipboard.js");

  for (const label of ["Toggle", "Agent", "Meeting", "Voice Agent", "Translation"]) {
    assert.match(gnome, new RegExp(`name: "VoiceLab ${label}"`));
  }
  assert.match(kde, /const PRODUCT_NAME = "VoiceLab"/);
  assert.match(hyprland, /const BINDS_FILENAME = "voicelab-binds\.conf"/);
  assert.match(hyprland, /# VoiceLab keybinds \(managed automatically\)/);
  assert.doesNotMatch(clipboard, /OpenWhispr needs|Restart OpenWhispr|Add OpenWhispr/);

  const audioTap = read("resources/macos-audio-tap.swift");
  const fastPaste = read("resources/linux-fast-paste.c");
  assert.match(audioTap, /"VoiceLab Audio Tap"/);
  assert.match(audioTap, /uz\.voicelab\.desktop\.audio-tap/);
  assert.doesNotMatch(audioTap, /OpenWhispr|com\.openwhispr/);
  assert.match(fastPaste, /"voicelab-paste"/);
  assert.match(fastPaste, /"voicelab-media"/);
  assert.doesNotMatch(fastPaste, /g_variant_new_string\("openwhispr"\)/);
  assert.match(read("resources/linux-system-audio-helper.c"), /"voicelab-system-audio"/);
});

test("installers present VoiceLab and retain legacy cache cleanup", () => {
  const afterInstall = read("resources/linux/after-install.sh");
  const afterRemove = read("resources/linux/after-remove.sh");
  const nsis = read("resources/nsis/installer.nsh");

  assert.match(afterInstall, /dpkg -L voicelab-desktop/);
  assert.match(afterInstall, /\/opt\/VoiceLab\/chrome-sandbox/);
  assert.match(afterRemove, /\.cache\/voicelab/);
  assert.match(afterRemove, /\.cache\/openwhispr/);
  assert.doesNotMatch(afterRemove, /Removed OpenWhispr/);
  assert.match(nsis, /\.cache\\voicelab\\models/);
  assert.match(nsis, /\.cache\\openwhispr\\models/);
  assert.doesNotMatch(nsis, /Removed OpenWhispr/);
});

test("desktop secrets use local authenticated encryption without native vault dependencies", () => {
  const source = read("src/helpers/secretCrypto.js");
  const pkg = JSON.parse(read("package.json"));
  const lock = read("package-lock.json");
  const builder = JSON.parse(read("electron-builder.json"));

  assert.equal(pkg.dependencies["@napi-rs/keyring"], undefined);
  assert.doesNotMatch(source, /require\(["']electron["']\)|@napi-rs\/keyring|new Entry\(/);
  assert.doesNotMatch(lock, /node_modules\/@napi-rs\/keyring/);
  assert.match(source, /aes-256-gcm/);
  assert.match(source, /device-master-key\.v1/);
  assert.ok(builder.files.includes("!**/node_modules/@napi-rs/keyring/**"));
});

test("Google Calendar callback uses VoiceLab schemes with legacy env compatibility", () => {
  const source = read("src/helpers/googleCalendarOAuth.js");
  assert.match(source, /development: "voicelab-dev"/);
  assert.match(source, /staging: "voicelab-staging"/);
  assert.match(source, /production: "voicelab"/);
  assert.match(source, /process\.env\.VITE_VOICELAB_OAUTH_CALLBACK_URL/);
  assert.match(source, /process\.env\.VITE_OPENWHISPR_OAUTH_CALLBACK_URL/);
});
