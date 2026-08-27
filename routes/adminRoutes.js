import express from "express";

import { ensureAdmin, ensureAuthenticated } from "../middleware/authMiddleware.js";
import { getMaxHourlyBookingHours } from "../services/appSettingsService.js";

const router = express.Router();

router.use(ensureAuthenticated, ensureAdmin);

router.get("/settings", async (req, res, next) => {
  try {
    const maxHourlyBookingHours = await getMaxHourlyBookingHours();

    return res.json({
      success: true,
      data: {
        maxHourlyBookingHours,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
