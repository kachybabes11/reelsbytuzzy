import db from "../config/db.js";
import ensureAuthenticated from "../middleware/ensureMiddleware.js";
import { findAllPackages, findPackageBySlug } from "../models/packageModel.js";
import { serializePackage } from "../services/packageService.js";
import bookingRules from "../seeds/bookingRules.js";

export const getHomePage = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM packages
      ORDER BY id ASC
      LIMIT 3
    `);

    res.render("home", {
      essentialPackages: result.rows.map(serializePackage),
    });
  } catch (error) {
    console.error("Error loading home page:", error);

    res.status(500).render("error", {
      message: "Unable to load the home page.",
    });
  }
};

export const getPackagesPage = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT *
      FROM packages
    `);

    res.render("packages/packages", {
      packages: result.rows.map(serializePackage),
    });
  } catch (error) {
    console.error("Error loading packages page:", error);

    res.status(500).render("error", {
      message: "Unable to load the packages page.",
    });
  }
};

export const getPrivacyPolicyPage = (req, res) => {
    try {
        res.render("privacy-policy");
    } catch (error) {
        console.error("Error loading privacy policy page:", error);
        res.status(500).render("error", {
            message: "Unable to load the privacy policy page.",
        });
    }
};

export const getContactPage = (req, res) => {
    try {
        res.render("contact");
    } catch (error) {
        console.error("Error loading contact page:", error);
        res.status(500).render("error", {
            message: "Unable to load the contact page.",
        });
    }
};

export const getProfilePage = (req, res) => {
  try {
    if(ensureAuthenticated(req, res)) {
      res.render("profile");
    }
    else {
      res.redirect("/login");
    }
  } catch (error) {
    console.error("Error loading profile page:", error);
    res.status(500).render("error", {
      message: "Unable to load the profile page.",
        });
    }
};

export async function getHourlyPackagePage(req, res) {
  try {
    const result = await db.query(
      `
      SELECT *
      FROM packages
      WHERE slug = $1
      LIMIT 1
      `,
      ["hourly-booking"],
    );

    const pkg = result.rows[0] || null;

    res.render("packages/hourly-packages", {
      pkg: serializePackage(pkg),
    });
  } catch (error) {
    console.error("Error loading hourly packages page:", error);
    res.status(500).render("error");
  }
}

export async function getCorporatePackagePage(req, res) {
  try {
    const result = await db.query(
      `
      SELECT *
      FROM packages
      WHERE slug = $1
      LIMIT 1
      `,
      ["corporate-hourly-booking"],
    );

    const pkg = result.rows[0] || null;

    res.render("packages/corporate-packages", {
      pkg: serializePackage(pkg),
    });
  } catch (error) {
    console.error("Error loading corporate packages page:", error);
    res.status(500).render("error");
  }
}

export async function getBookingPage(req, res, next) {
  try {
    const packageSlug = req.query.package || "";
    const packages = (await findAllPackages()).map(serializePackage);
    const selectedPackage =
      packages.find((pkg) => pkg.slug === packageSlug) || null;

    res.render("bookings/bookings", {
      title: "Book a Session",
      packages,
      selectedPackage,
      bookingRules,
      holdMinutes: Number(process.env.BOOKING_HOLD_MINUTES || 30),
      maxHourlyBookingHours: Number(process.env.MAX_HOURLY_BOOKING_HOURS || 12),
      paystackEnabled: Boolean(
        process.env.PAYSTACK_PUBLIC_KEY && process.env.PAYSTACK_SECRET_KEY,
      ),
      csrfToken: req.csrfToken ? req.csrfToken() : "",
      currentUser: req.user || null,
      flashMessages: req.session?.messages || [],
    });
  } catch (error) {
    console.error("Error loading booking page:", error);
    next(error);
  }
}

export async function getPackageDetailPage(req, res, next) {
  try {
    const packageSlug = req.params.slug;
    const pkg = serializePackage(await findPackageBySlug(packageSlug));
    if (!pkg) return res.status(404).render("errors/404");
    res.render("packages/package", { pkg });
  } catch (error) {
    console.error("Error loading package detail page:", error);
    next(error);
  }
};

export async function getAdminPage(req, res) {
  try {
    const [statsResult, holdsResult, bookingsResult] = await Promise.all([
      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'confirmed')::INTEGER AS total_confirmed,
          COUNT(*) FILTER (
            WHERE status = 'confirmed' AND booking_date = CURRENT_DATE
          )::INTEGER AS today_confirmed,
          COUNT(*) FILTER (
            WHERE status = 'confirmed' AND booking_date >= CURRENT_DATE
          )::INTEGER AS upcoming_confirmed,
          COALESCE(SUM(total_amount) FILTER (
            WHERE status = 'confirmed' AND payment_status = 'paid'
          ), 0)::INTEGER AS paid_revenue,
          0::INTEGER AS outstanding_balance
        FROM bookings
      `),
      db.query(`
        SELECT *
        FROM booking_holds
        WHERE status = 'active' AND expires_at > NOW()
        ORDER BY booking_date, start_time
      `),
      db.query(`
        SELECT *
        FROM bookings
        WHERE status = 'confirmed' OR payment_status = 'paid'
        ORDER BY created_at DESC
      `),
    ]);

    return res.render("admin/admin-bookings", {
      stats: statsResult.rows[0] || {},
      activeHolds: holdsResult.rows,
      adminRows: bookingsResult.rows,
      maxHourlyBookingHours: Number(process.env.MAX_HOURLY_BOOKING_HOURS || 12),
      bookingBufferMinutes: Number(process.env.BOOKING_BUFFER_MINUTES || 60),
    });
  } catch (error) {
    console.error("Error loading admin page:", error);
    res.status(500).render("errors/500");
  }
}

export async function getErrorPage(req, res) {
  if( res.statusCode === 500){
    return res.render("errors/500");
  }
  else if (res.statusCode === 404) {
    return res.render("errors/404");
  }
  else if (res.statusCode === 403) {
    return res.render("errors/403");
  }
  else {
    return res.render("errors/error");
  }
}
