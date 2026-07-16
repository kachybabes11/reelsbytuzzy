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

  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      booking_reference TEXT UNIQUE NOT NULL,
      package_slug TEXT NOT NULL,
      package_name TEXT NOT NULL,
      package_price INTEGER NOT NULL,
      booking_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_minutes INTEGER NOT NULL,
      location TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_address TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      additional_notes TEXT,
      payment_status TEXT NOT NULL DEFAULT 'unpaid',
      status TEXT NOT NULL DEFAULT 'pending',
      payment_reference TEXT UNIQUE,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS booking_holds (
      id SERIAL PRIMARY KEY,
      hold_token TEXT UNIQUE NOT NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      package_slug TEXT NOT NULL,
      package_name TEXT NOT NULL,
      package_price INTEGER NOT NULL,
      booking_date DATE NOT NULL,
      start_time TIME NOT NULL,
      end_time TIME NOT NULL,
      duration_minutes INTEGER NOT NULL,
      location TEXT NOT NULL,
      event_type TEXT NOT NULL,
      event_address TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT NOT NULL,
      additional_notes TEXT,
      payment_reference TEXT UNIQUE,
      status TEXT NOT NULL DEFAULT 'active',
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bookings_slot
    ON bookings (booking_date, start_time, end_time)
    WHERE status = 'confirmed';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_booking_holds_slot
    ON booking_holds (booking_date, start_time, end_time, expires_at)
    WHERE status = 'active';
  `);
}
  