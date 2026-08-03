import express from "express";
import ejs from "ejs";
import dotenv from "dotenv";
import axios from "axios";
import crypto from "crypto";
import bodyParser from "body-parser";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import bcrypt from "bcrypt";
import session from "express-session";
import csrf from "csurf";
import { body, validationResult } from "express-validator";
import db from "./config/db.js";
import authLimiter from "./middleware/rateLimiting.js";
import bookingRules from "./config/bookingRules.js";
import resend from "./services/resend.js";
import {
  depositPercentage,
  maxConcurrentBookingsPerSlot,
  remainingBalancePercentage,
} from "./config/bookingSettings.js";
import { appErrorHandler, notFoundHandler } from "./middleware/errorHandling.js";
import {
  getUserByEmail,
  getUserById,
  createUser,
  findOrCreateGoogleUser,
  createPasswordResetToken,
  getActivePasswordResetTokenByHash,
  markPasswordResetTokenUsed,
  updateUserPasswordById,
} from "./services/userService.js";
import {
  getPackageBySlug,
  getPackages,
} from "./services/packageService.js";
import {
  getMaxHourlyBookingHours,
} from "./services/appSettingsService.js";
import hourlyPackagesCatalog from "./config/hourlyPackages.js";


dotenv.config();

const app = express();
const saltRounds = 15;
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const dbEnabled = Boolean(
  process.env.DATABASE_URL ||
    (process.env.PG_USER && process.env.PG_HOST && process.env.PG_DATABASE && process.env.PG_PASSWORD)
);
const sessionSecret = process.env.SESSION_SECRET;
const paystackSecretKey = process.env.PAYSTACK_SECRET_KEY || "";
const paystackPublicKey = process.env.PAYSTACK_PUBLIC_KEY || "";
const appBaseUrl = process.env.APP_BASE_URL || "http://localhost:3000";
const holdMinutes = Number(process.env.BOOKING_HOLD_MINUTES || 30);
const bookingBufferMinutes = Number(process.env.BOOKING_BUFFER_MINUTES || 60);
const adminEmail = process.env.ADMIN_EMAIL || "reelsbytuzzy@gmail.com";
const resendFromEmail = process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
const passwordResetMinutes = Number(process.env.PASSWORD_RESET_TOKEN_MINUTES || 30);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", "views");
app.engine("ejs", ejs.renderFile);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use(passport.initialize());
app.use(passport.session());

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.googleEnabled = googleEnabled;
  res.locals.currentUser = req.user || null;
  res.locals.flashMessages = req.session?.messages || [];
  if (req.session?.messages) {
    req.session.messages = [];
  }
  res.locals.csrfToken = req.csrfToken();
  next();
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  req.session.messages = [{ type: "error", text: "Please log in to access your account." }];
  return res.redirect("/login");
}

function ensureAdmin(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated() && (req.user?.is_admin || req.user?.role === "admin")) {
    return next();
  }
  req.session.messages = [{ type: "error", text: "Admin access is required." }];
  return res.redirect("/403");
}

function parseDurationMinutes(value) {
  const duration = Number(value);
  if (!Number.isInteger(duration) || duration < 30 || duration > 720) {
    return null;
  }
  return duration;
}

function calculateEndTime(startTime, durationMinutes) {
  const [hourRaw, minuteRaw] = String(startTime || "").split(":");
  const hour = Number(hourRaw);
  const minute = Number(minuteRaw);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  const totalMinutes = hour * 60 + minute + durationMinutes;
  if (totalMinutes > 24 * 60) {
    return null;
  }
  const endHour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const endMinute = String(totalMinutes % 60).padStart(2, "0");
  return `${endHour}:${endMinute}`;
}

function parsePositiveWholeNumber(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return null;
  }
  return parsed;
}

function getBookingConfig(pkg) {
  return pkg?.bookingConfig || null;
}

function getDurationOption(pkg, selectedHours) {
  const bookingConfig = getBookingConfig(pkg);
  const normalizedHours = Number(selectedHours);

  if (!bookingConfig?.durationOptions?.length || !Number.isInteger(normalizedHours)) {
    return null;
  }

  return bookingConfig.durationOptions.find((option) => Number(option.value) === normalizedHours) || null;
}

function calculateBookingSelection(pkg, { selectedHours, selectedVideos }) {
  const bookingConfig = getBookingConfig(pkg);
  if (!bookingConfig) {
    return {
      totalPrice: Number(pkg?.price || 0),
      selectedOptionLabel: null,
      selectedOptionPrice: null,
      selectedHours: null,
      numberOfVideos: null,
      videoPrice: null,
      eventType: "Booking",
    };
  }

  const selectedOption = getDurationOption(pkg, selectedHours);
  if (!selectedOption) {
    return null;
  }

  const selectedOptionPrice = Number(selectedOption.price || 0);
  const durationHours = Number(selectedOption.value);
  const videoPrice = Number(bookingConfig.videoPrice || 0);
  const numberOfVideos = bookingConfig.mode === "hourly-booking" ? parsePositiveWholeNumber(selectedVideos) : null;

  if (bookingConfig.mode === "hourly-booking") {
    if (!numberOfVideos || !Array.isArray(bookingConfig.videoOptions) || !bookingConfig.videoOptions.includes(numberOfVideos)) {
      return null;
    }
  }

  const totalPrice = selectedOptionPrice + (bookingConfig.mode === "hourly-booking" ? numberOfVideos * videoPrice : 0);

  return {
    totalPrice,
    selectedOptionLabel: selectedOption.label,
    selectedOptionPrice,
    selectedHours: durationHours,
    numberOfVideos,
    videoPrice: bookingConfig.mode === "hourly-booking" ? videoPrice : null,
    eventType: bookingConfig.mode === "hourly-booking" ? "" : "Booking",
  };
}

function calculateBookingAmounts(totalPrice) {
  const parsedTotal = Number(totalPrice);
  const depositAmount = Math.round(parsedTotal * (depositPercentage / 100));
  const remainingBalance = parsedTotal - depositAmount;

  return {
    totalPrice: parsedTotal,
    depositAmount,
    remainingBalance,
  };
}

function buildSlotOverlapClause(dateValueReference, startTimeReference, endTimeReference, bufferReference) {
  return `NOT (
    (${dateValueReference}::date + end_time) <= ((${dateValueReference}::date + ${startTimeReference}::time) - make_interval(mins => ${bufferReference}))
    OR (${dateValueReference}::date + start_time) >= (${dateValueReference}::date + ${endTimeReference}::time)
  )`;
}

async function countConcurrentSlotUsage({ bookingDate, startTime, endTime, excludeHoldToken = null, client = db }) {
  await clearExpiredHolds();

  const bookingsResult = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM bookings
     WHERE status = 'confirmed'
       AND booking_date = $1
       AND ${buildSlotOverlapClause("$1", "$2", "$3", "$4")}`,
    [bookingDate, startTime, endTime, bookingBufferMinutes]
  );

  const holdsResult = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM booking_holds
     WHERE status = 'active'
       AND expires_at > now()
       AND booking_date = $1
       AND ($5::text IS NULL OR hold_token <> $5)
       AND ${buildSlotOverlapClause("$1", "$2", "$3", "$4")}`,
    [bookingDate, startTime, endTime, bookingBufferMinutes, excludeHoldToken]
  );

  return {
    confirmedCount: bookingsResult.rows[0]?.count || 0,
    holdCount: holdsResult.rows[0]?.count || 0,
  };
}

async function clearExpiredHolds() {
  await db.query(
    `UPDATE booking_holds
     SET status = 'expired', updated_at = now()
     WHERE status = 'active' AND expires_at <= now()`
  );
}

async function isSlotAvailable({ bookingDate, startTime, endTime, excludeHoldToken = null }) {
  const counts = await countConcurrentSlotUsage({ bookingDate, startTime, endTime, excludeHoldToken });
  return counts.confirmedCount + counts.holdCount < maxConcurrentBookingsPerSlot;
}

function generateReference(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatCurrency(amount) {
  const parsedAmount = Number(amount || 0);
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    maximumFractionDigits: 0,
  }).format(parsedAmount);
}

async function sendEmailSafe({ to, subject, html, text }) {
  if (!process.env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY is missing" };
  }

  try {
    const { error } = await resend.emails.send({
      from: resendFromEmail,
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

function buildBookingEmailHtml({ title, intro, booking }) {
  const optionLine = booking.selected_option_label
    ? `<li><strong>Selected Option:</strong> ${escapeHtml(booking.selected_option_label)}</li>`
    : "";
  const videosLine = booking.number_of_videos
    ? `<li><strong>Number of Videos:</strong> ${escapeHtml(booking.number_of_videos)}</li>`
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
        <li><strong>Event Type:</strong> ${escapeHtml(booking.event_type || "Booking")}</li>
        <li><strong>Event Address:</strong> ${escapeHtml(booking.event_address)}</li>
        <li><strong>Customer:</strong> ${escapeHtml(booking.customer_name)}</li>
        <li><strong>Phone:</strong> ${escapeHtml(booking.customer_phone)}</li>
        <li><strong>Email:</strong> ${escapeHtml(booking.customer_email)}</li>
        <li><strong>Total:</strong> ${escapeHtml(formatCurrency(booking.package_price))}</li>
        <li><strong>Deposit Paid:</strong> ${escapeHtml(formatCurrency(booking.deposit_amount))}</li>
        <li><strong>Remaining Balance:</strong> ${escapeHtml(formatCurrency(booking.remaining_balance))}</li>
      </ul>
      <p style="margin:0">Thank you for choosing Reels By Tuzzy.</p>
    </div>
  `;
}

function buildBookingEmailText({ title, intro, booking }) {
  const optionLine = booking.selected_option_label
    ? `Selected Option: ${booking.selected_option_label}\n`
    : "";
  const videosLine = booking.number_of_videos
    ? `Number of Videos: ${booking.number_of_videos}\n`
    : "";

  return `${title}\n\n${intro}\n\nBooking Reference: ${booking.booking_reference}\nPackage: ${booking.package_name}\nBooking Date: ${booking.booking_date}\nTime: ${booking.start_time} - ${booking.end_time}\n${optionLine}${videosLine}Event Type: ${booking.event_type || "Booking"}\nEvent Address: ${booking.event_address}\nCustomer: ${booking.customer_name}\nPhone: ${booking.customer_phone}\nEmail: ${booking.customer_email}\nTotal: ${formatCurrency(booking.package_price)}\nDeposit Paid: ${formatCurrency(booking.deposit_amount)}\nRemaining Balance: ${formatCurrency(booking.remaining_balance)}\n`;
}

async function sendBookingConfirmationEmails(booking) {
  const customerSubject = `Booking Confirmed: ${booking.booking_reference}`;
  const customerIntro = "Your booking deposit was received and your booking is now confirmed.";
  const customerHtml = buildBookingEmailHtml({
    title: "Booking Confirmation",
    intro: customerIntro,
    booking,
  });
  const customerText = buildBookingEmailText({
    title: "Booking Confirmation",
    intro: customerIntro,
    booking,
  });

  await sendEmailSafe({
    to: booking.customer_email,
    subject: customerSubject,
    html: customerHtml,
    text: customerText,
  });

  const adminSubject = `New Booking Confirmed: ${booking.booking_reference}`;
  const adminIntro = "A customer booking has been confirmed and requires admin visibility.";
  const adminHtml = buildBookingEmailHtml({
    title: "New Confirmed Booking",
    intro: adminIntro,
    booking,
  });
  const adminText = buildBookingEmailText({
    title: "New Confirmed Booking",
    intro: adminIntro,
    booking,
  });

  await sendEmailSafe({
    to: adminEmail,
    subject: adminSubject,
    html: adminHtml,
    text: adminText,
  });
}

async function initializePaystackPayment(payload) {
  const response = await axios.post(
    "https://api.paystack.co/transaction/initialize",
    payload,
    {
      headers: {
        Authorization: `Bearer ${paystackSecretKey}`,
        "Content-Type": "application/json",
      },
      timeout: 10000,
    }
  );
  return response.data;
}

async function verifyPaystackPayment(reference) {
  const response = await axios.get(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: {
      Authorization: `Bearer ${paystackSecretKey}`,
    },
    timeout: 10000,
  });
  return response.data;
}


passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await getUserByEmail(email);
      if (!user || !user.password) {
        return done(null, false);
      }
      const valid = await bcrypt.compare(password, user.password);
      return done(null, valid ? user : false);
    } catch (error) {
      return done(error);
    }
  })
);

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google",
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.email || profile.emails?.[0]?.value
          if (!email) {
            return done(new Error("Google account did not return an email."))
          }
          const user = await findOrCreateGoogleUser(email, profile.id)
          return done(null, user)
        } catch (error) {
          return done(error)
        }
      }
    )
  )
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getUserById(id);
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});


app.get("/", async (req, res, next) => {
  try {
    const packages = await getPackages();
    const essentialPackages = packages.slice(0, 3);
    return res.render("home", { essentialPackages });
  } catch (error) {
    return next(error);
  }
});

app.get("/test-email", async (req, res) => {
  try {
    const { data, error } = await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "kachigirl54@gmail.com",
      subject: "Resend Test",
      html: `
        <h2>Hello user</h2>
        <p>Your session has been booked.</p>
      `,
    });

    if (error) {
      return res.status(400).json(error);
    }

    res.json(data);
  } catch (err) {
    console.error(err);
    res.status(500).send("Something went wrong.");
  }
});

app.get("/hourly-packages", async (req, res, next) => {
  try {
    const pkg = hourlyPackagesCatalog[0] ? { ...hourlyPackagesCatalog[0] } : null;
    return res.render("hourly-packages", {
      pkg,
      bookingRules,
      depositPercentage,
      remainingBalancePercentage,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/user", ensureAuthenticated, async (req, res, next) => {
  try {
    let bookings = [];
    const tableCheck = await db.query("SELECT to_regclass('public.bookings') AS table_name");
    if (tableCheck.rows[0]?.table_name) {
      const bookingResult = await db.query(
        `SELECT id, package_name, booking_date, status, created_at
         FROM bookings
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.id]
      );
      bookings = bookingResult.rows;
    }

    return res.render("user", { bookings });
  } catch (error) {
   // Keep account page available even when bookings storage is not ready yet.
    if (error?.code === "42P01" || error?.code === "42703") {
      return res.render("user", { bookings: [] });
    }
    return next(error);
  }
});

app.get("/packages", async (req, res, next) => {
  try {
    const packages = await getPackages();
    return res.render("packages", { packages });
  } catch (error) {
    return next(error);
  }
});

app.get("/packages/:slug", async (req, res, next) => {
  try {
    const pkg = await getPackageBySlug(req.params.slug);
    if (!pkg) {
      return next();
    }
    return res.render("package", {
      pkg,
      depositPercentage,
      remainingBalancePercentage,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/package", async (req, res, next) => {
  try {
    const packages = await getPackages();
    const pkg = packages[0];
    return res.render("package", {
      pkg,
      depositPercentage,
      remainingBalancePercentage,
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/contact", (req, res) => {
  res.render("contact");
});

app.get("/privacy-policy", (req, res) => {
  res.render("privacy-policy");
});

app.get("/403", (req, res) => {
  res.status(403).render("403");
});

app.get("/bookings", async (req, res, next) => {
  try {
    const packages = await getPackages();
    const selectedPackage = await getPackageBySlug(req.query.package);
    const maxHourlyBookingHours = await getMaxHourlyBookingHours();

    return res.render("bookings", {
      packages,
      selectedPackage,
      holdMinutes,
      bookingBufferMinutes,
      bookingRules,
      depositPercentage,
      remainingBalancePercentage,
      maxHourlyBookingHours,
      paystackEnabled: Boolean(paystackSecretKey && paystackPublicKey),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/bookings/check-availability", async (req, res, next) => {
  try {
    const { packageSlug, bookingDate, startTime, durationMinutes, selectedHours, selectedVideos } = req.body;
    const selectedPackage = await getPackageBySlug(packageSlug);
    const bookingConfig = getBookingConfig(selectedPackage);
    const bookingSelection = bookingConfig
      ? calculateBookingSelection(selectedPackage, { selectedHours, selectedVideos })
      : null;
    const parsedDuration = bookingConfig
      ? bookingSelection
        ? Number(bookingSelection.selectedHours) * 60
        : null
      : parseDurationMinutes(selectedPackage?.durationMinutes || durationMinutes);

    if (!bookingDate || !startTime || !parsedDuration) {
      return res.status(400).json({
        available: false,
        message: "Please provide date, start time, and a valid booking duration.",
      });
    }

    const endTime = calculateEndTime(startTime, parsedDuration);
    if (!endTime) {
      return res.status(400).json({
        available: false,
        message: "Duration extends past midnight. Please select another time slot.",
      });
    }

    const available = await isSlotAvailable({ bookingDate, startTime, endTime });
    if (!available) {
      const counts = await countConcurrentSlotUsage({ bookingDate, startTime, endTime });
      return res.status(409).json({
        available: false,
        message: `This time slot is unavailable. ${counts.confirmedCount + counts.holdCount} of ${maxConcurrentBookingsPerSlot} booking spaces are already in use for this period, including the buffer window. Please choose another date or time.`,
      });
    }

    const counts = await countConcurrentSlotUsage({ bookingDate, startTime, endTime });

    return res.json({
      available: true,
      endTime,
      message: `Great news! This time slot is available. ${Math.max(maxConcurrentBookingsPerSlot - (counts.confirmedCount + counts.holdCount), 0)} booking space(s) remain for this period.`,
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/bookings/start-payment", async (req, res, next) => {
  try {
    if (!paystackSecretKey || !paystackPublicKey) {
      req.session.messages = [{
        type: "error",
        text: "Payment is not configured yet. Add PAYSTACK_SECRET_KEY and PAYSTACK_PUBLIC_KEY.",
      }];
      return res.redirect("/bookings");
    }

    const {
      packageSlug,
      bookingDate,
      startTime,
      durationMinutes,
      selectedHours,
      selectedVideos,
      eventType,
      fullName,
      phone,
      email,
      eventAddress,
      notes,
    } = req.body;

    const selectedPackage = await getPackageBySlug(packageSlug);
    const maxHourlyBookingHours = await getMaxHourlyBookingHours();
    const bookingConfig = getBookingConfig(selectedPackage);
    const bookingSelection = bookingConfig
      ? calculateBookingSelection(selectedPackage, { selectedHours, selectedVideos })
      : null;
    const parsedHours = bookingSelection?.selectedHours || null;
    const parsedDuration = bookingConfig
      ? bookingSelection
        ? parseDurationMinutes(Number(bookingSelection.selectedHours) * 60)
        : null
      : parseDurationMinutes(selectedPackage?.durationMinutes || durationMinutes);
    const parsedVideos = bookingSelection?.numberOfVideos || null;

    if (
      !selectedPackage ||
      !bookingDate ||
      !startTime ||
      !parsedDuration ||
      !fullName ||
      !phone ||
      !email ||
      !eventAddress
    ) {
      req.session.messages = [{ type: "error", text: "Please complete all required booking fields." }];
      return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
    }

    if (bookingConfig) {
      if (!bookingSelection || parsedHours > maxHourlyBookingHours) {
        req.session.messages = [{
          type: "error",
          text: `Please select a valid duration tier for ${selectedPackage?.name || "this package"}.`,
        }];
        return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
      }

      if (bookingConfig.mode === "hourly-booking") {
        const normalizedEventType = String(eventType || "").trim();
        const validEventTypes = Array.isArray(bookingConfig.eventTypes) ? bookingConfig.eventTypes : [];
        if (!normalizedEventType || !validEventTypes.includes(normalizedEventType)) {
          req.session.messages = [{
            type: "error",
            text: "Please choose a valid event type for Hourly Booking.",
          }];
          return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
        }
      }
    }

    const endTime = calculateEndTime(startTime, parsedDuration);
    if (!endTime) {
      req.session.messages = [{ type: "error", text: "Selected time range is invalid." }];
      return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
    }

    const stillAvailable = await isSlotAvailable({ bookingDate, startTime, endTime });
    if (!stillAvailable) {
      req.session.messages = [{
        type: "error",
        text: "That slot is no longer available. Please choose another date or time.",
      }];
      return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
    }

    const totalPrice = bookingSelection?.totalPrice || Number(selectedPackage.price);
    const { depositAmount, remainingBalance } = calculateBookingAmounts(totalPrice);
    const selectedOptionLabel = bookingSelection?.selectedOptionLabel || null;
    const selectedOptionPrice = bookingSelection?.selectedOptionPrice || null;
    const eventTypeValue = bookingConfig?.mode === "hourly-booking" ? String(eventType || "").trim() : "Booking";
    const hourlyRate = bookingConfig ? selectedOptionPrice : selectedPackage.hourlyRate;

    const holdToken = generateReference("HOLD");
    const paymentReference = generateReference("PAY");

    await db.query(
      `INSERT INTO booking_holds (
        hold_token, user_id, package_slug, package_name, package_type, package_price,
        hourly_rate, selected_hours, selected_option_label, selected_option_price, number_of_videos, deposit_amount, remaining_balance,
        booking_date, start_time, end_time, duration_minutes, location,
        event_type, event_address, customer_name, customer_phone, customer_email,
        additional_notes, payment_reference, status, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11, $12, $13,
        $14, $15::time, $16::time, $17, $18,
        $19, $20, $21, $22, $23,
        $24, $25, 'active', now() + make_interval(mins => $26)
      )`,
      [
        holdToken,
        req.user?.id || null,
        selectedPackage.slug,
        selectedPackage.name,
        selectedPackage.packageType,
        totalPrice,
        hourlyRate,
        parsedHours,
        selectedOptionLabel,
        selectedOptionPrice,
        parsedVideos,
        depositAmount,
        remainingBalance,
        bookingDate,
        startTime,
        endTime,
        parsedDuration,
        eventAddress,
        eventTypeValue || 'Booking',
        eventAddress,
        fullName,
        phone,
        email,
        notes || null,
        paymentReference,
        holdMinutes,
      ]
    );

    try {
      const initResponse = await initializePaystackPayment({
        email,
        amount: depositAmount * 100,
        reference: paymentReference,
        callback_url: `${appBaseUrl}/bookings/payment/callback`,
        metadata: {
          holdToken,
          packageSlug: selectedPackage.slug,
          bookingDate,
          startTime,
          durationMinutes: parsedDuration,
          selectedHours: parsedHours,
          selectedVideos: parsedVideos,
          packageType: selectedPackage.packageType,
          totalPrice,
          depositAmount,
          remainingBalance,
          fullName,
          eventType: eventTypeValue || 'Booking',
        },
      });

      if (!initResponse?.status || !initResponse?.data?.authorization_url) {
        throw new Error("Paystack did not return an authorization URL.");
      }

      return res.render("checkout", {
        authorizationUrl: initResponse.data.authorization_url,
        expiresAtIso: new Date(Date.now() + holdMinutes * 60 * 1000).toISOString(),
        holdMinutes,
        paymentReference,
        bookingRules,
        depositPercentage,
        remainingBalancePercentage,
        summary: {
          packageName: selectedPackage.name,
          packageType: selectedPackage.packageType,
          totalPrice,
          depositAmount,
          remainingBalance,
          selectedHours: parsedHours,
          selectedOptionLabel,
          selectedOptionPrice,
          hourlyRate,
          numberOfVideos: parsedVideos,
          videoPrice: bookingSelection?.videoPrice || null,
          eventType: eventTypeValue || 'Booking',
        },
      });
    } catch (paymentError) {
      await db.query(
        `UPDATE booking_holds SET status = 'released', updated_at = now() WHERE hold_token = $1`,
        [holdToken]
      );
      throw paymentError;
    }
  } catch (error) {
    return next(error);
  }
});

app.get("/bookings/payment/callback", async (req, res, next) => {
  const paymentReference = req.query.reference;
  if (!paymentReference) {
    req.session.messages = [{ type: "error", text: "Payment callback is missing a reference." }];
    return res.redirect("/bookings");
  }

  try {
    const existingBooking = await db.query(
      `SELECT booking_reference, package_name, booking_date
       FROM bookings
       WHERE payment_reference = $1
       LIMIT 1`,
      [paymentReference]
    );

    if (existingBooking.rowCount) {
      const row = existingBooking.rows[0];
      return res.render("thank-you", {
        success: true,
        bookingReference: row.booking_reference,
        packageName: row.package_name,
        bookingDate: row.booking_date,
        bookingRules,
        depositPercentage,
        remainingBalancePercentage,
        paymentStatus: "Deposit Paid",
        message: "Your booking has already been confirmed.",
      });
    }

    const verifyResponse = await verifyPaystackPayment(paymentReference);
    const verified = Boolean(verifyResponse?.status && verifyResponse?.data?.status === "success");
    if (!verified) {
      return res.render("thank-you", {
        success: false,
        bookingReference: null,
        packageName: null,
        bookingDate: null,
        bookingRules,
        depositPercentage,
        remainingBalancePercentage,
        paymentStatus: null,
        message: "Payment verification failed. If your account was debited, please contact support with your payment reference.",
      });
    }

    const client = await db.connect();
    try {
      await client.query("BEGIN");

      await client.query(
        `UPDATE booking_holds
         SET status = 'expired', updated_at = now()
         WHERE status = 'active' AND expires_at <= now()`
      );

      const holdResult = await client.query(
        `SELECT *
         FROM booking_holds
         WHERE payment_reference = $1
         FOR UPDATE`,
        [paymentReference]
      );

      if (!holdResult.rowCount) {
        await client.query("COMMIT");
        return res.render("thank-you", {
          success: false,
          bookingReference: null,
          packageName: null,
          bookingDate: null,
          bookingRules,
          depositPercentage,
          remainingBalancePercentage,
          paymentStatus: null,
          message: "We could not find a booking reservation for this payment. Please contact support.",
        });
      }

      const hold = holdResult.rows[0];

      if (hold.status !== "active" || new Date(hold.expires_at).getTime() <= Date.now()) {
        await client.query(
          `UPDATE booking_holds SET status = 'expired', updated_at = now() WHERE id = $1`,
          [hold.id]
        );
        await client.query("COMMIT");
        return res.render("thank-you", {
          success: false,
          bookingReference: null,
          packageName: hold.package_name,
          bookingDate: hold.booking_date,
          bookingRules,
          depositPercentage,
          remainingBalancePercentage,
          paymentStatus: null,
          message: "Your payment was received, but the reservation expired before confirmation. Please contact support for manual review or refund.",
        });
      }

      const conflictCheck = await client.query(
        `SELECT COUNT(*)::int AS count
         FROM bookings
         WHERE status = 'confirmed'
           AND booking_date = $1
           AND ${buildSlotOverlapClause("$1", "$2", "$3", "$4")}`,
        [hold.booking_date, hold.start_time, hold.end_time, bookingBufferMinutes]
      );

      if ((conflictCheck.rows[0]?.count || 0) >= maxConcurrentBookingsPerSlot) {
        await client.query(
          `UPDATE booking_holds SET status = 'released', updated_at = now() WHERE id = $1`,
          [hold.id]
        );
        await client.query("COMMIT");
        return res.render("thank-you", {
          success: false,
          bookingReference: null,
          packageName: hold.package_name,
          bookingDate: hold.booking_date,
          bookingRules,
          depositPercentage,
          remainingBalancePercentage,
          paymentStatus: null,
          message: "Another customer completed this slot during payment verification. Please contact support for resolution or refund.",
        });
      }

      const bookingReference = generateReference("RB");
      const bookingInsert = await client.query(
        `INSERT INTO bookings (
          user_id, booking_reference, package_slug, package_name, package_type, package_price,
          hourly_rate, selected_hours, selected_option_label, selected_option_price, number_of_videos, deposit_amount, remaining_balance,
          booking_date, start_time, end_time, duration_minutes, location,
          event_type, event_address, customer_name, customer_phone, customer_email,
          additional_notes, payment_status, status, payment_reference
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10, $11, $12, $13,
          $14, $15, $16, $17, $18,
          $19, $20, $21, $22, $23,
          $24, 'deposit_paid', 'confirmed', $25
        ) RETURNING booking_reference, package_name, booking_date`,
        [
          hold.user_id,
          bookingReference,
          hold.package_slug,
          hold.package_name,
          hold.package_type,
          hold.package_price,
          hold.hourly_rate,
          hold.selected_hours,
          hold.selected_option_label,
          hold.selected_option_price,
          hold.number_of_videos,
          hold.deposit_amount,
          hold.remaining_balance,
          hold.booking_date,
          hold.start_time,
          hold.end_time,
          hold.duration_minutes,
          hold.event_address,
          hold.event_type,
          hold.event_address,
          hold.customer_name,
          hold.customer_phone,
          hold.customer_email,
          hold.additional_notes,
          paymentReference,
        ]
      );

      await client.query(
        `UPDATE booking_holds
         SET status = 'converted', updated_at = now()
         WHERE id = $1`,
        [hold.id]
      );

      await client.query("COMMIT");
      const booking = bookingInsert.rows[0];

      const confirmedBookingForEmail = {
        booking_reference: booking.booking_reference,
        package_name: hold.package_name,
        booking_date: hold.booking_date,
        start_time: hold.start_time,
        end_time: hold.end_time,
        selected_option_label: hold.selected_option_label,
        number_of_videos: hold.number_of_videos,
        event_type: hold.event_type,
        event_address: hold.event_address,
        customer_name: hold.customer_name,
        customer_phone: hold.customer_phone,
        customer_email: hold.customer_email,
        package_price: hold.package_price,
        deposit_amount: hold.deposit_amount,
        remaining_balance: hold.remaining_balance,
      };

      await sendBookingConfirmationEmails(confirmedBookingForEmail);

      return res.render("thank-you", {
        success: true,
        bookingReference: booking.booking_reference,
        packageName: booking.package_name,
        bookingDate: booking.booking_date,
        bookingRules,
        depositPercentage,
        remainingBalancePercentage,
        paymentStatus: "Deposit Paid",
        message: "Your booking is confirmed. A confirmation has been sent to your email.",
      });
    } catch (transactionError) {
      await client.query("ROLLBACK");
      throw transactionError;
    } finally {
      client.release();
    }
  } catch (error) {
    return next(error);
  }
});

app.get("/your-bookings", (req, res) => {
  res.render("your-bookings");
});

app.get("/admin/bookings", ensureAuthenticated, ensureAdmin, async (req, res, next) => {
  try {
    await clearExpiredHolds();

    const statsResult = await db.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'confirmed')::int AS total_confirmed,
         COUNT(*) FILTER (WHERE booking_date = CURRENT_DATE AND status = 'confirmed')::int AS today_confirmed,
         COUNT(*) FILTER (WHERE booking_date >= CURRENT_DATE AND status = 'confirmed')::int AS upcoming_confirmed,
        COALESCE(SUM(deposit_amount) FILTER (WHERE payment_status IN ('paid', 'deposit_paid') AND status = 'confirmed'), 0)::bigint AS paid_revenue,
        COALESCE(SUM(remaining_balance) FILTER (WHERE status = 'confirmed'), 0)::bigint AS outstanding_balance
       FROM bookings`
    );

    const bookingsResult = await db.query(
      `SELECT
         id,
         customer_name,
         customer_phone,
         customer_email,
         package_name,
         package_type,
         package_price,
         hourly_rate,
         selected_hours,
         deposit_amount,
         remaining_balance,
         booking_date,
         start_time,
         end_time,
         duration_minutes,
         location,
         payment_status,
         status,
         payment_reference,
         booking_reference
       FROM bookings
       ORDER BY created_at DESC`
    );

    const holdsResult = await db.query(
      `SELECT
         hold_token,
         package_name,
         package_type,
         booking_date,
         start_time,
         expires_at,
         customer_name
       FROM booking_holds
       WHERE status = 'active' AND expires_at > now()
       ORDER BY expires_at ASC`
    );

    return res.render("admin-bookings", {
      stats: statsResult.rows[0],
      adminRows: bookingsResult.rows,
      activeHolds: holdsResult.rows,
      bookingBufferMinutes,
      bookingRules,
      depositPercentage,
      remainingBalancePercentage,
      maxHourlyBookingHours: await getMaxHourlyBookingHours(),
    });
  } catch (error) {
    return next(error);
  }
});

app.get("/admin/dashboard", ensureAuthenticated, ensureAdmin, (req, res) => {
  return res.redirect("/admin/bookings");
});

app.get("/cart", (req, res) => {
  res.render("cart");
});

app.get("/checkout", (req, res) => {
  res.render("checkout", {
    authorizationUrl: null,
    expiresAtIso: null,
    holdMinutes,
    paymentReference: null,
    bookingRules,
    depositPercentage,
    remainingBalancePercentage,
    summary: null,
  });
});

app.get("/thank-you", (req, res) => {
  res.render("thank-you", {
    success: false,
    bookingReference: null,
    packageName: null,
    bookingDate: null,
    bookingRules,
    depositPercentage,
    remainingBalancePercentage,
    paymentStatus: null,
    message: "No confirmed booking was found for this page. Complete payment to see your confirmation.",
  });
});

app.get("/register", (req,res)=>{
    res.render("register");
});

app.get("/login", (req, res)=>{
    res.render("login")
})

app.get("/forgot-password", (req, res) => {
  res.render("forgot-password", { formData: { email: "" } });
});

app.post(
  "/forgot-password",
  authLimiter,
  body("email").isEmail().withMessage("A valid email is required."),
  async (req, res, next) => {
    const genericSuccessMessage = "If an account exists with that email, a reset link has been sent.";

    try {
      const errors = validationResult(req);
      const formData = { email: req.body.email || "" };

      if (!errors.isEmpty()) {
        const messages = errors.array().map((error) => ({ type: "error", text: error.msg }));
        res.locals.flashMessages = messages;
        return res.status(400).render("forgot-password", { formData, flashMessages: messages });
      }

      const email = String(req.body.email || "").trim().toLowerCase();
      const user = await getUserByEmail(email);

      if (user?.id) {
        await db.query(
          `UPDATE password_reset_tokens
           SET used_at = now()
           WHERE user_id = $1 AND used_at IS NULL`,
          [user.id]
        );

        const rawToken = crypto.randomBytes(32).toString("hex");
        const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
        const expiresAt = new Date(Date.now() + passwordResetMinutes * 60 * 1000);
        const resetUrl = `${appBaseUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;

        await createPasswordResetToken(user.id, tokenHash, expiresAt);

        const html = `
          <div style="font-family:Arial,sans-serif;line-height:1.6;color:#111;max-width:640px">
            <h2 style="margin:0 0 10px">Reset Your Password</h2>
            <p style="margin:0 0 12px">We received a request to reset your password.</p>
            <p style="margin:0 0 14px">
              <a href="${escapeHtml(resetUrl)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#1f1b16;color:#fff;text-decoration:none;font-weight:700;">Reset Password</a>
            </p>
            <p style="margin:0 0 8px">Or use this link:</p>
            <p style="margin:0 0 8px;word-break:break-word"><a href="${escapeHtml(resetUrl)}">${escapeHtml(resetUrl)}</a></p>
            <p style="margin:0">This link expires in ${escapeHtml(passwordResetMinutes)} minutes. If you did not request this, you can ignore this email.</p>
          </div>
        `;

        const text = `Reset your password by visiting this link: ${resetUrl}\n\nThis link expires in ${passwordResetMinutes} minutes. If you did not request this, you can ignore this email.`;

        await sendEmailSafe({
          to: email,
          subject: "Reset your Reels By Tuzzy password",
          html,
          text,
        });
      }

      req.session.messages = [{ type: "success", text: genericSuccessMessage }];
      return res.redirect("/login");
    } catch (error) {
      return next(error);
    }
  }
);

app.get("/reset-password", async (req, res, next) => {
  try {
    const rawToken = String(req.query.token || "").trim();
    if (!rawToken) {
      const messages = [{ type: "error", text: "Reset link is missing or invalid." }];
      res.locals.flashMessages = messages;
      return res.status(400).render("reset-password", {
        token: "",
        tokenValid: false,
        flashMessages: messages,
      });
    }

    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const tokenRecord = await getActivePasswordResetTokenByHash(tokenHash);

    if (!tokenRecord) {
      const messages = [{ type: "error", text: "This reset link is invalid or has expired." }];
      res.locals.flashMessages = messages;
      return res.status(400).render("reset-password", {
        token: "",
        tokenValid: false,
        flashMessages: messages,
      });
    }

    return res.render("reset-password", {
      token: rawToken,
      tokenValid: true,
      flashMessages: [],
    });
  } catch (error) {
    return next(error);
  }
});

app.post(
  "/reset-password",
  authLimiter,
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
  async (req, res, next) => {
    try {
      const rawToken = String(req.body.token || "").trim();
      const password = String(req.body.password || "");
      const confirmPassword =
        req.body["confirm-password"] ||
        req.body.confirmPassword ||
        req.body["confirmPassword"] ||
        req.body.confirmedpassword ||
        "";

      if (!rawToken) {
        const messages = [{ type: "error", text: "Reset token is missing. Please request a new link." }];
        res.locals.flashMessages = messages;
        return res.status(400).render("reset-password", {
          token: "",
          tokenValid: false,
          flashMessages: messages,
        });
      }

      const validationErrors = validationResult(req);
      if (!validationErrors.isEmpty()) {
        const messages = validationErrors.array().map((error) => ({ type: "error", text: error.msg }));
        res.locals.flashMessages = messages;
        return res.status(400).render("reset-password", {
          token: rawToken,
          tokenValid: true,
          flashMessages: messages,
        });
      }

      if (confirmPassword !== password) {
        const messages = [{ type: "error", text: "Passwords do not match." }];
        res.locals.flashMessages = messages;
        return res.status(400).render("reset-password", {
          token: rawToken,
          tokenValid: true,
          flashMessages: messages,
        });
      }

      const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
      const tokenRecord = await getActivePasswordResetTokenByHash(tokenHash);
      if (!tokenRecord) {
        const messages = [{ type: "error", text: "This reset link is invalid or has expired." }];
        res.locals.flashMessages = messages;
        return res.status(400).render("reset-password", {
          token: "",
          tokenValid: false,
          flashMessages: messages,
        });
      }

      const hashedPassword = await bcrypt.hash(password, saltRounds);
      await updateUserPasswordById(tokenRecord.user_id, hashedPassword);
      await markPasswordResetTokenUsed(tokenRecord.id);

      await db.query(
        `UPDATE password_reset_tokens
         SET used_at = now()
         WHERE user_id = $1 AND used_at IS NULL`,
        [tokenRecord.user_id]
      );

      req.session.messages = [{ type: "success", text: "Password updated successfully. You can sign in now." }];
      return res.redirect("/login");
    } catch (error) {
      return next(error);
    }
  }
);


app.post("/login", authLimiter, (req, res, next) => {
  passport.authenticate("local", async (err, user) => {
    if (err) return next(err);
    if (!user) {
      req.session.messages = [{ type: "error", text: "Invalid email or password." }];
      return res.redirect("/login");
    }
    req.login(user, async (error) => {
      if (error) return next(error);
      req.session.messages = [{ type: "success", text: "Logged in successfully." }];
      return res.redirect("/user");
    });
  })(req, res, next);
});

app.post(
  "/register",
  authLimiter,
  body("email").isEmail().withMessage("A valid email is required."),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const formData = { email: req.body.email };
      if (!errors.isEmpty()) {
        const messages = errors.array().map((error) => ({ type: "error", text: error.msg }));
        res.locals.flashMessages = messages;
        return res.status(400).render("register", { formData, flashMessages: messages });
      }
      const confirmPassword =
        req.body["confirm-password"] ||
        req.body.confirmPassword ||
        req.body["confirmPassword"] ||
        req.body.confirmedpassword;
      if (confirmPassword && confirmPassword !== req.body.password) {
        const messages = [{ type: "error", text: "Passwords do not match." }];
        res.locals.flashMessages = messages;
        return res.status(400).render("register", { formData, flashMessages: messages });
      }
      const { email, password } = req.body;
      const existingUser = await getUserByEmail(email);
      if (existingUser) {
        const messages = [{ type: "error", text: "Email already registered." }];
        res.locals.flashMessages = messages;
        return res.status(409).render("register", { formData, flashMessages: messages });
      }
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const newUser = await createUser(email, hashedPassword);
      req.login(newUser, async (error) => {
        if (error) return next(error);
        req.session.messages = [{ type: "success", text: "Account created successfully." }];
        res.redirect("/user");
      });
    } catch (error) {
      next(error);
    }
  }
);


app.get("/about", (req, res) => {
  res.render("contact");
});


app.get("/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    res.redirect("/");
  });
});

if (googleEnabled) {
  app.get("/auth/google", (req, res, next) => {
    if (req.path === "/auth/google/callback" || req.query.code) {
      passport.authenticate("google", async (err, user) => {
        if (err) return next(err);
        if (!user) return res.redirect("/login");
        req.login(user, async (error) => {
          if (error) return next(error);
          req.session.messages = [{ type: "success", text: "Logged in with Google." }];
          res.redirect("/");
        });
      })(req, res, next);
    } else {
      passport.authenticate("google", {
        scope: ["profile", "email"],
      })(req, res, next);
    }
  });

  app.get("/auth/google/callback", (req, res, next) => {
    passport.authenticate("google", async (err, user) => {
      if (err) return next(err);
      if (!user) return res.redirect("/login");
      req.login(user, async (error) => {
        if (error) return next(error);
        req.session.messages = [{ type: "success", text: "Logged in with Google." }];
        res.redirect("/");
      });
    })(req, res, next);
  });
}

app.use(notFoundHandler);
app.use(appErrorHandler);

export default app;