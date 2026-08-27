import db from "../config/db.js";
const defaultMaxHourlyBookingHours = 12;

const MAX_HOURLY_BOOKING_HOURS_KEY = "maxHourlyBookingHours";

function parsePositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
}

export async function getSetting(key) {
  const result = await db.query(
    `SELECT setting_value
     FROM app_settings
     WHERE setting_key = $1
     LIMIT 1`,
    [key]
  );

  return result.rowCount ? result.rows[0].setting_value : null;
}

export async function setSetting(key, value) {
  await db.query(
    `INSERT INTO app_settings (setting_key, setting_value)
     VALUES ($1, $2)
     ON CONFLICT (setting_key)
     DO UPDATE SET setting_value = EXCLUDED.setting_value, updated_at = now()`,
    [key, String(value)]
  );
}

export async function getMaxHourlyBookingHours() {
  const settingValue = await getSetting(MAX_HOURLY_BOOKING_HOURS_KEY);
  return parsePositiveInteger(settingValue, defaultMaxHourlyBookingHours);
}