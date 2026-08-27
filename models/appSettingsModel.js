import db from "../config/db.js";

export async function getSetting(key) {
  const result = await db.query(
    `
      SELECT setting_value
      FROM app_settings
      WHERE setting_key = $1
      LIMIT 1
    `,
    [key],
  );

  return result.rows[0]?.setting_value ?? null;
}

export async function getBookingSettings() {
  const result = await db.query(`
    SELECT setting_key, setting_value
    FROM app_settings
    WHERE setting_key IN (
      'max_concurrent_bookings',
      'booking_buffer_minutes',
      'booking_hold_minutes',
      'payment_percentage'
    )
  `);

  const settings = {};

  for (const row of result.rows) {
    settings[row.setting_key] = Number(row.setting_value);
  }

  return {
    maxConcurrentBookings: settings.max_concurrent_bookings ?? 3,

    bufferMinutes: settings.booking_buffer_minutes ?? 60,

    holdMinutes: settings.booking_hold_minutes ?? 30,

    paymentPercentage: settings.payment_percentage ?? 100,
  };
}

export async function updateSetting(key, value) {
  const result = await db.query(
    `
      INSERT INTO app_settings (
        setting_key,
        setting_value,
        updated_at
      )
      VALUES ($1, $2, now())
      ON CONFLICT (setting_key)
      DO UPDATE SET
        setting_value = EXCLUDED.setting_value,
        updated_at = now()
      RETURNING *
    `,
    [key, String(value)],
  );

  return result.rows[0];
}
