import { createHold } from "../services/bookingHoldService.js";
import db from "../config/db.js";
import { assertSlotAvailable } from "../services/availabilityService.js";

function addHour(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  const total = hours * 60 + minutes + 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

export async function checkAvailabilityController(req, res, next) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    let selectedEvents;
    let dates;
    let times;
    try {
      selectedEvents = typeof req.body.selectedWeddingEvents === "string"
        ? JSON.parse(req.body.selectedWeddingEvents || "[]")
        : (req.body.selectedWeddingEvents || []);
      dates = typeof req.body.selectedEventDates === "string"
        ? JSON.parse(req.body.selectedEventDates || "{}")
        : (req.body.selectedEventDates || {});
      times = typeof req.body.selectedEventTimes === "string"
        ? JSON.parse(req.body.selectedEventTimes || "{}")
        : (req.body.selectedEventTimes || {});
    } catch {
      const error = new Error("Invalid booking selection data.");
      error.statusCode = 400;
      throw error;
    }
    if (selectedEvents.length) {
      for (const slug of selectedEvents) {
        await assertSlotAvailable(client, {
          bookingDate: dates[slug],
          startTime: times[slug],
          endTime: addHour(times[slug]),
        });
      }
    } else {
      await assertSlotAvailable(client, req.body);
    }
    await client.query("COMMIT");
    return res.json({ success: true, available: true, message: "This time is available." });
  } catch (error) {
    await client.query("ROLLBACK");
    return next(error);
  } finally {
    client.release();
  }
}

export async function createBookingHoldController(req, res, next) {
  try {
    const hold = await createHold({
      ...req.body,

      userId: req.user?.id || null,
    });

    return res.status(201).json({
      success: true,

      hold: {
        holdToken: hold.hold_token,

        packageName: hold.package_name,

        totalAmount: hold.total_amount,

        currency: hold.currency,

        expiresAt: hold.expires_at,
      },
    });
  } catch (error) {
    next(error);
  }
}

export function getCheckoutPage(req, res) {
  return res.render("bookings/checkout", {
    authorizationUrl: null,
    holdMinutes: 30,
    summary: null,
    expiresAtIso: null,
    paymentReference: null,
  });
}
