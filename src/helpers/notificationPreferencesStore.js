const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const STORE_VERSION = 1;

const DEFAULT_NOTIFICATION_PREFERENCES = Object.freeze({
  notificationsEnabled: true,
  notifyMeetingDetection: true,
  notifyCalendarReminders: true,
  notifyUpdates: true,
});

const NOTIFICATION_PREFERENCE_KEYS = Object.freeze(
  Object.keys(DEFAULT_NOTIFICATION_PREFERENCES)
);

function normalizeNotificationPreferences(value, base = DEFAULT_NOTIFICATION_PREFERENCES) {
  const preferences = { ...DEFAULT_NOTIFICATION_PREFERENCES };

  for (const key of NOTIFICATION_PREFERENCE_KEYS) {
    if (typeof base?.[key] === "boolean") preferences[key] = base[key];
    if (typeof value?.[key] === "boolean") preferences[key] = value[key];
  }

  return preferences;
}

function getStorePath() {
  return path.join(app.getPath("userData"), "notification-preferences.json");
}

function readNotificationPreferences() {
  try {
    const parsed = JSON.parse(fs.readFileSync(getStorePath(), "utf8"));
    if (parsed?.version === STORE_VERSION && parsed.preferences) {
      return normalizeNotificationPreferences(parsed.preferences);
    }
  } catch {
    // First launch and malformed old files both safely use the defaults.
  }

  return { ...DEFAULT_NOTIFICATION_PREFERENCES };
}

function saveNotificationPreferences(preferences) {
  const destination = getStorePath();
  const value = normalizeNotificationPreferences(preferences);
  fs.mkdirSync(path.dirname(destination), { recursive: true });

  const temporary = `${destination}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  fs.writeFileSync(
    temporary,
    JSON.stringify({ version: STORE_VERSION, preferences: value }),
    { encoding: "utf8", mode: 0o600, flag: "wx" }
  );
  fs.renameSync(temporary, destination);

  try {
    fs.chmodSync(destination, 0o600);
  } catch {
    // The atomic write is still valid on platforms that do not support chmod.
  }

  return value;
}

module.exports = {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NOTIFICATION_PREFERENCE_KEYS,
  normalizeNotificationPreferences,
  readNotificationPreferences,
  saveNotificationPreferences,
};
