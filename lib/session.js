import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import dotenv from "dotenv";
import db from "../config/db.js";

dotenv.config();

const PgSession = connectPgSimple(session);

export default function sessionMiddleware() {
  const sessionSecret = String(process.env.SESSION_SECRET || "").trim();

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required.");
  }

  return session({
    store: new PgSession({
      pool: db.getPool(),
      createTableIfMissing: true,
    }),

    secret: sessionSecret,

    resave: false,

    saveUninitialized: false,

    name: "reels.sid",

    cookie: {
      httpOnly: true,

      secure: process.env.NODE_ENV === "production",

      sameSite: "lax",

      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  });
}
