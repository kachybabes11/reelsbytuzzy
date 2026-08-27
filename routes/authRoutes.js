import express from "express";

import {
  register,
  login,
  logout,
  getCurrentUser,
  forgotPassword,
  showResetPassword,
  resetPassword,
  googleAuth,
  googleCallback,
} from "../controllers/authController.js";

import authLimiter from "../middleware/rateLimiting.js";
import { ensureAuthenticated } from "../middleware/authMiddleware.js";

const router = express.Router();

router.get("/check", ensureAuthenticated, getCurrentUser);
router.get("/me", ensureAuthenticated, getCurrentUser);
router.post("/register", authLimiter, register);
router.post("/login", authLimiter, login);
router.post("/logout", ensureAuthenticated, logout);
router.get("/logout", ensureAuthenticated, logout);

router.post("/forgot-password", authLimiter, forgotPassword);
router.get("/reset-password", showResetPassword);
router.post("/reset-password", authLimiter, resetPassword);

router.get("/google", googleAuth);
router.get("/google/callback", googleCallback);

export default router;
