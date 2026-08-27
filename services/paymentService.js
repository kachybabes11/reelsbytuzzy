import db from "../config/db.js";
import crypto from "crypto";

import paystack from "../config/paystack.js";

import { findActiveHoldByToken } from "../models/bookingHoldModel.js";

import { createPayment } from "../models/paymentModel.js";

import { generatePaymentReference } from "../utils/paymentReference.js";


export async function initializePayment({ holdToken }) {
  const hold = await findActiveHoldByToken(holdToken);

  if (!hold) {
    const error = new Error("This booking hold has expired or does not exist.");

    error.statusCode = 409;

    throw error;
  }

  /*
   * IMPORTANT:
   *
   * Amount comes from PostgreSQL.
   * Never from the frontend.
   */

  const amount = Number(hold.total_amount);

  if (!Number.isInteger(amount) || amount <= 0) {
    throw new Error("Invalid booking amount.");
  }

  const reference = generatePaymentReference();

  /*
   * Initialize Paystack using the
   * server-controlled amount.
   */

  const response = await paystack.post("/transaction/initialize", {
    email: hold.customer_email,

    amount: amount * 100,

    currency: "NGN",

    reference,

    callback_url: process.env.PAYSTACK_CALLBACK_URL,

    metadata: {
      holdToken,

      packageSlug: hold.package_slug,

      bookingDate: hold.booking_date,

      startTime: hold.start_time,
    },
  });

  const payment = response.data?.data;

  if (!payment) {
    throw new Error("Paystack payment initialization failed.");
  }

  /*
   * Store payment BEFORE returning
   * authorization URL to frontend.
   */

  await createPayment(db, {
    holdToken,

    paymentReference: reference,

    amount,

    currency: "NGN",

    status: "pending",

    metadata: {
      authorizationUrl: payment.authorization_url,
    },
  });

  return {
    reference,

    authorizationUrl: payment.authorization_url,

    accessCode: payment.access_code,

    amount,

    currency: "NGN",

    expiresAt: hold.expires_at,
  };
}

export async function verifyPaystackTransaction(reference) {
  const response = await paystack.get(
    `/transaction/verify/${encodeURIComponent(reference)}`,
  );

  const data = response.data?.data;

  if (!data) {
    throw new Error("Paystack returned no transaction data.");
  }

  return data;
}

export function verifyPaystackWebhookSignature(rawBody, signature) {
  if (!signature) {
    return false;
  }

  const expectedSignature = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY)
    .update(rawBody)
    .digest("hex");

  const actual = Buffer.from(String(signature));
  const expected = Buffer.from(expectedSignature);
  return actual.length === expected.length && crypto.timingSafeEqual(expected, actual);
}

export async function processSuccessfulPayment(reference) {
  /*
   * Paystack is the external source we
   * independently verify.
   */

  const paystackTransaction = await verifyPaystackTransaction(reference);

  if (paystackTransaction.status !== "success") {
    throw new Error("Payment has not been completed.");
  }

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /*
     * Lock payment row.
     */

    const paymentResult = await client.query(
      `
          SELECT *
          FROM payments
          WHERE payment_reference = $1
          FOR UPDATE
        `,
      [reference],
    );

    const payment = paymentResult.rows[0];

    if (!payment) {
      throw new Error("Payment record not found.");
    }

    /*
     * IDEMPOTENCY
     */

    if (payment.status === "successful" && payment.booking_id) {
      const existing = await client.query(
        "SELECT * FROM bookings WHERE id = $1 LIMIT 1",
        [payment.booking_id],
      );
      await client.query("COMMIT");

      return {
        alreadyProcessed: true,

        bookingId: payment.booking_id,
        booking: existing.rows[0] || null,
      };
    }

    /*
     * AMOUNT
     */

    const expectedAmount = Number(payment.amount) * 100;

    if (Number(paystackTransaction.amount) !== expectedAmount) {
      throw new Error("Payment amount mismatch.");
    }

    /*
     * CURRENCY
     */

    if (paystackTransaction.currency !== payment.currency) {
      throw new Error("Payment currency mismatch.");
    }

    /*
     * REFERENCE
     */

    if (paystackTransaction.reference !== payment.payment_reference) {
      throw new Error("Payment reference mismatch.");
    }

    /*
     * LOCK HOLD.
     */

    const holdResult = await client.query(
      `
          SELECT *
          FROM booking_holds
          WHERE hold_token = $1
          FOR UPDATE
        `,
      [payment.hold_token],
    );

    const hold = holdResult.rows[0];

    if (!hold) {
      throw new Error("Booking hold not found.");
    }

    if (new Date(hold.expires_at) <= new Date() && hold.status !== "converted") {
      throw new Error("This booking hold has expired. Please start checkout again.");
    }

    /*
     * If another request already converted
     * the hold, retrieve the booking.
     */

    if (hold.status === "converted") {
      const existing = await client.query(
        `
            SELECT *
            FROM bookings
            WHERE hold_token = $1
            LIMIT 1
          `,
        [hold.hold_token],
      );

      if (existing.rows[0]) {
        await client.query(
          `
            UPDATE payments
            SET
              status = 'successful',
              booking_id = $1,
              paystack_transaction_id = $2,
              verified_at = NOW(),
              paid_at = COALESCE(
                paid_at,
                NOW()
              ),
              updated_at = NOW()
            WHERE payment_reference = $3
          `,
          [existing.rows[0].id, paystackTransaction.id, reference],
        );

        await client.query("COMMIT");

        return {
          alreadyProcessed: true,

          booking: existing.rows[0],
        };
      }
    }

    /*
     * Metadata validation.
     */

    if (paystackTransaction.metadata?.holdToken !== hold.hold_token) {
      throw new Error("Payment booking metadata mismatch.");
    }

    /*
     * FINAL BOOKING CREATION
     *
     * hold_token is UNIQUE, therefore
     * duplicate webhook calls cannot
     * create duplicate bookings.
     */

    const bookingReference = `BK-${Date.now()}-${crypto
      .randomBytes(4)
      .toString("hex")
      .toUpperCase()}`;

    const bookingResult = await client.query(
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
        reference,
      ],
    );

    let booking = bookingResult.rows[0];

    /*
     * If ON CONFLICT happened,
     * retrieve existing booking.
     */

    if (!booking) {
      const existing = await client.query(
        `
            SELECT *
            FROM bookings
            WHERE hold_token = $1
            LIMIT 1
          `,
        [hold.hold_token],
      );

      booking = existing.rows[0];
    }

    if (!booking) {
      throw new Error("Unable to create booking.");
    }

    /*
     * Convert hold.
     */

    await client.query(
      `
        UPDATE booking_holds
        SET
          status = 'converted',
          updated_at = NOW()
        WHERE hold_token = $1
          AND status = 'active'
      `,
      [hold.hold_token],
    );

    /*
     * Mark payment successful and
     * attach booking.
     */

    await client.query(
      `
        UPDATE payments
        SET
          status = 'successful',

          booking_id = $1,

          paystack_transaction_id = $2,

          gateway_response = $3,

          channel = $4,

          paid_at = COALESCE(
            paid_at,
            NOW()
          ),

          verified_at = NOW(),

          updated_at = NOW()
        WHERE payment_reference = $5
      `,
      [
        booking.id,

        paystackTransaction.id,

        paystackTransaction.gateway_response,

        paystackTransaction.channel,

        reference,
      ],
    );

    await client.query("COMMIT");

    return {
      alreadyProcessed: false,

      booking,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}
