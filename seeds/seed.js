import db from "../config/db.js";
import { ensureDatabase } from "../database/dbSetup.js";

import packages from "./packages.js";
import hourlyPackages from "./hourlyPackages.js";
import corporatePackages from "./corporatePackages.js";
import bookingRules from "./bookingRules.js";

function durationMinutes(duration) {
  const match = String(duration || "").match(/(\d+)\s*hours?/i);
  return match ? Number(match[1]) * 60 : null;
}

const seed = async () => {
  try {
    console.log("Starting database seed...");
    await ensureDatabase();

    // Packages
    for (const pkg of [...packages, ...hourlyPackages, ...corporatePackages]) {
      await db.query(
        `
        INSERT INTO packages (
          slug,
          category,
          name,
          description,
          full_description,
          media_type,
          media_src,
          features,
          extra_features,
          duration,
          delivery,
          price,
          popular,
          package_type,
          is_hourly,
          booking_config,
          duration_minutes,
          hourly_rate
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8::jsonb,
          $9::jsonb, $10, $11, $12, $13, $14, $15, $16::jsonb, $17, $18
        )
        ON CONFLICT (slug)
        DO UPDATE SET
          category = EXCLUDED.category,
          name = EXCLUDED.name,
          description = EXCLUDED.description,
          full_description = EXCLUDED.full_description,
          media_type = EXCLUDED.media_type,
          media_src = EXCLUDED.media_src,
          features = EXCLUDED.features,
          extra_features = EXCLUDED.extra_features,
          duration = EXCLUDED.duration,
          delivery = EXCLUDED.delivery,
          price = EXCLUDED.price,
          popular = EXCLUDED.popular,
          package_type = EXCLUDED.package_type,
          is_hourly = EXCLUDED.is_hourly,
          booking_config = EXCLUDED.booking_config,
          duration_minutes = EXCLUDED.duration_minutes,
          hourly_rate = EXCLUDED.hourly_rate
        `,
        [
          pkg.slug,
          pkg.category,
          pkg.name,
          pkg.description,
          pkg.fullDescription,
          pkg.mediaType,
          pkg.mediaSrc,
          JSON.stringify(pkg.features ?? []),
          JSON.stringify(pkg.extraFeatures ?? []),
          pkg.duration,
          pkg.delivery,
          pkg.price,
          pkg.popular ?? false,
          pkg.packageType ?? "standard",
          pkg.isHourly ?? false,
          JSON.stringify(pkg.bookingConfig ?? {}),
          pkg.durationMinutes ?? durationMinutes(pkg.duration),
          pkg.hourlyRate ?? (pkg.isHourly ? pkg.price : null),
        ],
      );
    }

    // Booking rules
    for (const rule of bookingRules) {
      await db.query(
        `
        INSERT INTO booking_rules (title, body)
        VALUES ($1, $2)
        ON CONFLICT (title)
        DO UPDATE SET body = EXCLUDED.body
        `,
        [rule.title, rule.body],
      );
    }

    console.log(" Database seeded successfully.");
  } catch (error) {
    console.error(" Seeding failed:", error);
    process.exitCode = 1;
  } finally {
    await db.end();
  }
};

seed();
