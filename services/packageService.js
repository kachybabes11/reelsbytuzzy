import { findPackageBySlug } from "../models/packageModel.js";

function parseDurationMinutes(value) {
  const match = String(value || "").match(/(\d+)\s*hours?/i);
  return match ? Number(match[1]) * 60 : null;
}

export function serializePackage(pkg) {
  if (!pkg) return null;
  return {
    ...pkg,
    fullDescription: pkg.full_description ?? pkg.fullDescription,
    mediaType: pkg.media_type ?? pkg.mediaType,
    mediaSrc: pkg.media_src ?? pkg.mediaSrc,
    thumbnail: pkg.thumbnail ?? null,
    extraFeatures: pkg.extra_features ?? pkg.extraFeatures ?? [],
    packageType: pkg.package_type ?? pkg.packageType,
    isHourly: Boolean(pkg.is_hourly ?? pkg.isHourly) || pkg.package_type === "hourly",
    bookingConfig: pkg.booking_config ?? pkg.bookingConfig ?? {},
    durationMinutes: pkg.duration_minutes ?? pkg.durationMinutes ?? parseDurationMinutes(pkg.duration),
    hourlyRate: pkg.hourly_rate ?? pkg.hourlyRate ?? null,
    isActive: pkg.is_active ?? pkg.isActive,
  };
}

function normalizeNumber(value) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < 0) {
    return null;
  }

  return number;
}

export async function calculatePackagePrice({
  packageSlug,
  selectedHours,
  numberOfVideos = 0,
}) {
  const pkg = await findPackageBySlug(packageSlug);

  if (!pkg) {
    const error = new Error("Package not found or inactive.");

    error.statusCode = 404;

    throw error;
  }

  const config = pkg.booking_config || {};

  const videos = normalizeNumber(numberOfVideos);

  if (videos === null) {
    const error = new Error("Invalid number of videos.");

    error.statusCode = 400;

    throw error;
  }

  let packagePrice = Number(pkg.price);

  let selectedOptionPrice = null;

  let selectedOptionLabel = null;

  let hours = null;

  let videoPrice = 0;

  /*
   * HOURLY PACKAGES
   */

  if (
    pkg.package_type === "hourly" ||
    pkg.is_hourly === true ||
    config.mode === "tiered"
  ) {
    hours = normalizeNumber(selectedHours);

    if (!hours) {
      const error = new Error("A valid coverage tier is required.");

      error.statusCode = 400;

      throw error;
    }

    const durationOptions = Array.isArray(config.durationOptions)
      ? config.durationOptions
      : [];

    const selectedOption = durationOptions.find(
      (option) => Number(option.value) === hours,
    );

    if (!selectedOption) {
      const error = new Error("Invalid coverage tier.");

      error.statusCode = 400;

      throw error;
    }

    selectedOptionPrice = Number(selectedOption.price);

    selectedOptionLabel = selectedOption.label;

    packagePrice = selectedOptionPrice;

    /*
     * Validate videos against the
     * package's allowed options.
     */

    const videoOptions = Array.isArray(config.videoOptions)
      ? config.videoOptions.map(Number)
      : [];

    if (config.mode !== "hourly-booking" && videos > 0) {
      const error = new Error("This package does not support video selection.");
      error.statusCode = 400;
      throw error;
    }

    if (config.mode === "hourly-booking" && videos > 0 && !videoOptions.includes(videos)) {
      const error = new Error("Invalid number of videos.");

      error.statusCode = 400;

      throw error;
    }

    videoPrice = config.mode === "hourly-booking" && videos > 0
      ? Number(config.videoPrice || 0)
      : 0;
  } else {

  /*
   * STANDARD PACKAGE
   */
    if (videos > 0) {
      const error = new Error("This package does not support video selection.");

      error.statusCode = 400;

      throw error;
    }
  }

  const totalAmount = packagePrice + videoPrice;

  return {
    package: pkg,

    packageId: pkg.id,

    packageSlug: pkg.slug,

    packageName: pkg.name,

    packageType: pkg.package_type,

    packagePrice,

    selectedHours: hours,

    selectedOptionLabel,

    selectedOptionPrice,

    numberOfVideos: videos,

    videoPrice,

    totalAmount,

    currency: "NGN",

    pricingSnapshot: {
      packageId: pkg.id,
      packageSlug: pkg.slug,
      packageName: pkg.name,
      packageType: pkg.package_type,
      packagePrice,
      selectedHours: hours,
      selectedOptionLabel,
      selectedOptionPrice,
      numberOfVideos: videos,
      videoPrice,
      totalAmount,
      durationMinutes: pkg.duration_minutes || parseDurationMinutes(pkg.duration),
      currency: "NGN",
    },
  };
}
