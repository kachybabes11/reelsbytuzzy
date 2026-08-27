// api/services/availabilityService.js

import db from "../config/db.js";

async function getSetting(client, key, defaultValue) {
  const result = await client.query(
    `
      SELECT setting_value
      FROM app_settings
      WHERE setting_key = $1
      LIMIT 1
    `,
    [key],
  );

  return result.rows[0] ? Number(result.rows[0].setting_value) : defaultValue;
}

export async function assertSlotAvailable(
  client,
  { bookingDate, startTime, endTime },
) {
  const today = new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(bookingDate || "")) || String(bookingDate) < today) {
    const error = new Error("Booking dates cannot be in the past.");
    error.statusCode = 400;
    throw error;
  }
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(String(startTime || "")) ||
      !/^\d{2}:\d{2}(:\d{2})?$/.test(String(endTime || ""))) {
    const error = new Error("A valid booking time is required.");
    error.statusCode = 400;
    throw error;
  }
  const toMinutes = (value) => {
    const [hours, minutes] = String(value).slice(0, 5).split(":").map(Number);
    return hours * 60 + minutes;
  };
  const startMinutes = toMinutes(startTime);
  const endMinutes = toMinutes(endTime);
  if (startMinutes < 0 || startMinutes >= 1440 || endMinutes <= startMinutes || endMinutes > 1440) {
    const error = new Error("Booking end time must be after the start time.");
    error.statusCode = 400;
    throw error;
  }

  /*
   * Serialize availability checks for
   * this date so simultaneous requests
   * cannot both see the same free slot.
   */

  await client.query(
    `
      SELECT pg_advisory_xact_lock(
        hashtextextended($1, 0)
      )
    `,
    [String(bookingDate)],
  );

  const maxConcurrent = await getSetting(client, "max_concurrent_bookings", 3);

  const bufferMinutes = await getSetting(client, "booking_buffer_minutes", 60);

  /*
   * Count actual confirmed bookings
   * overlapping the requested shoot.
   *
   * Holds also count because otherwise
   * three people could all hold the
   * same slot simultaneously.
   */

  const bookingResult = await client.query(
    `
        SELECT COUNT(*)::INTEGER AS count
        FROM bookings
        WHERE booking_date = $1
          AND status = 'confirmed'
          AND start_time < $3
          AND end_time > $2
      `,
    [bookingDate, startTime, endTime],
  );

  const holdResult = await client.query(
    `
        SELECT COUNT(*)::INTEGER AS count
        FROM booking_holds
        WHERE booking_date = $1
          AND status = 'active'
          AND expires_at > NOW()
          AND start_time < $3
          AND end_time > $2
      `,
    [bookingDate, startTime, endTime],
  );

  const concurrentCount =
    Number(bookingResult.rows[0].count) + Number(holdResult.rows[0].count);

  if (concurrentCount >= maxConcurrent) {
    const error = new Error(
      `This time already has the maximum of ${maxConcurrent} concurrent bookings.`,
    );

    error.statusCode = 409;

    throw error;
  }

  /*
   * BUFFER CHECK
   *
   * PostgreSQL interval arithmetic
   * lets us enforce the one-hour gap.
   *
   * Existing booking must either:
   *
   * existing end + 1 hour <= new start
   *
   * OR
   *
   * new end + 1 hour <= existing start
   */

  const bufferResult = await client.query(
    `
        SELECT EXISTS (
          SELECT 1
          FROM bookings
          WHERE booking_date = $1
            AND status = 'confirmed'
            AND NOT (
              end_time + ($4 || ' minutes')::interval <= $2
              OR
              $3 + ($4 || ' minutes')::interval <= start_time
            )
        ) AS conflict
      `,
    [bookingDate, startTime, endTime, bufferMinutes],
  );

  if (bufferResult.rows[0].conflict) {
    const error = new Error(
      `This time conflicts with the required ${bufferMinutes}-minute setup/transport buffer.`,
    );

    error.statusCode = 409;

    throw error;
  }

  /*
   * Do the same buffer check against
   * active holds.
   */

  const holdBufferResult = await client.query(
    `
        SELECT EXISTS (
          SELECT 1
          FROM booking_holds
          WHERE booking_date = $1
            AND status = 'active'
            AND expires_at > NOW()
            AND NOT (
              end_time + ($4 || ' minutes')::interval <= $2
              OR
              $3 + ($4 || ' minutes')::interval <= start_time
            )
        ) AS conflict
      `,
    [bookingDate, startTime, endTime, bufferMinutes],
  );

  if (holdBufferResult.rows[0].conflict) {
    const error = new Error(
      `This time is temporarily unavailable because another customer is currently holding a conflicting slot.`,
    );

    error.statusCode = 409;

    throw error;
  }

  return true;
}
