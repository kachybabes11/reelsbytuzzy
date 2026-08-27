import {
  initializePayment,
  processSuccessfulPayment,
  verifyPaystackWebhookSignature,
} from "../services/paymentService.js";

export async function initializePaymentController(req, res, next) {
  try {
    const { holdToken } = req.body;
    if (!holdToken) {
      return res.status(400).json({ success: false, message: "Booking hold token is required." });
    }
    const payment = await initializePayment({ holdToken });
    return res.status(200).json({ success: true, payment });
  } catch (error) {
    return next(error);
  }
}

export async function paymentCallbackController(req, res, next) {
  try {
    const reference = String(
      req.query.reference || req.query.trxref || "",
    ).trim();
    if (!reference) {
      return res.status(400).render("thank-you", { success: false, message: "No payment reference was provided." });
    }
    const result = await processSuccessfulPayment(reference);
    const booking = result.booking;
    if (!booking) {
      const error = new Error(
        "Payment was verified, but the booking record could not be loaded.",
      );
      error.statusCode = 500;
      throw error;
    }
    return res.render("thank-you", {
      success: true,
      message: "Your payment was verified and your booking is confirmed.",
      bookingReference: booking?.booking_reference,
      packageName: booking?.package_name,
      paymentStatus: booking?.payment_status,
      bookingDate: booking?.booking_date,
      selectedWeddingEvents: booking?.selected_wedding_events || [],
      selectedEventDates: booking?.selected_event_dates || {},
      selectedEventTimes: booking?.selected_event_times || {},
    });
  } catch (error) {
    return next(error);
  }
}

export async function paystackWebhookController(req, res, next) {
  try {
    const signature = req.headers["x-paystack-signature"];
    if (!req.rawBody) return res.status(400).send("Raw webhook body unavailable.");
    if (!verifyPaystackWebhookSignature(req.rawBody, signature)) {
      return res.status(401).send("Invalid webhook signature.");
    }
    if (req.body.event === "charge.success" && req.body.data?.reference) {
      await processSuccessfulPayment(req.body.data.reference);
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error("Paystack webhook error:", error);
    return res.sendStatus(500);
  }
}
