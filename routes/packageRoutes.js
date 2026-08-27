import express from "express";

import {
  getPackagesController,
  getPackageByIdController,
  getPackageBySlugController,
  createPackageController,
  updatePackageController,
  deletePackageController,
} from "../controllers/packageController.js";

import { ensureAuthenticated, ensureAdmin } from "../middleware/authMiddleware.js";

const router = express.Router();

/*
 * Public API
 */

router.get("/", getPackagesController);

router.get("/slug/:slug", getPackageBySlugController);

/*
 * Admin API
 */

router.get("/admin/all", ensureAuthenticated, ensureAdmin, getPackagesController);

router.post("/", ensureAuthenticated, ensureAdmin, createPackageController);

router.patch("/:id", ensureAuthenticated, ensureAdmin, updatePackageController);

router.delete("/:id", ensureAuthenticated, ensureAdmin, deletePackageController);

router.get("/:id", getPackageByIdController);

export default router;
