import db from "./db.js";

export async function ensureDatabase() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS app_settings (
      setting_key TEXT PRIMARY KEY,
      setting_value TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS hourly_packages (
      id SERIAL PRIMARY KEY,
      slug TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      hourly_rate INTEGER NOT NULL,
      features JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

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
      package_type TEXT NOT NULL DEFAULT 'standard',
      package_price INTEGER NOT NULL,
      hourly_rate INTEGER,
      selected_hours INTEGER,
      deposit_amount INTEGER,
      remaining_balance INTEGER,
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
      package_type TEXT NOT NULL DEFAULT 'standard',
      package_price INTEGER NOT NULL,
      hourly_rate INTEGER,
      selected_hours INTEGER,
      deposit_amount INTEGER,
      remaining_balance INTEGER,
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

  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS package_type TEXT NOT NULL DEFAULT 'standard';`);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS hourly_rate INTEGER;`);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS selected_hours INTEGER;`);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS deposit_amount INTEGER;`);
  await db.query(`ALTER TABLE bookings ADD COLUMN IF NOT EXISTS remaining_balance INTEGER;`);
  await db.query(`ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS package_type TEXT NOT NULL DEFAULT 'standard';`);
  await db.query(`ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS hourly_rate INTEGER;`);
  await db.query(`ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS selected_hours INTEGER;`);
  await db.query(`ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS deposit_amount INTEGER;`);
  await db.query(`ALTER TABLE booking_holds ADD COLUMN IF NOT EXISTS remaining_balance INTEGER;`);

  await db.query(`
    UPDATE bookings
    SET deposit_amount = COALESCE(deposit_amount, ROUND(package_price * 0.7)),
        remaining_balance = COALESCE(remaining_balance, package_price - ROUND(package_price * 0.7))
    WHERE deposit_amount IS NULL OR remaining_balance IS NULL;
  `);

  await db.query(`
    UPDATE booking_holds
    SET deposit_amount = COALESCE(deposit_amount, ROUND(package_price * 0.7)),
        remaining_balance = COALESCE(remaining_balance, package_price - ROUND(package_price * 0.7))
    WHERE deposit_amount IS NULL OR remaining_balance IS NULL;
  `);
}
  