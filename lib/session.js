import session from "express-session";
import dotenv from "dotenv";

dotenv.config();

export default function sessionMiddleware() {
  const sessionSecret = String(process.env.SESSION_SECRET || "").trim();

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required.");
  }

  return session({
    secret: sessionSecret,

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,

      sameSite: "lax",

      secure: process.env.NODE_ENV === "production",

      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}
