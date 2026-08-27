import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { Strategy as GoogleStrategy } from "passport-google-oauth2";
import bcrypt from "bcrypt";

import {
  getUserByEmail,
  getUserById,
  findOrCreateGoogleUser,
} from "../services/userService.js";

const googleEnabled = Boolean(
  process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET,
);

/*
|--------------------------------------------------------------------------
| Local Strategy
|--------------------------------------------------------------------------
*/

passport.use(
  new LocalStrategy(
    {
      usernameField: "email",
      passwordField: "password",
    },

    async (email, password, done) => {
      try {
        const normalizedEmail = String(email || "")
          .trim()
          .toLowerCase();

        const user = await getUserByEmail(normalizedEmail);

        if (!user || !user.password) {
          return done(null, false, {
            message: "Invalid email or password.",
          });
        }

        const passwordMatches = await bcrypt.compare(password, user.password);

        if (!passwordMatches) {
          return done(null, false, {
            message: "Invalid email or password.",
          });
        }

        return done(null, user);
      } catch (error) {
        return done(error);
      }
    },
  ),
);

/*
|--------------------------------------------------------------------------
| Google Strategy
|--------------------------------------------------------------------------
*/

if (googleEnabled) {
  const googleCallbackUrl = String(
    process.env.GOOGLE_CALLBACK_URL || "",
  ).trim();

  if (!googleCallbackUrl) {
    throw new Error(
      "GOOGLE_CALLBACK_URL is required when Google OAuth is enabled.",
    );
  }

  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: googleCallbackUrl,
        userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo",
      },

      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.email || profile.emails?.[0]?.value;

          if (!email) {
            return done(new Error("Google account did not provide an email."));
          }

          const user = await findOrCreateGoogleUser(email, profile.id);

          return done(null, user);
        } catch (error) {
          return done(error);
        }
      },
    ),
  );
}

/*
|--------------------------------------------------------------------------
| Session Serialization
|--------------------------------------------------------------------------
*/

passport.serializeUser((user, done) => {
  done(null, user.id);
});

/*
|--------------------------------------------------------------------------
| Session Deserialization
|--------------------------------------------------------------------------
*/

passport.deserializeUser(async (id, done) => {
  try {
    const user = await getUserById(id);

    if (!user) {
      return done(null, false);
    }

    return done(null, user);
  } catch (error) {
    return done(error);
  }
});

export default passport;
