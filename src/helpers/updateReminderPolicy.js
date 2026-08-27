// Keep an available update visible without showing a notification on every
// update check. Two hours matches the background update-check cadence.
const UPDATE_REMINDER_INTERVAL_MS = 2 * 60 * 60 * 1000;

function shouldShowUpdateReminder(lastShownAt, now = Date.now()) {
  if (!Number.isFinite(lastShownAt)) return true;
  return now - lastShownAt >= UPDATE_REMINDER_INTERVAL_MS;
}

module.exports = {
  UPDATE_REMINDER_INTERVAL_MS,
  shouldShowUpdateReminder,
};
