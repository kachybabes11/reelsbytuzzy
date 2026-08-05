import basePackages from "../config/packages.js";
import hourlyPackagesCatalog from "../config/hourlyPackages.js";
import corporatePackagesCatalog from "../config/corporatePackages.js";

function parseStandardDurationMinutes(duration) {
  const normalized = String(duration || "").trim().toLowerCase();

  if (normalized.includes("full day")) return 480;
  if (normalized.includes("half day")) return 240;

  const hourMatch = normalized.match(/(\d+(?:\.\d+)?)\s*hours?/);
  if (hourMatch) {
    return Math.round(Number(hourMatch[1]) * 60);
  }

  const minuteMatch = normalized.match(/(\d+)\s*mins?/);
  if (minuteMatch) {
    return Number(minuteMatch[1]);
  }

  if (normalized.includes("custom")) return 240;
  return null;
}

function normalizeBasePackage(pkg) {
  return {
    ...pkg,
    packageType: "standard",
    isHourly: false,
    hourlyRate: null,
    maxHours: null,
    durationMinutes: pkg.durationMinutes || parseStandardDurationMinutes(pkg.duration),
  };
}

function normalizeFixedPackage(pkg) {
  return {
    id: pkg.id,
    slug: pkg.slug,
    category: pkg.category,
    name: pkg.name || pkg.category,
    description: pkg.description,
    fullDescription: pkg.fullDescription || pkg.description,
    mediaType: pkg.mediaType || "image",
    mediaSrc: pkg.mediaSrc || "/assets/beauty-1.jpg",
    features: Array.isArray(pkg.features) ? pkg.features.filter(Boolean) : [],
    duration: pkg.duration,
    delivery: pkg.delivery,
    price: Number(pkg.price),
    popular: Boolean(pkg.popular),
    packageType: pkg.packageType || (pkg.isHourly ? "hourly" : "standard"),
    isHourly: Boolean(pkg.isHourly),
    hourlyRate: pkg.hourlyRate == null ? null : Number(pkg.hourlyRate),
    maxHours: pkg.maxHours || null,
    bookingConfig: pkg.bookingConfig || null,
  };
}

export async function getHourlyPackages() {
  return hourlyPackagesCatalog.map(normalizeFixedPackage);
}

export async function getPackages() {
  const hourlyPackages = await getHourlyPackages();
  const corporatePackages = corporatePackagesCatalog.map(normalizeFixedPackage);
  const seenSlugs = new Set();
  return [...basePackages.map(normalizeBasePackage), ...hourlyPackages, ...corporatePackages].filter((pkg) => {
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
    return normalizeFixedPackage(catalogPackage);
  }

  const corporatePackage = corporatePackagesCatalog.find((item) => item.slug === slug);
  if (corporatePackage) {
    return normalizeFixedPackage(corporatePackage);
  }

  return null;
}