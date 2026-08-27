import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import dotenv from "dotenv";

dotenv.config();

const PgSession = connectPgSimple(session);

export default function sessionMiddleware() {
  const sessionSecret = String(process.env.SESSION_SECRET || "").trim();

  if (!sessionSecret) {
    throw new Error("SESSION_SECRET is required.");
  }

  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for production sessions.");
  }

  return session({
    store: new PgSession({
      conString: process.env.DATABASE_URL,
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
