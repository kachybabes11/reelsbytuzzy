import db from "../config/db.js";

export async function findActiveHoldByToken(holdToken) {
  const result = await db.query(
    `
      SELECT *
      FROM booking_holds
      WHERE hold_token = $1
        AND status = 'active'
        AND expires_at > NOW()
      LIMIT 1
    `,
    [holdToken],
  );

  return result.rows[0] || null;
}

export async function createBookingHold(client, data) {
  const result = await client.query(
    `
      INSERT INTO booking_holds (
        hold_token,
        user_id,
        package_id,
        package_slug,
        package_name,
        package_type,
        package_price,
        selected_hours,
        selected_option_label,
        selected_option_price,
        number_of_videos,
        video_price,
        total_amount,
        currency,
        booking_date,
        start_time,
        end_time,
        duration_minutes,
        location,
        event_type,
        event_address,
        selected_wedding_events,
        selected_event_dates,
        selected_event_times,
        customer_name,
        customer_phone,
        customer_email,
        additional_notes,
        pricing_snapshot,
        expires_at
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,$29,$30
      )
      RETURNING *
    `,
    [
      data.holdToken,
      data.userId || null,
      data.packageId,
      data.packageSlug,
      data.packageName,
      data.packageType,
      data.packagePrice,
      data.selectedHours,
      data.selectedOptionLabel,
      data.selectedOptionPrice,
      data.numberOfVideos,
      data.videoPrice,
      data.totalAmount,
      data.currency,
      data.bookingDate,
      data.startTime,
      data.endTime,
      data.durationMinutes,
      data.location,
      data.eventType,
      data.eventAddress,
      JSON.stringify(data.selectedWeddingEvents || []),
      JSON.stringify(data.selectedEventDates || {}),
      JSON.stringify(data.selectedEventTimes || {}),
      data.customerName,
      data.customerPhone,
      data.customerEmail,
      data.additionalNotes || null,
      JSON.stringify(data.pricingSnapshot),
      data.expiresAt,
    ],
  );

  return result.rows[0];
}

export async function markHoldConverted(client, holdToken) {
  const result = await client.query(
    `
      UPDATE booking_holds
      SET
        status = 'converted',
        updated_at = NOW()
      WHERE hold_token = $1
        AND status = 'active'
      RETURNING *
    `,
    [holdToken],
  );

  return result.rows[0] || null;
}

export async function markHoldExpired(holdToken) {
  const result = await db.query(
    `
      UPDATE booking_holds
      SET
        status = 'expired',
        updated_at = NOW()
      WHERE hold_token = $1
        AND status = 'active'
        AND expires_at <= NOW()
      RETURNING *
    `,
    [holdToken],
  );

  return result.rows[0] || null;
}
