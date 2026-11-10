const p = require('postgres');
const postgres = p.default || p;
require('dotenv').config();

const connectionString = process.env.DATABASE_URL;

let sql = null;
let isConnected = false;

if (connectionString && !connectionString.includes('[YOUR-PASSWORD]')) {
  try {
    sql = postgres(connectionString, {
      ssl: 'require',
      connect_timeout: 10,
      max: 10,
      idle_timeout: 20
    });
  } catch (err) {
    console.error('⚠️ Supabase connection string initialization error:', err.message);
  }
}

/**
 * Initializes database tables if connected.
 */
async function initDatabase() {
  if (!sql) {
    console.warn('⚠️ Supabase: DATABASE_URL not set or contains [YOUR-PASSWORD]. Using local fallback mode.');
    return false;
  }

  try {
    // Test basic connectivity
    await sql`SELECT 1 as connected`;
    isConnected = true;
    console.log('✅ Supabase PostgreSQL connected successfully!');

    // 1. Admin Settings Table
    await sql`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // Seed default admin password '1224' if not present
    await sql`
      INSERT INTO admin_settings (key, value)
      VALUES ('admin_password', '1224')
      ON CONFLICT (key) DO NOTHING;
    `;

    // Seed default birthday song URL if not present
    await sql`
      INSERT INTO admin_settings (key, value)
      VALUES ('birthday_song_url', 'https://cdn.pixabay.com/download/audio/2022/03/15/audio_c8c8a73467.mp3?filename=happy-birthday-15264.mp3')
      ON CONFLICT (key) DO NOTHING;
    `;

    // 2. Contacts Table
    await sql`
      CREATE TABLE IF NOT EXISTS contacts (
        id SERIAL PRIMARY KEY,
        name TEXT,
        phone TEXT UNIQUE NOT NULL,
        birthday_month INT,
        birthday_day INT,
        photo_url TEXT,
        synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 3. Birthday Wishes Table (7-Day valid links & tracking)
    await sql`
      CREATE TABLE IF NOT EXISTS birthday_wishes (
        id SERIAL PRIMARY KEY,
        unique_code VARCHAR(64) UNIQUE NOT NULL,
        contact_name TEXT NOT NULL,
        phone TEXT NOT NULL,
        photo_url TEXT,
        framed_image_url TEXT,
        message TEXT,
        song_url TEXT,
        is_opened BOOLEAN DEFAULT FALSE,
        opened_at TIMESTAMP,
        open_count INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        expires_at TIMESTAMP NOT NULL
      );
    `;

    // Ensure framed_image_url, steps_completed, card_delivered_wa, wa_status, and sms_status exist
    await sql`
      ALTER TABLE birthday_wishes ADD COLUMN IF NOT EXISTS framed_image_url TEXT;
    `;
    await sql`
      ALTER TABLE birthday_wishes ADD COLUMN IF NOT EXISTS steps_completed BOOLEAN DEFAULT FALSE;
    `;
    await sql`
      ALTER TABLE birthday_wishes ADD COLUMN IF NOT EXISTS card_delivered_wa BOOLEAN DEFAULT FALSE;
    `;
    await sql`
      ALTER TABLE birthday_wishes ADD COLUMN IF NOT EXISTS wa_status VARCHAR(20) DEFAULT 'sent';
    `;
    await sql`
      ALTER TABLE birthday_wishes ADD COLUMN IF NOT EXISTS sms_status VARCHAR(20) DEFAULT 'not_sent';
    `;

    // 4. SMS History Table
    await sql`
      CREATE TABLE IF NOT EXISTS sms_history (
        id SERIAL PRIMARY KEY,
        recipient_name TEXT,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        response_message TEXT,
        credits_used INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    // 5. Festive Campaigns Table
    await sql`
      CREATE TABLE IF NOT EXISTS festive_campaigns (
        id SERIAL PRIMARY KEY,
        campaign_id VARCHAR(64) UNIQUE NOT NULL,
        title TEXT NOT NULL,
        caption TEXT NOT NULL,
        image_url TEXT,
        channels TEXT[],
        total_contacts INT DEFAULT 0,
        wa_success_count INT DEFAULT 0,
        wa_failed_count INT DEFAULT 0,
        sms_success_count INT DEFAULT 0,
        sms_failed_count INT DEFAULT 0,
        sms_credits_used INT DEFAULT 0,
        logs JSONB DEFAULT '[]'::jsonb,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `;

    console.log('✅ Supabase database tables verified and ready.');
    return true;
  } catch (err) {
    isConnected = false;
    console.error('❌ Supabase database initialization failed:', err.message);
    return false;
  }
}

module.exports = {
  getSql: () => sql,
  isDbConnected: () => isConnected,
  initDatabase
};

