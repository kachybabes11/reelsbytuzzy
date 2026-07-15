import db from "../config/db.js"

export async function getUserByEmail(email) {
  const result = await db.query("SELECT id, email, password, is_admin, role FROM users WHERE email = $1", [email])
  return result.rows[0]
}

export async function getUserById(id) {
  if (!id) return null
  const result = await db.query("SELECT id, email, password, is_admin, role FROM users WHERE id = $1", [id])
  return result.rows[0]
}

export async function createUser(email, hashedPassword, googleId = null) {
  const result = await db.query(
    `INSERT INTO users (email, password, google_id) VALUES ($1, $2, $3) RETURNING id, email, is_admin, role`,
    [email, hashedPassword, googleId]
  )
  return result.rows[0]
}

export async function findOrCreateGoogleUser(email, googleId) {
  const existing = await db.query("SELECT id, email, password, is_admin, role FROM users WHERE email = $1", [email])
  if (existing.rowCount) {
    return existing.rows[0]
  }
  const result = await db.query(
    `INSERT INTO users (email, google_id, password) VALUES ($1, $2, $3) RETURNING id, email, is_admin, role`,
    [email, googleId, null]
  )
  return result.rows[0]
}
