import express from "express";
import ejs from "ejs";
import dotenv from "dotenv";
import bodyParser from "body-parser";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import bcrypt from "bcrypt";
import session from "express-session";
import csrf from "csurf";
import { body, validationResult } from "express-validator";
import db from "./config/db.js";
import authLimiter from "./middleware/rateLimiting.js";
import packages from "./config/packages.js"
import { appErrorHandler, notFoundHandler } from "./middleware/errorHandling.js";
import {
  getUserByEmail,
  getUserById,
  createUser,
  findOrCreateGoogleUser,
} from "./services/userService.js";


dotenv.config();

const app = express();
const saltRounds = 15;
const googleEnabled = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const dbEnabled = Boolean(
  process.env.DATABASE_URL ||
    (process.env.PG_USER && process.env.PG_HOST && process.env.PG_DATABASE && process.env.PG_PASSWORD)
);
const sessionSecret = process.env.SESSION_SECRET || "dev-session-secret-change-me";

app.set("view engine", "ejs");
app.set("views", "views");
app.engine("ejs", ejs.renderFile);
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static("public"));

app.use(
  session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

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

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated && req.isAuthenticated()) {
    return next();
  }
  req.session.messages = [{ type: "error", text: "Please log in to access your account." }];
  return res.redirect("/login");
}


passport.use(
  new LocalStrategy({ usernameField: "email" }, async (email, password, done) => {
    try {
      const user = await getUserByEmail(email);
      if (!user || !user.password) {
        return done(null, false);
      }
      const valid = await bcrypt.compare(password, user.password);
      return done(null, valid ? user : false);
    } catch (error) {
      return done(error);
    }
  })
);

if (googleEnabled) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: process.env.GOOGLE_CALLBACK_URL || "http://localhost:3000/auth/google",
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.email || profile.emails?.[0]?.value
          if (!email) {
            return done(new Error("Google account did not return an email."))
          }
          const user = await findOrCreateGoogleUser(email, profile.id)
          return done(null, user)
        } catch (error) {
          return done(error)
        }
      }
    )
  )
}

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getUserById(id);
    done(null, user || false);
  } catch (error) {
    done(error);
  }
});


app.get("/", (req, res)=>{
  const essentialPackages = packages.slice(0, 3)
  res.render("home", { essentialPackages : essentialPackages })
});

app.get("/user", ensureAuthenticated, async (req, res, next) => {
  try {
    let bookings = [];
    const tableCheck = await db.query("SELECT to_regclass('public.bookings') AS table_name");
    if (tableCheck.rows[0]?.table_name) {
      const bookingResult = await db.query(
        `SELECT id, package_name, booking_date, status, created_at
         FROM bookings
         WHERE user_id = $1
         ORDER BY created_at DESC`,
        [req.user.id]
      );
      bookings = bookingResult.rows;
    }

    return res.render("user", { bookings });
  } catch (error) {
    // Keep account page available even when bookings storage is not ready yet.
    if (error?.code === "42P01" || error?.code === "42703") {
      return res.render("user", { bookings: [] });
    }
    return next(error);
  }
});

app.get("/packages", (req, res) => {
  res.render("packages", {packages: packages});
});

app.get("/packages/:slug", (req, res, next) => {
  const pkg = packages.find((item) => item.slug === req.params.slug)
  if (!pkg) {
    return next()
  }
  return res.render("package", { pkg })
});

app.get("/package", (req, res) => {
  const pkg = packages[0]
  res.render("package", { pkg });
});

app.get("/contact", (req, res) => {
  res.render("contact");
});

app.get("/bookings", (req, res) => {
  res.render("bookings");
});

app.get("/your-bookings", (req, res) => {
  res.render("your-bookings");
});

app.get("/cart", (req, res) => {
  res.render("cart");
});

app.get("/checkout", (req, res) => {
  res.render("checkout");
});

app.get("/thank-you", (req, res) => {
  res.render("thank-you");
});

app.get("/register", (req,res)=>{
    res.render("register");
});

app.get("/login", (req, res)=>{
    res.render("login")
})


app.post("/login", authLimiter, (req, res, next) => {
  passport.authenticate("local", async (err, user) => {
    if (err) return next(err);
    if (!user) {
      req.session.messages = [{ type: "error", text: "Invalid email or password." }];
      return res.redirect("/login");
    }
    req.login(user, async (error) => {
      if (error) return next(error);
      req.session.messages = [{ type: "success", text: "Logged in successfully." }];
      return res.redirect("/user");
    });
  })(req, res, next);
});

app.post(
  "/register",
  authLimiter,
  body("email").isEmail().withMessage("A valid email is required."),
  body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters."),
  async (req, res, next) => {
    try {
      const errors = validationResult(req);
      const formData = { email: req.body.email };
      if (!errors.isEmpty()) {
        const messages = errors.array().map((error) => ({ type: "error", text: error.msg }));
        res.locals.flashMessages = messages;
        return res.status(400).render("register", { formData, flashMessages: messages });
      }
      const confirmPassword =
        req.body["confirm-password"] ||
        req.body.confirmPassword ||
        req.body["confirmPassword"] ||
        req.body.confirmedpassword;
      if (confirmPassword && confirmPassword !== req.body.password) {
        const messages = [{ type: "error", text: "Passwords do not match." }];
        res.locals.flashMessages = messages;
        return res.status(400).render("register", { formData, flashMessages: messages });
      }
      const { email, password } = req.body;
      const existingUser = await getUserByEmail(email);
      if (existingUser) {
        const messages = [{ type: "error", text: "Email already registered." }];
        res.locals.flashMessages = messages;
        return res.status(409).render("register", { formData, flashMessages: messages });
      }
      const hashedPassword = await bcrypt.hash(password, saltRounds);
      const newUser = await createUser(email, hashedPassword);
      req.login(newUser, async (error) => {
        if (error) return next(error);
        req.session.messages = [{ type: "success", text: "Account created successfully." }];
        res.redirect("/user");
      });
    } catch (error) {
      next(error);
    }
  }
);


app.get("/about", (req, res) => {
  res.render("contact");
});


app.get("/logout", (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    res.redirect("/");
  });
});

if (googleEnabled) {
  app.get("/auth/google", (req, res, next) => {
    if (req.path === "/auth/google/callback" || req.query.code) {
      passport.authenticate("google", async (err, user) => {
        if (err) return next(err);
        if (!user) return res.redirect("/login");
        req.login(user, async (error) => {
          if (error) return next(error);
          req.session.messages = [{ type: "success", text: "Logged in with Google." }];
          res.redirect("/");
        });
      })(req, res, next);
    } else {
      passport.authenticate("google", {
        scope: ["profile", "email"],
      })(req, res, next);
    }
  });

  app.get("/auth/google/callback", (req, res, next) => {
    passport.authenticate("google", async (err, user) => {
      if (err) return next(err);
      if (!user) return res.redirect("/login");
      req.login(user, async (error) => {
        if (error) return next(error);
        req.session.messages = [{ type: "success", text: "Logged in with Google." }];
        res.redirect("/");
      });
    })(req, res, next);
  });
}

app.use(notFoundHandler);
app.use(appErrorHandler);

export default app;