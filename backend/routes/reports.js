const express = require('express');
const router = express.Router();
const pool = require('../db');
const auth = require('../middleware/auth');
const optionalAuth = require('../middleware/optionalAuth');

// ============================================================
// CREATE / UPDATE REPORT — accepts anonymous submissions
// ============================================================
router.post('/', optionalAuth, async (req, res) => {
    try {
        const {
            client_uuid, serial_no,
            incident_data, patient_data, primary_survey,
            vital_signs, care_management, patient_assessment,
            sample_history, nature_illness, mechanism,
            narrative, cessation, refusal,
            provider_info, additional_info, signatures
        } = req.body;

        if (!client_uuid) return res.status(400).json({ error: 'client_uuid is required' });

        const mergedAssessment = {
            ...(patient_assessment || {}),
            sample_history: sample_history || {},
            mechanism: mechanism || {},
            cessation: cessation || {},
            refusal: refusal || {}
        };

        const mergedNarrative = {
            ...(narrative || {}),
            cessation: cessation || {},
            refusal: refusal || {}
        };

        const createdBy = req.user ? req.user.id : null;

        const result = await pool.query(
            `INSERT INTO ppcr_reports
                (client_uuid, serial_no, incident_data, patient_data, primary_survey,
                 vital_signs, care_management, patient_assessment, nature_illness,
                 narrative, provider_info, additional_info,
                 signature_patient, signature_provider, signature_receiving, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
             ON CONFLICT (client_uuid) DO UPDATE SET
                serial_no = EXCLUDED.serial_no,
                incident_data = EXCLUDED.incident_data,
                patient_data = EXCLUDED.patient_data,
                primary_survey = EXCLUDED.primary_survey,
                vital_signs = EXCLUDED.vital_signs,
                care_management = EXCLUDED.care_management,
                patient_assessment = EXCLUDED.patient_assessment,
                nature_illness = EXCLUDED.nature_illness,
                narrative = EXCLUDED.narrative,
                provider_info = EXCLUDED.provider_info,
                additional_info = EXCLUDED.additional_info,
                signature_patient = EXCLUDED.signature_patient,
                signature_provider = EXCLUDED.signature_provider,
                signature_receiving = EXCLUDED.signature_receiving,
                updated_at = NOW()
             RETURNING id, client_uuid`,
            [
                client_uuid,
                serial_no || null,
                JSON.stringify(incident_data || {}),
                JSON.stringify(patient_data || {}),
                JSON.stringify(primary_survey || {}),
                JSON.stringify(vital_signs || {}),
                JSON.stringify(care_management || {}),
                JSON.stringify(mergedAssessment),
                JSON.stringify(nature_illness || {}),
                JSON.stringify(mergedNarrative),
                JSON.stringify(provider_info || {}),
                additional_info || null,
                signatures?.patient || null,
                signatures?.provider || null,
                signatures?.receiving || null,
                createdBy
            ]
        );

        console.log(`✅ Report saved: ${client_uuid} (by: ${req.user?.username || 'anonymous'})`);

        res.status(201).json({
            success: true,
            id: result.rows[0].id,
            client_uuid: result.rows[0].client_uuid
        });
    } catch (err) {
        console.error('Create report error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET ALL REPORTS (requires auth — this is admin/staff data)
// ============================================================
router.get('/', auth, async (req, res) => {
    try {
        const limit = Math.min(parseInt(req.query.limit) || 50, 500);
        const offset = parseInt(req.query.offset) || 0;

        const result = await pool.query(
            `SELECT * FROM ppcr_reports
             ORDER BY created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset]
        );
        res.json({ reports: result.rows });
    } catch (err) {
        console.error('Get reports error:', err);
        res.status(500).json({ error: err.message });
    }
});

// ============================================================
// GET ONE REPORT
// ============================================================
router.get('/:id', auth, async (req, res) => {
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
// BULK SYNC — accepts anonymous submissions
// ============================================================
router.post('/sync', optionalAuth, async (req, res) => {
    try {
        const { reports } = req.body;
        if (!Array.isArray(reports)) {
            return res.status(400).json({ error: 'reports must be an array' });
        }

        const results = { success: 0, failed: 0, errors: [] };
        const createdBy = req.user ? req.user.id : null;

        for (const report of reports) {
            try {
                const mergedAssessment = {
                    ...(report.patient_assessment || {}),
                    sample_history: report.sample_history || {},
                    mechanism: report.mechanism || {},
                    cessation: report.cessation || {},
                    refusal: report.refusal || {}
                };

                const mergedNarrative = {
                    ...(report.narrative || {}),
                    cessation: report.cessation || {},
                    refusal: report.refusal || {}
                };

                await pool.query(
                    `INSERT INTO ppcr_reports
                        (client_uuid, serial_no, incident_data, patient_data, primary_survey,
                         vital_signs, care_management, patient_assessment, nature_illness,
                         narrative, provider_info, additional_info,
                         signature_patient, signature_provider, signature_receiving, created_by)
                     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
                     ON CONFLICT (client_uuid) DO NOTHING`,
                    [
                        report.client_uuid,
                        report.serial_no || null,
                        JSON.stringify(report.incident_data || {}),
                        JSON.stringify(report.patient_data || {}),
                        JSON.stringify(report.primary_survey || {}),
                        JSON.stringify(report.vital_signs || {}),
                        JSON.stringify(report.care_management || {}),
                        JSON.stringify(mergedAssessment),
                        JSON.stringify(report.nature_illness || {}),
                        JSON.stringify(mergedNarrative),
                        JSON.stringify(report.provider_info || {}),
                        report.additional_info || null,
                        report.signatures?.patient || null,
                        report.signatures?.provider || null,
                        report.signatures?.receiving || null,
                        createdBy
                    ]
                );
                results.success++;
            } catch (err) {
                results.failed++;
                results.errors.push({ uuid: report.client_uuid, error: err.message });
            }
        }

        console.log(`📦 Bulk sync: ${results.success} success, ${results.failed} failed`);
        res.json(results);
    } catch (err) {
        console.error('Sync error:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;