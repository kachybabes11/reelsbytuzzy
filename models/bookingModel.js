// api/models/bookingModel.js

import { generateBookingReference } from "../utils/bookingReference.js";

export async function createBookingFromHold(client, hold, paymentReference) {
  const bookingReference = generateBookingReference();

  const result = await client.query(
    `
      INSERT INTO bookings (
        user_id,
        booking_reference,
        hold_token,
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
        payment_status,
        status,
        payment_reference
      )
      VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
        $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
        $21,$22,$23,$24,$25,$26,$27,$28,
        $29,$30,$31,$32,$33
      )
      ON CONFLICT (hold_token)
      DO NOTHING
      RETURNING *
    `,
    [
      hold.user_id,
      bookingReference,
      hold.hold_token,
      hold.package_id,
      hold.package_slug,
      hold.package_name,
      hold.package_type,
      hold.package_price,
      hold.selected_hours,
      hold.selected_option_label,
      hold.selected_option_price,
      hold.number_of_videos,
      hold.video_price,
      hold.total_amount,
      hold.currency,
      hold.booking_date,
      hold.start_time,
      hold.end_time,
      hold.duration_minutes,
      hold.location,
      hold.event_type,
      hold.event_address,
      hold.selected_wedding_events,
      hold.selected_event_dates,
      hold.selected_event_times,
      hold.customer_name,
      hold.customer_phone,
      hold.customer_email,
      hold.additional_notes,
      hold.pricing_snapshot,
      "paid",
      "confirmed",
      paymentReference,
    ],
  );

  return result.rows[0] || null;
}
