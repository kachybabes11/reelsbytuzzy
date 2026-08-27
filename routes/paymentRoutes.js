import express from "express";

import {
  initializePaymentController,
  paymentCallbackController,
} from "../controllers/paymentController.js";

const router = express.Router();

router.post("/initialize", initializePaymentController);
router.get("/callback", paymentCallbackController);

export default router;
