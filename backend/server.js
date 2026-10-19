const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
require('dotenv').config();

const app = express();

// ============================================================
// REQUEST LOGGING
// ============================================================
app.use((req, res, next) => {
    const start = Date.now();
    const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    console.log(`📥 ${req.method} ${req.originalUrl} — ${clientIP}`);
    res.on('finish', () => {
        const ms = Date.now() - start;
        if (res.statusCode >= 400) {
            console.log(`   ❌ ${res.statusCode} (${ms}ms)`);
        } else if (req.originalUrl.startsWith('/api')) {
            console.log(`   ✅ ${res.statusCode} (${ms}ms)`);
        }
    });
    next();
});

// ============================================================
// SECURITY
// ============================================================
app.use(helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false
}));

// CORS — allow the configured frontend origin
const corsOptions = {
    origin: process.env.FRONTEND_URL || '*',
    credentials: true,
    optionsSuccessStatus: 200
};
app.use(cors(corsOptions));

// Body parsers
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// ============================================================
// RATE LIMITING — generous for 5+ concurrent devices
// ============================================================
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5000,                 // 5000 requests per IP per 15 min
    skip: (req) => !req.path.startsWith('/api'),
    message: { error: 'Too many requests. Please wait a moment.' },
    standardHeaders: true,
    legacyHeaders: false
});
app.use('/api/', limiter);

// ============================================================
// API ROUTES
// ============================================================
app.use('/api/auth', require('./routes/auth'));
app.use('/api/reports', require('./routes/reports'));
app.use('/api/admin', require('./routes/admin'));

// ============================================================
// HEALTH + NETWORK INFO
// ============================================================
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        time: new Date().toISOString(),
        uptime_seconds: Math.floor(process.uptime()),
        node_version: process.version
    });
});

app.get('/api/network', (req, res) => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const addresses = [];
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                addresses.push({
                    interface: name,
                    address: iface.address,
                    url: `http://${iface.address}:${process.env.PORT || 5000}`
                });
            }
        }
    }
    res.json({
        local_ip: addresses,
        hint: 'Phones on the same WiFi can use these URLs'
    });
});

// ============================================================
// STATIC FILES
// ============================================================
app.use('/admin', express.static(path.join(__dirname, '..', 'admin')));
app.use(express.static(path.join(__dirname, '..', 'frontend')));

// ============================================================
// FALLBACK
// ============================================================
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        console.log(`❌ API 404: ${req.method} ${req.path}`);
        return res.status(404).json({
            error: 'API endpoint not found',
            method: req.method,
            path: req.path
        });
    }
    if (req.path.startsWith('/admin')) {
        return res.status(404).send('Admin page not found');
    }
    res.sendFile(path.join(__dirname, '..', 'frontend', 'index.html'));
});

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
    console.error('💥 Server error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: err.message || 'Server error' });
});

// ============================================================
// START SERVER
// ============================================================
const PORT = process.env.PORT || 5000;
const HOST = '0.0.0.0'; // Listen on ALL network interfaces

app.listen(PORT, HOST, () => {
    const os = require('os');
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const name in interfaces) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                ips.push(iface.address);
            }
        }
    }

    console.log('');
    console.log('═══════════════════════════════════════════════════════');
    console.log('🚀 PRC PPCR System — Running');
    console.log('═══════════════════════════════════════════════════════');
    console.log(`📝 Frontend:  http://localhost:${PORT}/`);
    console.log(`👑 Admin:     http://localhost:${PORT}/admin/`);
    console.log(`🔌 API:       http://localhost:${PORT}/api`);
    console.log('───────────────────────────────────────────────────────');
    console.log('📱 For phones on same WiFi, use one of these URLs:');
    ips.forEach((ip) => {
        console.log(`   http://${ip}:${PORT}/`);
        console.log(`   http://${ip}:${PORT}/admin/`);
    });
    console.log('═══════════════════════════════════════════════════════');
    console.log('💡 Supports unlimited concurrent devices');
    console.log('💡 Reports save anonymously — no login needed');
    console.log('💡 Admin dashboard requires login');
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
});