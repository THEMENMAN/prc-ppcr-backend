const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
    console.error('❌ Unexpected database error:', err);
});

async function initDB() {
    const client = await pool.connect();
    try {
        console.log('🔌 Connected to Neon PostgreSQL');

        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id              SERIAL PRIMARY KEY,
                username        VARCHAR(100) UNIQUE NOT NULL,
                password_hash   VARCHAR(255) NOT NULL,
                full_name       VARCHAR(200),
                license_no      VARCHAR(100),
                role            VARCHAR(50) DEFAULT 'volunteer'
                                CHECK (role IN ('admin', 'staff', 'volunteer', 'viewer')),
                is_active       BOOLEAN DEFAULT TRUE,
                last_login      TIMESTAMP,
                created_at      TIMESTAMP DEFAULT NOW(),
                updated_at      TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
            CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);

            CREATE TABLE IF NOT EXISTS ppcr_reports (
                id                  SERIAL PRIMARY KEY,
                client_uuid         UUID UNIQUE NOT NULL,
                serial_no           VARCHAR(50),
                incident_data       JSONB DEFAULT '{}'::jsonb,
                patient_data        JSONB DEFAULT '{}'::jsonb,
                primary_survey      JSONB DEFAULT '{}'::jsonb,
                vital_signs         JSONB DEFAULT '{}'::jsonb,
                care_management     JSONB DEFAULT '{}'::jsonb,
                patient_assessment  JSONB DEFAULT '{}'::jsonb,
                nature_illness      JSONB DEFAULT '{}'::jsonb,
                narrative           JSONB DEFAULT '{}'::jsonb,
                provider_info       JSONB DEFAULT '{}'::jsonb,
                additional_info     TEXT,
                signature_patient   TEXT,
                signature_provider  TEXT,
                signature_receiving TEXT,
                status              VARCHAR(30) DEFAULT 'synced'
                                    CHECK (status IN ('draft', 'submitted', 'synced', 'archived')),
                created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at          TIMESTAMP DEFAULT NOW(),
                updated_at          TIMESTAMP DEFAULT NOW(),
                synced_at           TIMESTAMP DEFAULT NOW()
            );

            CREATE INDEX IF NOT EXISTS idx_reports_client_uuid ON ppcr_reports(client_uuid);
            CREATE INDEX IF NOT EXISTS idx_reports_serial ON ppcr_reports(serial_no);
            CREATE INDEX IF NOT EXISTS idx_reports_created ON ppcr_reports(created_at DESC);
            CREATE INDEX IF NOT EXISTS idx_reports_status ON ppcr_reports(status);

            CREATE OR REPLACE FUNCTION update_updated_at_column()
            RETURNS TRIGGER AS $$
            BEGIN
                NEW.updated_at = NOW();
                RETURN NEW;
            END;
            $$ LANGUAGE plpgsql;

            DROP TRIGGER IF EXISTS update_users_updated_at ON users;
            CREATE TRIGGER update_users_updated_at
                BEFORE UPDATE ON users
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

            DROP TRIGGER IF EXISTS update_reports_updated_at ON ppcr_reports;
            CREATE TRIGGER update_reports_updated_at
                BEFORE UPDATE ON ppcr_reports
                FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
        `);

        console.log('✅ Database schema initialized');
    } catch (err) {
        console.error('❌ Database init error:', err.message);
        throw err;
    } finally {
        client.release();
    }
}

initDB().catch((err) => {
    console.error('Failed to initialize database:', err);
});

module.exports = pool;