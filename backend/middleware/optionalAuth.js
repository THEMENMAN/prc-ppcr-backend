// ============================================================
// Optional Authentication Middleware
// If a valid token is provided, populate req.user.
// If no token or invalid token, silently continue (req.user = null).
// Used for endpoints that can accept anonymous submissions.
// ============================================================

const jwt = require('jsonwebtoken');
require('dotenv').config();

module.exports = function (req, res, next) {
    const authHeader = req.header('Authorization');

    if (!authHeader) {
        // No token — anonymous access
        req.user = null;
        return next();
    }

    const token = authHeader.replace('Bearer ', '');

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
    } catch (err) {
        // Invalid token — still allow, but as anonymous
        req.user = null;
    }

    next();
};