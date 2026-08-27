import bcrypt from "bcrypt";
import crypto from "crypto";
import passport from "passport";
import { validationResult } from "express-validator";

import {
  createUser,
  getUserByEmail,
  createPasswordResetToken,
  getActivePasswordResetTokenByHash,
  markPasswordResetTokenUsed,
  updateUserPasswordById,
} from "../models/authModel.js";

import { sendEmailSafe } from "../utils/emailUtils.js";

const SALT_ROUNDS = 15;

export async function register(req, res, next) {
  try {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    const confirmPassword =
      req.body.confirmPassword ||
      req.body["confirm-password"] ||
      req.body.confirmedpassword ||
      "";

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match.",
      });
    }

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required.",
      });
    }

    const existingUser = await getUserByEmail(email);

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: "Email already registered.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await createUser(email, hashedPassword);

    req.login(user, (loginError) => {
      if (loginError) {
        return next(loginError);
      }

      return res.status(201).json({
        success: true,
        message: "Account created successfully.",
        user: {
          id: user.id,
          email: user.email,
        },
      });
    });
  } catch (error) {
    next(error);
  }
}

export function login(req, res, next) {
  passport.authenticate("local", (error, user, info) => {
    if (error) {
      return next(error);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: info?.message || "Invalid email or password.",
      });
    }

    req.login(user, (loginError) => {
      if (loginError) {
        return next(loginError);
      }

      return res.json({
        success: true,
        message: "Logged in successfully.",
        user: {
          id: user.id,
          email: user.email,
        },
      });
    });
  })(req, res, next);
}

export function getCurrentUser(req, res) {
  return res.json({
    success: true,
    user: req.user,
  });
}

export function logout(req, res, next) {
  req.logout((error) => {
    if (error) {
      return next(error);
    }

    if (req.session) {
      req.session.destroy((sessionError) => {
        if (sessionError) {
          return next(sessionError);
        }
      });
    }

    res.clearCookie("connect.sid");

    return res.json({
      success: true,
      message: "Logged out successfully.",
    });
  });
}

export async function forgotPassword(req, res, next) {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        errors: errors.array(),
      });
    }

    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required.",
      });
    }

    const user = await getUserByEmail(email);
    if (!user) {
      return res.json({
        success: true,
        message: "If an account exists for this email, a reset link has been sent.",
      });
    }

    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const expiresAt = new Date(Date.now() + (Number(process.env.PASSWORD_RESET_TOKEN_MINUTES || 30) * 60 * 1000));

    await createPasswordResetToken(user.id, tokenHash, expiresAt);

    const resetUrl = `${process.env.APP_BASE_URL || "http://localhost:3000"}/reset-password?token=${encodeURIComponent(rawToken)}`;
    await sendEmailSafe({
      to: user.email,
      subject: "Reset your password",
      html: `<p>Hello,</p><p>Use the link below to reset your password:</p><p><a href="${resetUrl}">${resetUrl}</a></p>`,
      text: `Use this link to reset your password: ${resetUrl}`,
    });

    return res.json({
      success: true,
      message: "If an account exists for this email, a reset link has been sent.",
    });
  } catch (error) {
    next(error);
  }
}

export function showResetPassword(req, res) {
  const token = String(req.query.token || "").trim();

  return res.json({
    success: true,
    token: token || null,
    message: token ? "Password reset token provided." : "No reset token provided.",
  });
}

export async function resetPassword(req, res, next) {
  try {
    const token = String(req.body.token || req.query.token || "").trim();
    const password = String(req.body.password || "");
    const confirmPassword = String(req.body.confirmPassword || req.body["confirm-password"] || "");

    if (!token) {
      return res.status(400).json({
        success: false,
        message: "Password reset token is missing.",
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long.",
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({
        success: false,
        message: "Passwords do not match.",
      });
    }

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const tokenRecord = await getActivePasswordResetTokenByHash(tokenHash);

    if (!tokenRecord) {
      return res.status(400).json({
        success: false,
        message: "This reset token is invalid or has expired.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);
    await updateUserPasswordById(tokenRecord.user_id, hashedPassword);
    await markPasswordResetTokenUsed(tokenRecord.id);

    return res.json({
      success: true,
      message: "Password reset successfully.",
    });
  } catch (error) {
    next(error);
  }
}

export function googleAuth(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      message: "Google authentication is not configured.",
    });
  }

  return passport.authenticate("google", {
    scope: ["profile", "email"],
  })(req, res, next);
}

export function googleCallback(req, res, next) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(503).json({
      success: false,
      message: "Google authentication is not configured.",
    });
  }

  return passport.authenticate("google", async (error, user) => {
    if (error) {
      return next(error);
    }

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Google authentication failed.",
      });
    }

    req.login(user, (loginError) => {
      if (loginError) {
        return next(loginError);
      }

      return res.json({
        success: true,
        message: "Signed in with Google successfully.",
        user: {
          id: user.id,
          email: user.email,
        },
      });
    });
  })(req, res, next);
}