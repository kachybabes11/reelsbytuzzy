import crypto from "crypto";
import axios from "axios";
import resend from "../services/resend.js";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatCurrency(amount) {
  const parsedAmount = Number(amount || 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(parsedAmount);
}

export function generateReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function sendEmailSafe({ to, subject, html, text, from }) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY is missing" };
  }

  try {
    const { error } = await resend.emails.send({
      from: from || process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev",
      to,
      subject,
      html,
      text,
    });

    if (error) {
      console.error("Resend delivery error:", error);
      return { sent: false, reason: "provider error" };
    }

    return { sent: true };
  } catch (error) {
    console.error("Email send failed:", error);
    return { sent: false, reason: "exception" };
  }
}

export function buildBookingEmailHtml({
  title,
  intro,
  booking,
  premiumEventSummaryLines = [],
}) {
  const optionLine = booking.selected_option_label
    ? `<li><strong>Selected Option:</strong> ${escapeHtml(booking.selected_option_label)}</li>`
    : "";
  const videosLine = booking.number_of_videos
    ? `<li><strong>Number of Videos:</strong> ${escapeHtml(booking.number_of_videos)}</li>`
    : "";
  const premiumEventsLine = premiumEventSummaryLines.length
    ? `<li><strong>Selected Wedding Events:</strong><ul style="margin:8px 0 0 14px;padding:0">${premiumEventSummaryLines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul></li>`
    : "";

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:640px">
      <h2 style="margin:0 0 10px">${escapeHtml(title)}</h2>
      <p style="margin:0 0 14px">${escapeHtml(intro)}</p>
      <ul style="padding-left:18px;margin:0 0 14px">
        <li><strong>Booking Reference:</strong> ${escapeHtml(booking.booking_reference)}</li>
        <li><strong>Package:</strong> ${escapeHtml(booking.package_name)}</li>
        <li><strong>Booking Date:</strong> ${escapeHtml(booking.booking_date)}</li>
        <li><strong>Time:</strong> ${escapeHtml(booking.start_time)} - ${escapeHtml(booking.end_time)}</li>
        ${optionLine}
        ${videosLine}
        ${premiumEventsLine}
        <li><strong>Event Type:</strong> ${escapeHtml(booking.event_type || "Booking")}</li>
        <li><strong>Event Address:</strong> ${escapeHtml(booking.event_address)}</li>
        <li><strong>Customer:</strong> ${escapeHtml(booking.customer_name)}</li>
        <li><strong>Phone:</strong> ${escapeHtml(booking.customer_phone)}</li>
        <li><strong>Email:</strong> ${escapeHtml(booking.customer_email)}</li>
        <li><strong>Total:</strong> ${escapeHtml(formatCurrency(booking.package_price))}</li>
        <li><strong>Amount Paid:</strong> ${escapeHtml(formatCurrency(booking.deposit_amount))}</li>
      </ul>
      <p style="margin:0">Thank you for choosing Reels By Tuzzy.</p>
    </div>
  `;
}

export function buildBookingEmailText({
  title,
  intro,
  booking,
  premiumEventSummaryLines = [],
}) {
  const optionLine = booking.selected_option_label
    ? `Selected Option: ${booking.selected_option_label}\n`
    : "";
  const videosLine = booking.number_of_videos
    ? `Number of Videos: ${booking.number_of_videos}\n`
    : "";
  const premiumEventsLine = premiumEventSummaryLines.length
    ? `Selected Wedding Events:\n- ${premiumEventSummaryLines.join("\n- ")}\n`
    : "";

  return `${title}\n\n${intro}\n\nBooking Reference: ${booking.booking_reference}\nPackage: ${booking.package_name}\nBooking Date: ${booking.booking_date}\nTime: ${booking.start_time} - ${booking.end_time}\n${optionLine}${videosLine}${premiumEventsLine}Event Type: ${booking.event_type || "Booking"}\nEvent Address: ${booking.event_address}\nCustomer: ${booking.customer_name}\nPhone: ${booking.customer_phone}\nEmail: ${booking.customer_email}\nTotal: ${formatCurrency(booking.package_price)}\nAmount Paid: ${formatCurrency(booking.deposit_amount)}\n`;
}


