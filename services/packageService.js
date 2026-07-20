import db from "../config/db.js";
import basePackages from "../config/packages.js";
import hourlyPackagesCatalog from "../config/hourlyPackages.js";
import { hourlyPackageCategories } from "../config/bookingSettings.js";
import { getMaxHourlyBookingHours } from "./appSettingsService.js";

const defaultHourlyMedia = {
  Photography: "/assets/beauty-1.jpg",
  Videography: "/assets/beauty-2.jpg",
  "Content Creation": "/assets/beauty-1.jpg",
  "Event Coverage": "/assets/beauty-2.jpg",
  "Personal Branding": "/assets/beauty-1.jpg",
};

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeBasePackage(pkg) {
  return {
    ...pkg,
    packageType: "standard",
    isHourly: false,
    hourlyRate: null,
    maxHours: null,
  };
}

function normalizeHourlyPackage(row, maxHourlyBookingHours) {
  const category = row.category;
  const hourlyRate = Number(row.hourly_rate);
  const features = Array.isArray(row.features)
    ? row.features.filter(Boolean)
    : [];

  return {
    id: `hourly-${row.id}`,
    slug: row.slug,
    category,
    name: `${category} Hourly Package`,
    description: `Flexible ${category.toLowerCase()} coverage billed per hour with deliverables tailored to your brief.`,
    fullDescription: `This hourly ${category.toLowerCase()} package keeps the booking flow simple while giving you flexible coverage. Select the number of hours you need, review the deliverables, and proceed through the same secure booking and deposit process as every other package.`,
    mediaType: "image",
    mediaSrc: defaultHourlyMedia[category] || "/assets/beauty-1.jpg",
    features,
    duration: `1-${maxHourlyBookingHours} hours`,
    delivery: "Custom delivery timeline",
    price: hourlyRate,
    popular: false,
    packageType: "hourly",
    isHourly: true,
    hourlyRate,
    maxHours: maxHourlyBookingHours,
  };
}

function normalizeCatalogHourlyPackage(pkg, maxHourlyBookingHours) {
  return {
    id: pkg.id,
    slug: pkg.slug,
    category: pkg.category,
    name: `${pkg.category} Hourly Package`,
    description: `${pkg.category} coverage billed per hour with tailored deliverables.`,
    fullDescription: `Choose this ${pkg.category.toLowerCase()} hourly package to keep your booking flexible while still using the same premium booking and payment flow.`,
    mediaType: "image",
    mediaSrc: defaultHourlyMedia[pkg.category] || "/assets/beauty-1.jpg",
    features: Array.isArray(pkg.features) ? pkg.features.filter(Boolean) : [],
    duration: `1-${maxHourlyBookingHours} hours`,
    delivery: "Custom delivery timeline",
    price: Number(pkg.price),
    popular: false,
    packageType: "hourly",
    isHourly: true,
    hourlyRate: Number(pkg.price),
    maxHours: maxHourlyBookingHours,
  };
}

export function parseFeatureList(value) {
  return String(value || "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export async function getHourlyPackages() {
  const maxHours = await getMaxHourlyBookingHours();
  const result = await db.query(
    `SELECT id, slug, category, hourly_rate, features, created_at
     FROM hourly_packages
     WHERE is_active = true
     ORDER BY created_at DESC`
  );

  const catalogPackages = hourlyPackagesCatalog.map((pkg) => normalizeCatalogHourlyPackage(pkg, maxHours));
  const databasePackages = result.rows.map((row) => normalizeHourlyPackage(row, maxHours));
  return [...catalogPackages, ...databasePackages];
}

export async function getPackages() {
  const hourlyPackages = await getHourlyPackages();
  const seenSlugs = new Set();
  return [...basePackages.map(normalizeBasePackage), ...hourlyPackages].filter((pkg) => {
    if (seenSlugs.has(pkg.slug)) {
      return false;
    }
    seenSlugs.add(pkg.slug);
    return true;
  });
}

export async function getPackageBySlug(slug) {
  if (!slug) {
    return null;
  }

  const basePackage = basePackages.find((item) => item.slug === slug);
  if (basePackage) {
    return normalizeBasePackage(basePackage);
  }

  const catalogPackage = hourlyPackagesCatalog.find((item) => item.slug === slug);
  if (catalogPackage) {
    return normalizeCatalogHourlyPackage(catalogPackage, await getMaxHourlyBookingHours());
  }

  const maxHours = await getMaxHourlyBookingHours();
  const result = await db.query(
    `SELECT id, slug, category, hourly_rate, features, created_at
     FROM hourly_packages
     WHERE slug = $1 AND is_active = true
     LIMIT 1`,
    [slug]
  );

  return result.rowCount ? normalizeHourlyPackage(result.rows[0], maxHours) : null;
}

export async function createHourlyPackage({ category, hourlyRate, features }) {
  if (!hourlyPackageCategories.includes(category)) {
    throw new Error("Please choose a valid hourly package category.");
  }

  const parsedRate = Number(hourlyRate);
  if (!Number.isInteger(parsedRate) || parsedRate <= 0) {
    throw new Error("Hourly rate must be a positive whole number.");
  }

  const normalizedFeatures = Array.isArray(features)
    ? features.filter(Boolean)
    : [];
  if (!normalizedFeatures.length) {
    throw new Error("Add at least one deliverable or feature for the hourly package.");
  }

  const slug = `${slugify(category)}-hourly-${Date.now()}`;

  const result = await db.query(
    `INSERT INTO hourly_packages (slug, category, hourly_rate, features)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id, slug, category, hourly_rate, features, created_at`,
    [slug, category, parsedRate, JSON.stringify(normalizedFeatures)]
  );

  const maxHours = await getMaxHourlyBookingHours();
  return normalizeHourlyPackage(result.rows[0], maxHours);
}