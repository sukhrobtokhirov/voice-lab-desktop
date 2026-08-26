const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const { shouldShowUpdateReminder } = require("./updateReminderPolicy");

const STORE_VERSION = 1;
const MAX_REMINDERS = 20;

function storePath() {
  return path.join(app.getPath("userData"), "update-reminders.json");
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    if (parsed?.version === STORE_VERSION && parsed.reminders && typeof parsed.reminders === "object") {
      return { version: STORE_VERSION, reminders: parsed.reminders };
    }
  } catch {}
  return { version: STORE_VERSION, reminders: {} };
}

function writeStore(store) {
  const destination = storePath();
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify({ ...store, version: STORE_VERSION }), {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
  fs.renameSync(temporary, destination);
  try {
    fs.chmodSync(destination, 0o600);
  } catch {}
}

function shouldRemindAboutUpdate(version, now = Date.now()) {
  if (!version) return false;
  return shouldShowUpdateReminder(readStore().reminders[version], now);
}

function recordUpdateReminder(version, now = Date.now()) {
  if (!version) return;
  const store = readStore();
  store.reminders[version] = now;

  const recentEntries = Object.entries(store.reminders)
    .filter(([, shownAt]) => Number.isFinite(shownAt))
    .sort(([, left], [, right]) => right - left)
    .slice(0, MAX_REMINDERS);
  store.reminders = Object.fromEntries(recentEntries);
  writeStore(store);
}

module.exports = {
  shouldRemindAboutUpdate,
  recordUpdateReminder,
};
