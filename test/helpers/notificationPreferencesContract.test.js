const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.join(__dirname, "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const {
  DEFAULT_NOTIFICATION_PREFERENCES,
  normalizeNotificationPreferences,
} = require("../../src/helpers/notificationPreferencesStore");

test("notification preferences only accept explicit boolean values", () => {
  assert.deepEqual(normalizeNotificationPreferences({}), DEFAULT_NOTIFICATION_PREFERENCES);
  assert.deepEqual(
    normalizeNotificationPreferences({
      notificationsEnabled: false,
      notifyMeetingDetection: "false",
      unknown: false,
    }),
    {
      ...DEFAULT_NOTIFICATION_PREFERENCES,
      notificationsEnabled: false,
    }
  );
});

test("notification settings persist in the main process before update checks run", () => {
  const manager = read("src/helpers/windowManager.js");
  const handlers = read("src/helpers/ipcHandlers.js");

  assert.match(manager, /this\.notificationPrefs = readNotificationPreferences\(\)/);
  assert.match(manager, /updateNotificationPreferences\(preferences\)/);
  assert.match(manager, /saveNotificationPreferences\(/);
  assert.match(handlers, /this\.windowManager\.updateNotificationPreferences\(prefs\)/);
});

test("all notification deliveries obey their switches", () => {
  const updater = read("src/updater.js");
  const meetingDetection = read("src/helpers/meetingDetectionEngine.js");
  const toasts = read("src/components/ui/Toast.tsx");

  assert.match(updater, /areNativeUpdateNotificationsEnabled\(\)/);
  assert.match(updater, /if \(!preview && !this\.areNativeUpdateNotificationsEnabled\(\)\)/);
  assert.match(updater, /reconcileNativeUpdateNotification\(\)/);
  assert.match(meetingDetection, /source === "calendar" \? "notifyCalendarReminders" : "notifyMeetingDetection"/);
  assert.match(meetingDetection, /reconcileNotificationPreferences\(\)/);
  assert.match(toasts, /if \(!isError && !getSettings\(\)\.notificationsEnabled\) return id/);
});
