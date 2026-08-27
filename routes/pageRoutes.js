import express from "express";
import db from "../config/db.js";
import { ensureAuthenticated, ensureAdmin } from "../middleware/authMiddleware.js";
import { getCheckoutPage } from "../controllers/bookingController.js";
import {
    getHomePage,
    getPackagesPage,
    getCorporatePackagePage,
    getPackageDetailPage,
    getBookingPage,
    getHourlyPackagePage,
    getPrivacyPolicyPage,
    getContactPage,
    getAdminPage,
    getErrorPage,
} from "../controllers/pageController.js";

const router = express.Router();

router.get("/", getHomePage);
router.get("/admin", ensureAuthenticated, ensureAdmin, getAdminPage);
router.get("/error", getErrorPage);
router.get("/hourly-packages", getHourlyPackagePage);
router.get("/corporate-packages", getCorporatePackagePage);
router.get("/packages/:slug", getPackageDetailPage);
router.get("/bookings", getBookingPage);
router.get("/bookings/checkout", getCheckoutPage);
router.get("/packages/", getPackagesPage);
router.get("/contact", getContactPage);
router.get("/privacy-policy", getPrivacyPolicyPage);

router.get("/login", (req, res) => {
    if (req.isAuthenticated && req.isAuthenticated()) {
        return res.redirect("/user");
    }

    return res.render("auth/login", {
        currentUser: req.user || null,
        csrfToken: req.csrfToken ? req.csrfToken() : "",
    });
});

router.get("/user", ensureAuthenticated, async (req, res, next) => {
    try {
        const result = await db.query(
            `SELECT * FROM bookings WHERE user_id = $1 ORDER BY created_at DESC;`,
            [req.user.id],
        );

        return res.render("auth/user", {
            currentUser: req.user,
            bookings: result.rows,
            csrfToken: req.csrfToken ? req.csrfToken() : "",
        });
    } catch (error) {
        next(error);
    }
});

router.get("/logout", (req, res, next) => {
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
        return res.redirect("/login");
    });
});

export default router;
