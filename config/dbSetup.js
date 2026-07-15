import db from "./db.js";

export async function ensureDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      google_id TEXT,
      is_admin BOOLEAN DEFAULT false,
      role TEXT NOT NULL DEFAULT 'customer',
      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);
}
  