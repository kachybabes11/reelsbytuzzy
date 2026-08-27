import crypto from "crypto";
import db from "../config/db.js";

import { findPackageById, findPackageBySlug } from "../models/packageModel.js";

import {
  countOverlappingReservations,
  createBooking,
} from "../models/bookingModel.js";

import {
  createBookingHold as createBookingHoldRecord,
  findActiveHoldByToken,
  expireOldHolds,
  markHoldPaid,
} from "../models/bookingHoldModel.js";

import { getBookingSettings } from "../models/appSettingsModel.js";

function generateBookingReference() {
  return `BK-${Date.now()}-${crypto
    .randomBytes(3)
    .toString("hex")
    .toUpperCase()}`;
}

function generateHoldToken() {
  return crypto.randomBytes(32).toString("hex");
}

function timeToMinutes(time) {
  const [hours, minutes] = time.slice(0, 5).split(":").map(Number);

  return hours * 60 + minutes;
}

function minutesToTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60) % 24;
  const minutes = totalMinutes % 60;

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(
    2,
    "0",
  )}:00`;
}

function calculateEndTime(startTime, durationMinutes) {
  const start = timeToMinutes(startTime);

  return minutesToTime(start + durationMinutes);
}

function validateRequiredFields(data) {
  const required = [
    "packageId",
    "bookingDate",
    "startTime",
    "location",
    "eventType",
    "eventAddress",
    "customerName",
    "customerPhone",
    "customerEmail",
  ];

  const missing = required.filter(
    (field) =>
      data[field] === undefined || data[field] === null || data[field] === "",
  );

  if (missing.length > 0) {
    const error = new Error(`Missing required fields: ${missing.join(", ")}`);

    error.statusCode = 400;

    throw error;
  }
}

function calculatePackagePrice(pkg, data) {
  if (pkg.package_type === "standard") {
    if (pkg.price === null) {
      throw new Error("Standard package has no price");
    }

    return {
      packagePrice: pkg.price,
      selectedOptionPrice: null,
      videoPrice: 0,
      totalAmount: pkg.price,
    };
  }

  const config = pkg.booking_config || {};

  if (pkg.package_type === "hourly" || pkg.package_type === "corporate") {
    const durationOptions = config.durationOptions || [];

    const selectedHours = Number(data.selectedHours);

    const selectedTier = durationOptions.find(
      (option) => Number(option.value) === selectedHours,
    );

    if (!selectedTier) {
      const error = new Error("Invalid coverage tier selected");

      error.statusCode = 400;

      throw error;
    }

    const numberOfVideos = Number(data.numberOfVideos || 0);

    const allowedVideoOptions = config.videoOptions || [];

    if (numberOfVideos > 0 && !allowedVideoOptions.includes(numberOfVideos)) {
      const error = new Error("Invalid number of videos selected");

      error.statusCode = 400;

      throw error;
    }

    const videoPrice = numberOfVideos * Number(config.videoPrice || 0);

    const totalAmount = Number(selectedTier.price) + videoPrice;

    return {
      packagePrice: Number(selectedTier.price),
      selectedHours,
      selectedOptionLabel: selectedTier.label,
      selectedOptionPrice: Number(selectedTier.price),
      numberOfVideos,
      videoPrice,
      totalAmount,
    };
  }

  throw new Error("Unsupported package type");
}

async function checkAvailability({ bookingDate, startTime, durationMinutes }) {
  const settings = await getBookingSettings();

  const requestedStart = timeToMinutes(startTime);

  const requestedEnd = requestedStart + durationMinutes;

  /*
   * The buffer protects the hour before the shoot.
   *
   * Example:
   * Existing shoot: 2PM - 5PM
   * Its protected start is 1PM.
   *
   * For overlap calculations we expand both sides
   * of every reservation by the configured buffer.
   */

  const protectedStart = requestedStart - settings.bufferMinutes;

  const protectedEnd = requestedEnd + settings.bufferMinutes;

  const queryStart = minutesToTime(Math.max(0, protectedStart));

  const queryEnd = minutesToTime(Math.min(24 * 60, protectedEnd));

  const currentCount = await countOverlappingReservations({
    bookingDate,
    startTime: queryStart,
    endTime: queryEnd,
  });

  if (currentCount >= settings.maxConcurrentBookings) {
    const error = new Error(
      `This time is fully booked. Maximum concurrent bookings are ${settings.maxConcurrentBookings}.`,
    );

    error.statusCode = 409;

    throw error;
  }

  return {
    available: true,
    currentCount,
    maxConcurrentBookings: settings.maxConcurrentBookings,
  };
}

export async function createBookingHold(data) {
  validateRequiredFields(data);

  await expireOldHolds();

  const pkg = await findPackageById(data.packageId);

  if (!pkg || !pkg.is_active) {
    const error = new Error("Package not found or inactive");

    error.statusCode = 404;

    throw error;
  }

  const pricing = calculatePackagePrice(pkg, data);

  const durationMinutes =
    pkg.package_type === "standard"
      ? Number(pkg.duration_minutes || data.durationMinutes)
      : Number(data.selectedHours) * 60;

  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) {
    const error = new Error("Invalid booking duration");

    error.statusCode = 400;

    throw error;
  }

  const endTime = calculateEndTime(data.startTime, durationMinutes);

  await checkAvailability({
    bookingDate: data.bookingDate,
    startTime: data.startTime,
    durationMinutes,
  });

  const settings = await getBookingSettings();

  const expiresAt = new Date(Date.now() + settings.holdMinutes * 60 * 1000);

  const holdToken = generateHoldToken();

  const client = await db.connect();

  try {
    await client.query("BEGIN");

    /*
     * This advisory lock is important.
     *
     * Without it, two customers can simultaneously
     * check availability, both see "2 bookings",
     * and both create a third booking.
     *
     * The lock makes the availability check + hold
     * creation behave as one operation.
     */

    await client.query(
      `
        SELECT pg_advisory_xact_lock(
          hashtext($1)
        )
      `,
      [`${data.bookingDate}:${data.startTime}:${endTime}`],
    );

    const count = await countOverlappingReservations({
      bookingDate: data.bookingDate,
      startTime: data.startTime,
      endTime,
    });

    if (count >= settings.maxConcurrentBookings) {
      await client.query("ROLLBACK");

      const error = new Error("This slot is no longer available.");

      error.statusCode = 409;

      throw error;
    }

    const hold = await createBookingHoldRecord(client, {
      holdToken,

      userId: data.userId || null,

      packageId: pkg.id,

      packageSlug: pkg.slug,

      packageName: pkg.name,

      packageType: pkg.package_type,

      packagePrice: pricing.packagePrice,

      selectedHours: pricing.selectedHours || null,

      selectedOptionLabel: pricing.selectedOptionLabel || null,

      selectedOptionPrice: pricing.selectedOptionPrice || null,

      numberOfVideos: pricing.numberOfVideos || 0,

      videoPrice: pricing.videoPrice || 0,

      totalAmount: pricing.totalAmount,

      bookingDate: data.bookingDate,

      startTime: data.startTime,

      endTime,

      durationMinutes,

      location: data.location,

      eventType: data.eventType,

      eventAddress: data.eventAddress,

      selectedWeddingEvents: data.selectedWeddingEvents || [],

      selectedEventDates: data.selectedEventDates || {},

      customerName: data.customerName,

      customerPhone: data.customerPhone,

      customerEmail: data.customerEmail,

      additionalNotes: data.additionalNotes,

      expiresAt,
    });

    await client.query("COMMIT");

    return {
      holdToken: hold.hold_token,

      expiresAt: hold.expires_at,

      package: {
        id: pkg.id,
        name: pkg.name,
        slug: pkg.slug,
      },

      booking: {
        bookingDate: hold.booking_date,

        startTime: hold.start_time,

        endTime: hold.end_time,

        durationMinutes: hold.duration_minutes,
      },

      pricing: {
        packagePrice: pricing.packagePrice,

        selectedOptionPrice: pricing.selectedOptionPrice || 0,

        videoPrice: pricing.videoPrice || 0,

        totalAmount: pricing.totalAmount,
      },

      payment: {
        paymentPercentage: settings.paymentPercentage,

        amountDue: pricing.totalAmount,
      },
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
