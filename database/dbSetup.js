// api/db/dbSetup.js

import db from "../config/db.js";

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
    CREATE TABLE IF NOT EXISTS packages (
      id SERIAL PRIMARY KEY,

      slug TEXT UNIQUE NOT NULL,
      category TEXT NOT NULL,
      name TEXT NOT NULL,

      description TEXT NOT NULL,
      full_description TEXT,

      media_type TEXT,
      media_src TEXT,
      thumbnail TEXT,

      features JSONB NOT NULL DEFAULT '[]'::jsonb,
      extra_features JSONB NOT NULL DEFAULT '[]'::jsonb,

      duration TEXT,
      delivery TEXT,

      price INTEGER NOT NULL,

      popular BOOLEAN NOT NULL DEFAULT false,

      package_type TEXT NOT NULL DEFAULT 'standard',

      is_hourly BOOLEAN NOT NULL DEFAULT false,

      booking_config JSONB NOT NULL DEFAULT '{}'::jsonb,

      is_active BOOLEAN NOT NULL DEFAULT true,

      duration_minutes INTEGER,

      hourly_rate INTEGER,

      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    ALTER TABLE packages
      ADD COLUMN IF NOT EXISTS duration_minutes INTEGER;
    ALTER TABLE packages
      ADD COLUMN IF NOT EXISTS hourly_rate INTEGER;
    ALTER TABLE packages
      ADD COLUMN IF NOT EXISTS thumbnail TEXT;
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,

      email TEXT UNIQUE NOT NULL,

      password TEXT,

      google_id TEXT,

      is_admin BOOLEAN NOT NULL DEFAULT false,

      role TEXT NOT NULL DEFAULT 'customer',

      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id SERIAL PRIMARY KEY,

      user_id INTEGER NOT NULL
        REFERENCES users(id)
        ON DELETE CASCADE,

      token_hash TEXT UNIQUE NOT NULL,

      expires_at TIMESTAMPTZ NOT NULL,

      used_at TIMESTAMPTZ,

      created_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    CREATE TABLE IF NOT EXISTS booking_rules (
      id SERIAL PRIMARY KEY,

      title TEXT UNIQUE NOT NULL,

      body TEXT NOT NULL,

      created_at TIMESTAMPTZ DEFAULT now(),

      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  /*
   * TEMPORARY 30-MINUTE RESERVATION
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS booking_holds (
      id BIGSERIAL PRIMARY KEY,

      hold_token TEXT UNIQUE NOT NULL,

      user_id INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

      package_id INTEGER
        REFERENCES packages(id)
        ON DELETE SET NULL,

      package_slug TEXT NOT NULL,
      package_name TEXT NOT NULL,

      package_type TEXT NOT NULL DEFAULT 'standard',

      package_price INTEGER NOT NULL,

      selected_hours INTEGER,

      selected_option_label TEXT,

      selected_option_price INTEGER,

      number_of_videos INTEGER,

      video_price INTEGER,

      total_amount INTEGER NOT NULL,

      currency TEXT NOT NULL DEFAULT 'NGN',

      booking_date DATE NOT NULL,

      start_time TIME NOT NULL,

      end_time TIME NOT NULL,

      duration_minutes INTEGER NOT NULL,

      location TEXT NOT NULL,

      event_type TEXT NOT NULL,

      event_address TEXT NOT NULL,

      selected_wedding_events JSONB
        NOT NULL DEFAULT '[]'::jsonb,

      selected_event_dates JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      selected_event_times JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      customer_name TEXT NOT NULL,

      customer_phone TEXT NOT NULL,

      customer_email TEXT NOT NULL,

      additional_notes TEXT,

      pricing_snapshot JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      status TEXT NOT NULL DEFAULT 'active',

      expires_at TIMESTAMPTZ NOT NULL,

      created_at TIMESTAMPTZ DEFAULT now(),

      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  /*
   * CONFIRMED BOOKINGS
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS bookings (
      id BIGSERIAL PRIMARY KEY,

      user_id INTEGER
        REFERENCES users(id)
        ON DELETE SET NULL,

      booking_reference TEXT UNIQUE NOT NULL,

      hold_token TEXT UNIQUE,

      package_id INTEGER
        REFERENCES packages(id)
        ON DELETE SET NULL,

      package_slug TEXT NOT NULL,

      package_name TEXT NOT NULL,

      package_type TEXT NOT NULL DEFAULT 'standard',

      package_price INTEGER NOT NULL,

      selected_hours INTEGER,

      selected_option_label TEXT,

      selected_option_price INTEGER,

      number_of_videos INTEGER,

      video_price INTEGER,

      total_amount INTEGER NOT NULL,

      currency TEXT NOT NULL DEFAULT 'NGN',

      booking_date DATE NOT NULL,

      start_time TIME NOT NULL,

      end_time TIME NOT NULL,

      duration_minutes INTEGER NOT NULL,

      location TEXT NOT NULL,

      event_type TEXT NOT NULL,

      event_address TEXT NOT NULL,

      selected_wedding_events JSONB
        NOT NULL DEFAULT '[]'::jsonb,

      selected_event_dates JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      selected_event_times JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      customer_name TEXT NOT NULL,

      customer_phone TEXT NOT NULL,

      customer_email TEXT NOT NULL,

      additional_notes TEXT,

      pricing_snapshot JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      payment_status TEXT NOT NULL DEFAULT 'unpaid',

      status TEXT NOT NULL DEFAULT 'pending',

      payment_reference TEXT UNIQUE,

      created_at TIMESTAMPTZ DEFAULT now(),

      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  await db.query(`
    ALTER TABLE booking_holds
      ADD COLUMN IF NOT EXISTS selected_wedding_events JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE booking_holds
      ADD COLUMN IF NOT EXISTS selected_event_dates JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE booking_holds
      ADD COLUMN IF NOT EXISTS selected_event_times JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS selected_wedding_events JSONB NOT NULL DEFAULT '[]'::jsonb;
    ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS selected_event_dates JSONB NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE bookings
      ADD COLUMN IF NOT EXISTS selected_event_times JSONB NOT NULL DEFAULT '{}'::jsonb;
  `);

  /*
   * PAYMENTS
   */
  await db.query(`
    CREATE TABLE IF NOT EXISTS payments (
      id BIGSERIAL PRIMARY KEY,

      booking_id BIGINT
        REFERENCES bookings(id)
        ON DELETE SET NULL,

      hold_token TEXT,

      payment_reference TEXT UNIQUE NOT NULL,

      paystack_transaction_id TEXT UNIQUE,

      amount INTEGER NOT NULL,

      currency TEXT NOT NULL DEFAULT 'NGN',

      status TEXT NOT NULL DEFAULT 'pending',

      gateway_response TEXT,

      channel TEXT,

      paid_at TIMESTAMPTZ,

      verified_at TIMESTAMPTZ,

      webhook_received_at TIMESTAMPTZ,

      reconciliation_status TEXT
        NOT NULL DEFAULT 'not_required',

      reconciliation_attempts INTEGER
        NOT NULL DEFAULT 0,

      last_reconciliation_at TIMESTAMPTZ,

      metadata JSONB
        NOT NULL DEFAULT '{}'::jsonb,

      created_at TIMESTAMPTZ DEFAULT now(),

      updated_at TIMESTAMPTZ DEFAULT now()
    );
  `);

  /*
   * INDEXES
   */

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_bookings_slot
    ON bookings (
      booking_date,
      start_time,
      end_time
    )
    WHERE status = 'confirmed';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_holds_slot
    ON booking_holds (
      booking_date,
      start_time,
      end_time,
      expires_at
    )
    WHERE status = 'active';
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_status
    ON payments(status);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_payments_reconciliation
    ON payments(reconciliation_status);
  `);

  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_active
    ON password_reset_tokens(user_id, expires_at)
    WHERE used_at IS NULL;
  `);

  /*
   * Default booking settings.
   */

  await db.query(`
    INSERT INTO app_settings (
      setting_key,
      setting_value
    )
    VALUES
      ('max_concurrent_bookings', '3'),
      ('booking_buffer_minutes', '60'),
      ('booking_hold_minutes', '30')
    ON CONFLICT (setting_key)
    DO NOTHING;
  `);
}
