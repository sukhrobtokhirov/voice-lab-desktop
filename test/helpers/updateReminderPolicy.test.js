const assert = require("node:assert/strict");
const test = require("node:test");
const {
  UPDATE_REMINDER_INTERVAL_MS,
  shouldShowUpdateReminder,
} = require("../../src/helpers/updateReminderPolicy");

test("a version without a previous alert is eligible for a reminder", () => {
  assert.equal(shouldShowUpdateReminder(undefined, 1_000), true);
});

test("reminders use a two-hour interval", () => {
  assert.equal(UPDATE_REMINDER_INTERVAL_MS, 2 * 60 * 60 * 1000);
});

test("a version is not reminded again during the two-hour cooldown", () => {
  const firstAlertAt = 1_000;
  assert.equal(
    shouldShowUpdateReminder(firstAlertAt, firstAlertAt + UPDATE_REMINDER_INTERVAL_MS - 1),
    false
  );
});

test("a version is eligible again after the two-hour cooldown", () => {
  const firstAlertAt = 1_000;
  assert.equal(
    shouldShowUpdateReminder(firstAlertAt, firstAlertAt + UPDATE_REMINDER_INTERVAL_MS),
    true
  );
});
