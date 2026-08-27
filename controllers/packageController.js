import {
  findAllPackages,
  findPackageById,
  findPackageBySlug,
  createPackage,
  updatePackage,
  deletePackage,
} from "../models/packageModel.js";
import { serializePackage } from "../services/packageService.js";

function parseJsonField(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    const error = new Error("Invalid JSON in package configuration.");
    error.statusCode = 400;
    throw error;
  }
}

function normalizePackageInput(body = {}) {
  const normalized = { ...body };
  if (body.features !== undefined) {
    normalized.features = parseJsonField(body.features, []);
  }
  if (body.extraFeatures !== undefined) {
    normalized.extraFeatures = parseJsonField(body.extraFeatures, []);
  }
  if (body.bookingConfig !== undefined) {
    normalized.bookingConfig = parseJsonField(body.bookingConfig, {});
  }
  if (body.price !== undefined) normalized.price = body.price === "" ? null : Number(body.price);
  if (body.durationMinutes !== undefined) {
    normalized.durationMinutes = body.durationMinutes === "" ? null : Number(body.durationMinutes);
  }
  if (body.hourlyRate !== undefined) {
    normalized.hourlyRate = body.hourlyRate === "" ? null : Number(body.hourlyRate);
  }
  if (body.popular !== undefined) normalized.popular = body.popular === true || body.popular === "true";
  if (body.isActive !== undefined) normalized.isActive = body.isActive !== false && body.isActive !== "false";
  if (body.isHourly !== undefined) normalized.isHourly = body.isHourly === true || body.isHourly === "true";
  return normalized;
}

export async function getPackagesController(req, res) {
  try {
    const packages = await findAllPackages({
      activeOnly: req.query.activeOnly !== "false",
      packageType: req.query.type || null,
    });

    res.status(200).json({
      success: true,
      packages: packages.map(serializePackage),
    });
  } catch (error) {
    console.error("Get packages error:", error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get packages",
    });
  }
}

export async function getPackageByIdController(req, res) {
  try {
    const pkg = await findPackageById(req.params.id);

    if (!pkg) {
      return res.status(404).json({
        success: false,
        message: "Package not found",
      });
    }

    res.status(200).json({
      success: true,
      package: serializePackage(pkg),
    });
  } catch (error) {
    console.error("Get package error:", error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get package",
    });
  }
}

export async function getPackageBySlugController(req, res) {
  try {
    const pkg = await findPackageBySlug(req.params.slug);

    if (!pkg) {
      return res.status(404).json({
        success: false,
        message: "Package not found",
      });
    }

    res.status(200).json({
      success: true,
      package: serializePackage(pkg),
    });
  } catch (error) {
    console.error("Get package by slug error:", error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to get package",
    });
  }
}

export async function createPackageController(req, res) {
  try {
    const pkg = await createPackage(normalizePackageInput(req.body));

    res.status(201).json({
      success: true,
      message: "Package created successfully",
      package: pkg,
    });
  } catch (error) {
    console.error("Create package error:", error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to create package",
    });
  }
}

export async function updatePackageController(req, res) {
  try {
    const pkg = await updatePackage(req.params.id, normalizePackageInput(req.body));

    if (!pkg) {
      return res.status(404).json({
        success: false,
        message: "Package not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Package updated successfully",
      package: serializePackage(pkg),
    });
  } catch (error) {
    console.error("Update package error:", error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to update package",
    });
  }
}

export async function deletePackageController(req, res) {
  try {
    const pkg = await deletePackage(req.params.id);

    if (!pkg) {
      return res.status(404).json({
        success: false,
        message: "Package not found",
      });
    }

    res.status(200).json({
      success: true,
      message: "Package deleted successfully",
      package: serializePackage(pkg),
    });
  } catch (error) {
    console.error("Delete package error:", error);

    res.status(error.statusCode || 500).json({
      success: false,
      message: error.message || "Failed to delete package",
    });
  }
}
