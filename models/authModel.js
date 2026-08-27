import db from "../config/db.js";

export async function getUserByEmail(email) {
  const result = await db.query(
    "SELECT id, email, password, is_admin, role FROM users WHERE email = $1",
    [email],
  );
  return result.rows[0];
}

export async function getUserById(id) {
  if (!id) return null;
  const result = await db.query(
    "SELECT id, email, password, is_admin, role FROM users WHERE id = $1",
    [id],
  );
  return result.rows[0];
}

export async function createUser(email, hashedPassword, googleId = null) {
  const result = await db.query(
    `INSERT INTO users (email, password, google_id) VALUES ($1, $2, $3) RETURNING id, email, is_admin, role`,
    [email, hashedPassword, googleId],
  );
  return result.rows[0];
}

export async function findOrCreateGoogleUser(email, googleId) {
  const existing = await db.query(
    "SELECT id, email, password, is_admin, role FROM users WHERE email = $1",
    [email],
  );
  if (existing.rowCount) {
    return existing.rows[0];
  }
  const result = await db.query(
    `INSERT INTO users (email, google_id, password) VALUES ($1, $2, $3) RETURNING id, email, is_admin, role`,
    [email, googleId, null],
  );
  return result.rows[0];
}

export async function updateUserPasswordById(userId, hashedPassword) {
  await db.query(
    `UPDATE users
     SET password = $1
     WHERE id = $2`,
    [hashedPassword, userId],
  );
}

export async function createPasswordResetToken(userId, tokenHash, expiresAt) {
  const result = await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)
     RETURNING id, user_id, token_hash, expires_at, used_at`,
    [userId, tokenHash, expiresAt],
  );
  return result.rows[0];
}

export async function getActivePasswordResetTokenByHash(tokenHash) {
  const result = await db.query(
    `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at, u.email
     FROM password_reset_tokens prt
     JOIN users u ON u.id = prt.user_id
     WHERE prt.token_hash = $1
       AND prt.used_at IS NULL
       AND prt.expires_at > now()
     LIMIT 1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

export async function markPasswordResetTokenUsed(tokenId) {
  await db.query(
    `UPDATE password_reset_tokens
     SET used_at = now()
     WHERE id = $1`,
    [tokenId],
  );
}
