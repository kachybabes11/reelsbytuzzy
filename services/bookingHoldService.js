// api/services/bookingHoldService.js

import db from "../config/db.js";
import crypto from "crypto";

import { calculatePackagePrice } from "./packageService.js";

import { assertSlotAvailable } from "./availabilityService.js";

import {
  createBookingHold,
  findActiveHoldByToken,
  markHoldConverted,
} from "../models/bookingHoldModel.js";

import { createBookingFromHold } from "../models/bookingModel.js";

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      const error = new Error("Invalid booking selection data.");
      error.statusCode = 400;
      throw error;
    }
  }
  return value;
}

function assertDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
    const error = new Error("A valid booking date is required.");
    error.statusCode = 400;
    throw error;
  }
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date < new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) {
    const error = new Error("Booking dates cannot be in the past.");
    error.statusCode = 400;
    throw error;
  }
}

function assertTime(value) {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
    const error = new Error("A valid booking time is required.");
    error.statusCode = 400;
    throw error;
  }
}

function addHour(time) {
  const [hours, minutes] = String(time).split(":").map(Number);
  const total = hours * 60 + minutes + 60;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
}

export async function createHold(data) {
  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /*
     * SERVER-SIDE PACKAGE + PRICE
     */

    const pricing = await calculatePackagePrice({
      packageSlug: data.packageSlug,

      selectedHours: data.selectedHours,

      numberOfVideos: data.numberOfVideos || 0,
    });

    /*
     * Basic booking validation.
     */

    const selectedWeddingEvents = parseJsonField(data.selectedWeddingEvents, []);
    const selectedEventDates = parseJsonField(data.selectedEventDates, {});
    const selectedEventTimes = parseJsonField(data.selectedEventTimes, {});
    if (!Array.isArray(selectedWeddingEvents) ||
        typeof selectedEventDates !== "object" ||
        selectedEventDates === null ||
        typeof selectedEventTimes !== "object" ||
        selectedEventTimes === null) {
      const error = new Error("Invalid booking selection data.");
      error.statusCode = 400;
      throw error;
    }
    const premiumSlots = selectedWeddingEvents.map((slug) => ({
      bookingDate: selectedEventDates[slug],
      startTime: selectedEventTimes[slug],
      endTime: selectedEventTimes[slug],
    }));
    const isPremium = Array.isArray(selectedWeddingEvents) && selectedWeddingEvents.length > 0;
    const bookingDate = data.bookingDate || premiumSlots[0]?.bookingDate;
    const startTime = data.startTime || premiumSlots[0]?.startTime;
    const endTime = data.endTime || (isPremium ? addHour(startTime) : startTime);

    if (!bookingDate || !startTime || !endTime) {
      const error = new Error("Booking date and time are required.");

      error.statusCode = 400;

      throw error;
    }

    /*
     * Availability check.
     */

    assertDate(bookingDate);
    assertTime(startTime);
    assertTime(endTime);
    await assertSlotAvailable(client, { bookingDate, startTime, endTime });
    if (isPremium) {
      for (const slot of premiumSlots) {
        assertDate(slot.bookingDate);
        assertTime(slot.startTime);
        const slotEnd = addHour(slot.startTime);
        await assertSlotAvailable(client, {
          bookingDate: slot.bookingDate,
          startTime: slot.startTime,
          endTime: slotEnd,
        });
      }
    }

    const holdToken = crypto.randomBytes(32).toString("hex");

    /*
     * 30-minute server-side expiry.
     */

    const expiresAt = new Date(Date.now() + 30 * 60 * 1000);

    const hold = await createBookingHold(client, {
      holdToken,

      userId: data.userId,

      packageId: pricing.packageId,

      packageSlug: pricing.packageSlug,

      packageName: pricing.packageName,

      packageType: pricing.packageType,

      packagePrice: pricing.packagePrice,

      selectedHours: pricing.selectedHours,

      selectedOptionLabel: pricing.selectedOptionLabel,

      selectedOptionPrice: pricing.selectedOptionPrice,

      numberOfVideos: pricing.numberOfVideos,

      videoPrice: pricing.videoPrice,

      totalAmount: pricing.totalAmount,

      currency: "NGN",

      bookingDate,

      startTime,

      endTime,

      durationMinutes: Number(data.durationMinutes) || pricing.durationMinutes || (pricing.selectedHours ? pricing.selectedHours * 60 : 60),

      location: data.location,

      eventType: data.eventType,

      eventAddress: data.eventAddress,

      selectedWeddingEvents,

      selectedEventDates,

      selectedEventTimes,

      customerName: data.customerName,

      customerPhone: data.customerPhone,

      customerEmail: data.customerEmail,

      additionalNotes: data.additionalNotes,

      pricingSnapshot: pricing.pricingSnapshot,

      expiresAt,
    });

    await client.query("COMMIT");

    return hold;
  } catch (error) {
    await client.query("ROLLBACK");

    throw error;
  } finally {
    client.release();
  }
}