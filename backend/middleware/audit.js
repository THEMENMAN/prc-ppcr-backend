// ============================================================
// AUDIT LOG MIDDLEWARE
// Records every important action into the audit_logs table
// ============================================================
const pool = require('../db');

/**
 * Log an action to the audit_logs table.
 * @param {Object} opts
 * @param {number|null} opts.userId
 * @param {number|null} opts.reportId
 * @param {string} opts.action      e.g. 'LOGIN', 'REPORT_CREATED'
 * @param {Object} opts.details     extra info (JSON)
 * @param {string} opts.ip
 */
async function logAction({ userId, reportId, action, details = {}, ip = null }) {
    try {
        await pool.query(
            `INSERT INTO audit_logs (user_id, report_id, action, details, ip_address)
             VALUES ($1, $2, $3, $4, $5)`,
            [userId || null, reportId || null, action, details, ip]
        );
    } catch (err) {
        console.error('⚠️ Audit log failed:', err.message);
    }
}

/**
 * Express middleware — attaches `req.audit()` helper.
 */
function auditMiddleware(req, res, next) {
    req.audit = (action, details = {}, reportId = null) => {
        const userId = req.user?.id || null;
        const ip =
            req.headers['x-forwarded-for']?.split(',')[0].trim() ||
            req.socket?.remoteAddress ||
            null;
        logAction({ userId, reportId, action, details, ip });
    };
    next();
}

module.exports = { logAction, auditMiddleware };