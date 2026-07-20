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
import {
  depositPercentage,
  hourlyPackageCategories,
  maxConcurrentBookingsPerSlot,
  remainingBalancePercentage,
} from "./config/bookingSettings.js";
import { appErrorHandler, notFoundHandler } from "./middleware/errorHandling.js";
import {
  getUserByEmail,
  getUserById,
  createUser,
  findOrCreateGoogleUser,
} from "./services/userService.js";
import {
  createHourlyPackage,
  getPackageBySlug,
  getPackages,
  parseFeatureList,
} from "./services/packageService.js";
import {
  getMaxHourlyBookingHours,
  setMaxHourlyBookingHours,
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

app.get("/hourly-packages", async (req, res, next) => {
  try {
    const packages = hourlyPackagesCatalog.map((pkg) => ({
      ...pkg,
      name: `${pkg.category} Hourly Package`,
      description: `${pkg.category} coverage billed per hour with tailored deliverables.`,
      fullDescription: `Select a ${pkg.category.toLowerCase()} hourly package, review the deliverables, then continue through the same booking and payment flow.`,
      mediaSrc: pkg.category === "Videography" || pkg.category === "Event Coverage" ? "/assets/beauty-2.jpg" : "/assets/beauty-1.jpg",
      duration: "1-8 Hours",
      delivery: "Custom delivery timeline",
      packageType: "hourly",
      isHourly: true,
      hourlyRate: pkg.price,
      maxHours: 8,
    }));

    return res.render("hourly-packages", {
      packages,
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
    const { packageSlug, bookingDate, startTime, durationMinutes, selectedHours } = req.body;
    const selectedPackage = await getPackageBySlug(packageSlug);
    const parsedDuration = selectedPackage?.isHourly
      ? parsePositiveWholeNumber(selectedHours)
        ? parsePositiveWholeNumber(selectedHours) * 60
        : null
      : parseDurationMinutes(durationMinutes);

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
      fullName,
      phone,
      email,
      eventType,
      eventAddress,
      notes,
    } = req.body;

    const selectedPackage = await getPackageBySlug(packageSlug);
    const maxHourlyBookingHours = await getMaxHourlyBookingHours();
    const parsedHours = selectedPackage?.isHourly ? parsePositiveWholeNumber(selectedHours) : null;
    const parsedDuration = selectedPackage?.isHourly
      ? parseDurationMinutes(Number(parsedHours) * 60)
      : parseDurationMinutes(durationMinutes);

    if (
      !selectedPackage ||
      !bookingDate ||
      !startTime ||
      !parsedDuration ||
      !fullName ||
      !phone ||
      !email ||
      !eventType ||
      !eventAddress
    ) {
      req.session.messages = [{ type: "error", text: "Please complete all required booking fields." }];
      return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
    }

    if (selectedPackage.isHourly) {
      if (!parsedHours || parsedHours > maxHourlyBookingHours) {
        req.session.messages = [{
          type: "error",
          text: `Please select a valid number of hours between 1 and ${maxHourlyBookingHours}.`,
        }];
        return res.redirect(`/bookings?package=${encodeURIComponent(packageSlug || "")}`);
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

    const totalPrice = selectedPackage.isHourly
      ? selectedPackage.hourlyRate * parsedHours
      : selectedPackage.price;
    const { depositAmount, remainingBalance } = calculateBookingAmounts(totalPrice);

    const holdToken = generateReference("HOLD");
    const paymentReference = generateReference("PAY");

    await db.query(
      `INSERT INTO booking_holds (
        hold_token, user_id, package_slug, package_name, package_type, package_price,
        hourly_rate, selected_hours, deposit_amount, remaining_balance,
        booking_date, start_time, end_time, duration_minutes, location,
        event_type, event_address, customer_name, customer_phone, customer_email,
        additional_notes, payment_reference, status, expires_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12::time, $13::time, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, 'active', now() + make_interval(mins => $23)
      )`,
      [
        holdToken,
        req.user?.id || null,
        selectedPackage.slug,
        selectedPackage.name,
        selectedPackage.packageType,
        totalPrice,
        selectedPackage.isHourly ? selectedPackage.hourlyRate : null,
        selectedPackage.isHourly ? parsedHours : null,
        depositAmount,
        remainingBalance,
        bookingDate,
        startTime,
        endTime,
        parsedDuration,
        eventAddress,
        eventType,
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
          packageType: selectedPackage.packageType,
          totalPrice,
          depositAmount,
          remainingBalance,
          fullName,
          eventType,
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
          hourlyRate: selectedPackage.isHourly ? selectedPackage.hourlyRate : null,
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
          hourly_rate, selected_hours, deposit_amount, remaining_balance,
          booking_date, start_time, end_time, duration_minutes, location,
          event_type, event_address, customer_name, customer_phone, customer_email,
          additional_notes, payment_status, status, payment_reference
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, $10,
          $11, $12, $13, $14, $15,
          $16, $17, $18, $19, $20,
          $21, 'deposit_paid', 'confirmed', $22
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
      hourlyPackageCategories,
      maxHourlyBookingHours: await getMaxHourlyBookingHours(),
    });
  } catch (error) {
    return next(error);
  }
});

app.post("/admin/hourly-packages", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    const { category, hourlyRate, features } = req.body;
    await createHourlyPackage({
      category,
      hourlyRate,
      features: parseFeatureList(features),
    });
    req.session.messages = [{ type: "success", text: "Hourly package created successfully." }];
  } catch (error) {
    req.session.messages = [{ type: "error", text: error.message || "Unable to create hourly package." }];
  }

  return res.redirect("/admin/bookings");
});

app.post("/admin/settings/hourly-booking-hours", ensureAuthenticated, ensureAdmin, async (req, res) => {
  try {
    await setMaxHourlyBookingHours(req.body.maxHourlyBookingHours);
    req.session.messages = [{ type: "success", text: "Maximum hourly booking hours updated." }];
  } catch (error) {
    req.session.messages = [{ type: "error", text: error.message || "Unable to update hourly booking hours." }];
  }

  return res.redirect("/admin/bookings");
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