// ============================================================
// SQLite Database Adapter — Portable / Offline Mode
// Translates PostgreSQL-style queries ($1, $2) to SQLite (?)
// ============================================================

const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, 'ppcr.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

console.log('📂 SQLite DB path:', DB_PATH);

// ============================================================
// SCHEMA
// ============================================================
function initDB() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL,
            full_name TEXT,
            license_no TEXT,
            role TEXT DEFAULT 'volunteer'
                CHECK (role IN ('admin', 'staff', 'volunteer', 'viewer')),
            is_active INTEGER DEFAULT 1,
            last_login TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ppcr_reports (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            client_uuid TEXT UNIQUE NOT NULL,
            serial_no TEXT,
            incident_data TEXT DEFAULT '{}',
            patient_data TEXT DEFAULT '{}',
            primary_survey TEXT DEFAULT '{}',
            vital_signs TEXT DEFAULT '{}',
            care_management TEXT DEFAULT '{}',
            patient_assessment TEXT DEFAULT '{}',
            nature_illness TEXT DEFAULT '{}',
            narrative TEXT DEFAULT '{}',
            provider_info TEXT DEFAULT '{}',
            additional_info TEXT,
            signature_patient TEXT,
            signature_provider TEXT,
            signature_receiving TEXT,
            status TEXT DEFAULT 'synced',
            created_by INTEGER,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_reports_uuid ON ppcr_reports(client_uuid);
        CREATE INDEX IF NOT EXISTS idx_reports_created ON ppcr_reports(created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    `);
    console.log('✅ SQLite schema initialized');
}

initDB();

// ============================================================
// QUERY TRANSLATOR ($1, $2 → ?)
// ============================================================
function translateQuery(text) {
    let t = text.replace(/\$(\d+)/g, '?');
    t = t.replace(/\bNOW\(\)/gi, "datetime('now')");
    t = t.replace(/\bILIKE\b/gi, 'LIKE');
    return t;
}

// ============================================================
// QUERY EXECUTOR
// ============================================================
function query(text, params = []) {
    try {
        const sql = translateQuery(text);
        const lower = sql.trim().toLowerCase();
        const hasReturning = /\breturning\b/i.test(sql);
        const isRead = lower.startsWith('select') || lower.startsWith('with');

        if (isRead || hasReturning) {
            const stmt = db.prepare(sql);
            const rows = stmt.all(...params);
            return Promise.resolve({ rows });
        } else {
            const stmt = db.prepare(sql);
            const result = stmt.run(...params);
            return Promise.resolve({
                rows: [{ id: result.lastInsertRowid, changes: result.changes }]
            });
        }
    } catch (err) {
        console.error('SQLite query error:', err.message);
        console.error('Query was:', text);
        return Promise.reject(err);
    }
}

module.exports = {
    query,
    connect: () => Promise.resolve({ query, release: () => {} }),
    end: () => { try { db.close(); } catch (e) {} },
    _raw: db
};

console.log('📦 db-sqlite.js loaded');