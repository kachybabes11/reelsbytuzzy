import express from "express";

import {
  createBookingHoldController,
  checkAvailabilityController,
} from "../controllers/bookingController.js";

const router = express.Router();

router.post("/hold", createBookingHoldController);
router.post("/check-availability", checkAvailabilityController);

export default router;
