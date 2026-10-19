const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const auth = require('../middleware/auth');

// ============================================================
// MIDDLEWARE — Staff or Admin access
// ============================================================
function staffOrAdmin(req, res, next) {
    if (!req.user || !['admin', 'staff'].includes(req.user.role)) {
        return res.status(403).json({ error: 'Staff or Admin access required' });
    }
    next();
}

// ============================================================
// MIDDLEWARE — Admin only
// ============================================================
function adminOnly(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
    }
    next();
}

// ============================================================
// STATS
// ============================================================
router.get('/stats', auth, staffOrAdmin, async (req, res) => {
    try {
        const stats = await pool.query(`
            SELECT
                (SELECT COUNT(*) FROM ppcr_reports) AS total_reports,
                (SELECT COUNT(*) FROM ppcr_reports WHERE created_at >= NOW() - INTERVAL '24 hours') AS today,
                (SELECT COUNT(*) FROM ppcr_reports WHERE created_at >= NOW() - INTERVAL '7 days') AS this_week,
                (SELECT COUNT(*) FROM ppcr_reports WHERE created_at >= NOW() - INTERVAL '30 days') AS this_month,
                (SELECT COUNT(*) FROM users WHERE is_active = TRUE) AS active_users,
                (SELECT COUNT(*) FROM ppcr_reports WHERE nature_illness->'checked' ? 'Trauma') AS trauma_cases,
                (SELECT COUNT(*) FROM ppcr_reports WHERE nature_illness->'checked' ? 'Cardiac') AS cardiac_cases,
                (SELECT COUNT(*) FROM ppcr_reports WHERE nature_illness->'checked' ? 'Respiratory') AS respiratory_cases
        `);
        res.json(stats.rows[0]);
    } catch (err) {
        console.error('Stats error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DAILY CHART
// ============================================================
router.get('/charts/daily', auth, staffOrAdmin, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT DATE(created_at) AS day, COUNT(*) AS count
            FROM ppcr_reports
            WHERE created_at >= NOW() - INTERVAL '7 days'
            GROUP BY DATE(created_at)
            ORDER BY day ASC
        `);
        res.json(result.rows);
    } catch (err) {
        console.error('Chart error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// LIST REPORTS WITH FILTERS
// ============================================================
router.get('/reports', auth, staffOrAdmin, async (req, res) => {
    try {
        const {
            limit = 20, offset = 0, search = '',
            startDate = '', endDate = '',
            nature = '', mechanism = '',
            provider = '', area = '',
            timeStart = '', timeEnd = ''
        } = req.query;

        const conditions = [];
        const params = [];
        let paramIndex = 1;

        if (search) {
            conditions.push(`(
                serial_no ILIKE $${paramIndex} OR
                patient_data->>'name' ILIKE $${paramIndex} OR
                incident_data->>'location' ILIKE $${paramIndex} OR
                provider_info->>'name' ILIKE $${paramIndex}
            )`);
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (startDate) { conditions.push(`created_at >= $${paramIndex++}`); params.push(startDate); }
        if (endDate) { conditions.push(`created_at <= $${paramIndex++}`); params.push(endDate + ' 23:59:59'); }
        if (nature) { conditions.push(`nature_illness->'checked' ? $${paramIndex++}`); params.push(nature); }
        if (mechanism) { conditions.push(`patient_assessment->'mechanism'->'checked' ? $${paramIndex++}`); params.push(mechanism); }
        if (provider) { conditions.push(`provider_info->>'name' ILIKE $${paramIndex++}`); params.push(`%${provider}%`); }
        if (area) { conditions.push(`incident_data->>'response_area' = $${paramIndex++}`); params.push(area); }
        if (timeStart) { conditions.push(`incident_data->>'call_time' >= $${paramIndex++}`); params.push(timeStart); }
        if (timeEnd) { conditions.push(`incident_data->>'call_time' <= $${paramIndex++}`); params.push(timeEnd); }

        const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const countResult = await pool.query(
            `SELECT COUNT(*) FROM ppcr_reports ${whereClause}`,
            params
        );
        const total = parseInt(countResult.rows[0].count);

        const dataParams = [...params, parseInt(limit), parseInt(offset)];
        const result = await pool.query(
            `SELECT id, client_uuid, serial_no, status,
                patient_data->>'name' AS patient_name,
                patient_data->>'age' AS patient_age,
                patient_data->>'gender' AS patient_gender,
                incident_data->>'location' AS location,
                incident_data->>'nature_of_call' AS nature_of_call,
                incident_data->>'type_of_emergency' AS type_of_emergency,
                incident_data->>'response_area' AS response_area,
                provider_info->>'name' AS provider_name,
                nature_illness->'checked' AS nature_illness,
                created_at
             FROM ppcr_reports
             ${whereClause}
             ORDER BY created_at DESC
             LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
            dataParams
        );

        res.json({
            reports: result.rows,
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        console.error('List reports error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET ONE REPORT (full details)
// ============================================================
router.get('/reports/:id', auth, staffOrAdmin, async (req, res) => {
    try {
        const result = await pool.query(
            'SELECT * FROM ppcr_reports WHERE id = $1',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json({ report: result.rows[0] });
    } catch (err) {
        console.error('Get report error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE REPORT (admin only)
// ============================================================
router.delete('/reports/:id', auth, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            'DELETE FROM ppcr_reports WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Delete error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// ANALYTICS
// ============================================================
router.get('/analytics', auth, staffOrAdmin, async (req, res) => {
    try {
        const { startDate, endDate } = req.query;
        const conditions = [];
        const params = [];
        let idx = 1;

        if (startDate) { conditions.push(`created_at >= $${idx++}`); params.push(startDate); }
        if (endDate) { conditions.push(`created_at <= $${idx++}`); params.push(endDate + ' 23:59:59'); }

        const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

        const injuries = await pool.query(`
            SELECT finding AS label, COUNT(*)::int AS count
            FROM ppcr_reports, jsonb_array_elements_text(patient_assessment->'exam_findings') AS finding
            ${where}
            GROUP BY finding
            ORDER BY count DESC
            LIMIT 10
        `, params);

        const bodyParts = await pool.query(`
            SELECT part AS label, COUNT(*)::int AS count
            FROM ppcr_reports, jsonb_array_elements_text(patient_assessment->'injured_parts') AS part
            ${where}
            GROUP BY part
            ORDER BY count DESC
            LIMIT 10
        `, params);

        const mechanisms = await pool.query(`
            SELECT mech AS label, COUNT(*)::int AS count
            FROM ppcr_reports, jsonb_array_elements_text(patient_assessment->'mechanism'->'checked') AS mech
            ${where}
            GROUP BY mech
            ORDER BY count DESC
            LIMIT 8
        `, params);

        const peakHours = await pool.query(`
            SELECT SUBSTRING(incident_data->>'call_time', 1, 2) AS hour, COUNT(*)::int AS count
            FROM ppcr_reports
            ${where ? where + ' AND' : 'WHERE'} incident_data->>'call_time' IS NOT NULL
              AND incident_data->>'call_time' != ''
            GROUP BY hour
            ORDER BY hour
        `, params);

        const areas = await pool.query(`
            SELECT incident_data->>'response_area' AS label, COUNT(*)::int AS count
            FROM ppcr_reports
            ${where ? where + ' AND' : 'WHERE'} incident_data->>'response_area' IS NOT NULL
            GROUP BY label
            ORDER BY count DESC
        `, params);

        const providers = await pool.query(`
            SELECT provider_info->>'name' AS label, COUNT(*)::int AS count
            FROM ppcr_reports
            ${where ? where + ' AND' : 'WHERE'} provider_info->>'name' IS NOT NULL
            GROUP BY label
            ORDER BY count DESC
            LIMIT 10
        `, params);

        const days = await pool.query(`
            SELECT TO_CHAR(created_at, 'Dy') AS day, COUNT(*)::int AS count
            FROM ppcr_reports
            ${where}
            GROUP BY day, EXTRACT(DOW FROM created_at)
            ORDER BY EXTRACT(DOW FROM created_at)
        `, params);

        res.json({
            injuries: injuries.rows,
            bodyParts: bodyParts.rows,
            mechanisms: mechanisms.rows,
            peakHours: peakHours.rows,
            areas: areas.rows,
            providers: providers.rows,
            days: days.rows
        });
    } catch (err) {
        console.error('Analytics error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// BULK CSV EXPORT
// ============================================================
router.get('/export/csv', auth, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                serial_no,
                created_at,
                incident_data->>'nature_of_call' AS nature_of_call,
                incident_data->>'type_of_emergency' AS type_of_emergency,
                incident_data->>'call_date' AS call_date,
                incident_data->>'call_time' AS call_time,
                incident_data->>'location' AS location,
                patient_data->>'name' AS patient_name,
                patient_data->>'age' AS patient_age,
                patient_data->>'gender' AS patient_gender,
                patient_data->>'address' AS patient_address,
                patient_data->>'contact' AS patient_contact,
                primary_survey->>'cspine' AS cspine,
                primary_survey->>'airway' AS airway,
                primary_survey->>'breathing' AS breathing,
                primary_survey->>'pulse' AS pulse,
                primary_survey->>'skin' AS skin,
                vital_signs->>'pulse_1' AS pulse_1,
                vital_signs->>'rr_1' AS rr_1,
                vital_signs->>'spo2_1' AS spo2_1,
                vital_signs->>'bp_1' AS bp_1,
                vital_signs->>'temp_1' AS temp_1,
                vital_signs->>'gcs_total' AS gcs_total,
                patient_assessment->>'loc_arrival' AS loc_arrival,
                patient_assessment->>'burn_class' AS burn_class,
                nature_illness->>'checked' AS nature_of_illness,
                patient_assessment->'mechanism'->>'checked' AS mechanism,
                narrative->>'notes' AS narrative,
                provider_info->>'name' AS provider_name,
                provider_info->>'license' AS provider_license,
                additional_info
            FROM ppcr_reports
            ORDER BY created_at DESC
        `);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'No reports found' });
        }

        const headers = Object.keys(result.rows[0]);
        const escapeCSV = (val) => {
            if (val === null || val === undefined) return '';
            const s = String(val).replace(/"/g, '""').replace(/\r?\n/g, ' ');
            return `"${s}"`;
        };

        const csv = [
            headers.join(','),
            ...result.rows.map((row) => headers.map((h) => escapeCSV(row[h])).join(','))
        ].join('\n');

        const timestamp = new Date().toISOString().slice(0, 10);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="PPCR_Export_${timestamp}.csv"`);
        res.send('\uFEFF' + csv);
    } catch (err) {
        console.error('Export error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// LIST USERS
// ============================================================
router.get('/users', auth, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, full_name, license_no, role, is_active, last_login, created_at
            FROM users
            ORDER BY created_at DESC
        `);
        res.json({ users: result.rows });
    } catch (err) {
        console.error('List users error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// CREATE USER (admin only)
// ============================================================
router.post('/users', auth, adminOnly, async (req, res) => {
    try {
        const { username, password, full_name, license_no, role } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password required' });
        }

        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, password_hash, full_name, license_no, role)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, username, full_name, license_no, role, is_active, created_at`,
            [username, hash, full_name || null, license_no || null, role || 'volunteer']
        );
        res.status(201).json({ user: result.rows[0] });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        console.error('Create user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// TOGGLE USER ACTIVE
// ============================================================
router.patch('/users/:id/toggle', auth, adminOnly, async (req, res) => {
    try {
        const result = await pool.query(
            `UPDATE users SET is_active = NOT is_active
             WHERE id = $1
             RETURNING id, username, is_active`,
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ user: result.rows[0] });
    } catch (err) {
        console.error('Toggle user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// DELETE USER
// ============================================================
router.delete('/users/:id', auth, adminOnly, async (req, res) => {
    try {
        if (parseInt(req.params.id) === req.user.id) {
            return res.status(400).json({ error: 'Cannot delete your own account' });
        }
        const result = await pool.query(
            'DELETE FROM users WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }
        res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Delete user error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// RECENT ACTIVITY — most recent reports
// ============================================================
router.get('/activity', auth, staffOrAdmin, async (req, res) => {
  try {
    const { limit = 10 } = req.query;

    const rows = (await pool.query(
      'SELECT * FROM ppcr_reports ORDER BY created_at DESC'
    )).rows.slice(0, parseInt(limit));

    const activity = rows.map(r => {
      const pat = safeParse(r.patient_data);
      const inc = safeParse(r.incident_data);
      const prov = safeParse(r.provider_info);

      return {
        id: r.id,
        serial_no: r.serial_no,
        patient_name: pat.name || 'Unknown',
        location: inc.location || '—',
        type_of_emergency: inc.type_of_emergency || inc.nature_of_call || '—',
        provider_name: prov.name || '—',
        created_at: r.created_at
      };
    });

    res.json({ activity });
  } catch (err) {
    console.error('Activity error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// AUDIT LOG — recent user actions
// ============================================================
router.get('/audit-log', auth, adminOnly, async (req, res) => {
  try {
    const { limit = 50 } = req.query;

    // SQLite doesn't have audit_logs table yet — create if needed
    try {
      const result = await pool.query(
        'SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?',
        [parseInt(limit)]
      );
      res.json({ logs: result.rows });
    } catch (tableErr) {
      // Table doesn't exist — return empty
      res.json({ logs: [] });
    }
  } catch (err) {
    console.error('Audit log error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
