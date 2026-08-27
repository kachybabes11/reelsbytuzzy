import express from "express";
import ejs from "ejs";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import csrf from "csurf";

import sessionMiddleware from "./lib/session.js";
import passport from "./lib/passport.js";
import pageRoutes from "./routes/pageRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import packageRoutes from "./routes/packageRoutes.js";
import bookingRoutes from "./routes/bookingRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import paymentRoutes from "./routes/paymentRoutes.js";
import { paystackWebhookController } from "./controllers/paymentController.js";
import {
  appErrorHandler,
  notFoundHandler,
} from "./middleware/errorHandling.js";

dotenv.config();

const app = express();

app.use(
  "/api/payments/webhook",
  express.raw({
    type: "application/json",
  })
);

app.post(
  "/api/payments/webhook",
  (req, res, next) => {
    req.rawBody =
      req.body;

    try {
      req.body =
        JSON.parse(
          req.body.toString(
            "utf8"
          )
        );
    } catch {
      return res
        .status(400)
        .send("Invalid JSON.");
    }

    next();
  },
  paystackWebhookController
);

const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

if (process.env.NODE_ENV === "production") {
  app.set("trust proxy", 1);
}

app.set("view engine", "ejs");
app.set("views", "views");
app.engine("ejs", ejs.renderFile);

app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));
app.use(sessionMiddleware());
app.use(passport.initialize());
app.use(passport.session());

const csrfProtection = csrf();
app.use(csrfProtection);

app.use((req, res, next) => {
  res.locals.googleEnabled = googleEnabled;
  res.locals.currentUser = req.user || null;
  res.locals.flashMessages = req.session?.messages || [];

  if (req.session?.messages) {
    req.session.messages = [];
  }

  res.locals.csrfToken = req.csrfToken();
  next();
});

app.use("/", pageRoutes);
app.use("/auth", authRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/packages", packageRoutes);
app.use("/api/bookings", bookingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/health", (req, res) => {
  res.json({
    success: true,
    message: "Reels By Tuzzy API is healthy.",
  });
});

app.use(notFoundHandler);
app.use(appErrorHandler);

export default app;
