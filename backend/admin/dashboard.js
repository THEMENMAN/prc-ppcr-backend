// ============================================================
// PRC PPCR - Admin Dashboard Logic v5
// Admin-only quick access + full report viewer
// ============================================================

// ---------- CONFIG ----------
let API_URL = localStorage.getItem('ppcr_admin_api') || 'https://prc-ppcr-backend-production.up.railway.app/api';
let currentPage = 0;
let currentLimit = 20;
let totalReports = 0;
let currentReport = null;
let dailyChart = null;
let providersChart = null;

let auditPage = 0;
let auditLimit = 50;
let auditTotal = 0;

let autoRefreshTimer = null;
let lastKnownReportCount = null;

// ---------- HELPERS ----------
function $(id) { return document.getElementById(id); }

function toast(msg, ms = 2500) {
    const el = $('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.add('hidden'), ms);
}

function getToken() { return localStorage.getItem('ppcr_admin_token'); }
function setToken(t) { localStorage.setItem('ppcr_admin_token', t); }
function setUser(u) { localStorage.setItem('ppcr_admin_user', JSON.stringify(u)); }
function getUser() {
    try { return JSON.parse(localStorage.getItem('ppcr_admin_user') || 'null'); }
    catch { return null; }
}

async function api(path, opts = {}) {
    if (window.location.protocol === 'file:') {
        throw new Error('This file was opened directly from disk. Open the deployed admin page at https://prc-ppcr-backend-production.up.railway.app/admin/ instead.');
    }

    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;

    let res;
    try {
        res = await fetch(`${API_URL}${path}`, { ...opts, headers });
    } catch {
        throw new Error('Cannot reach server.');
    }

    const isAuthEndpoint = path.startsWith('/auth/login') || path.startsWith('/auth/register');
    if (res.status === 401 && !isAuthEndpoint) {
        logout();
        throw new Error('Session expired.');
    }
    if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Request failed (${res.status})`);
    }
    return res.json();
}

function fmtDate(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-PH', {
        month: 'short', day: 'numeric', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
}

function fmtDateShort(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
}

function fmtTimeAgo(iso) {
    if (!iso) return '';
    const diff = (Date.now() - new Date(iso).getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return fmtDateShort(iso);
}

function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, (c) => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

function cb(checked, label) {
    return `<span class="cb ${checked ? 'cb-on' : 'cb-off'}">${checked ? '☑' : '☐'}</span> ${escapeHtml(label)}`;
}

function fieldLine(label, value) {
    return `<div class="rpt-field">
        <span class="rpt-label">${escapeHtml(label)}</span>
        <div class="rpt-value">${escapeHtml(value || '—')}</div>
    </div>`;
}

// ---------- SIDEBAR ----------
function toggleSidebar() {
    $('sidebar').classList.toggle('open');
}

// ============================================================
// QUICK LOGIN — Admin only
// ============================================================
async function quickLogin(role) {
    const credentials = {
        admin: { username: 'admin', password: 'admin123' }
    };
    const cred = credentials[role];
    if (!cred) return;

    const errBox = $('login-error');
    errBox.classList.add('hidden');
    const btns = document.querySelectorAll('#login-screen button[type="button"]');
    btns.forEach(b => { b.disabled = true; b.style.opacity = '0.6'; });

    try {
        const data = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify(cred)
        });
        if (data.user.role !== 'admin') {
            throw new Error('Access denied — admin role required');
        }
        setToken(data.token);
        setUser(data.user);
        showDashboard();
    } catch (err) {
        errBox.textContent = err.message || 'Quick login failed.';
        errBox.classList.remove('hidden');
        btns.forEach(b => { b.disabled = false; b.style.opacity = '1'; });
    }
}

// ============================================================
// MANUAL LOGIN
// ============================================================
$('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = $('login-username').value.trim();
    const password = $('login-password').value;
    const errBox = $('login-error');
    errBox.classList.add('hidden');
    try {
        const data = await api('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
        if (!['admin', 'staff'].includes(data.user.role)) {
            errBox.textContent = 'Access denied — admin or staff role required.';
            errBox.classList.remove('hidden');
            return;
        }
        setToken(data.token);
        setUser(data.user);
        showDashboard();
    } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
    }
});

// ============================================================
// SHOW DASHBOARD
// ============================================================
function showDashboard() {
    $('login-screen').classList.add('hidden');
    $('dashboard').classList.remove('hidden');

    const user = getUser();
    if (user) {
        const roleBadge = { admin: '👑 Admin', staff: '👨‍⚕️ Staff' }[user.role] || user.role;
        $('sidebar-user').innerHTML = `<strong>${escapeHtml(user.full_name || user.username)}</strong>${roleBadge}`;
    }

    // Only admin sees Users and Audit tabs
    if (user && user.role !== 'admin') {
        document.querySelector('[data-tab="users"]')?.style.setProperty('display', 'none');
        document.querySelector('[data-tab="audit"]')?.style.setProperty('display', 'none');
    }

    $('setting-api-url').value = API_URL;

    loadStats();
    loadDailyChart();
    loadProvidersChart();
    loadActivity();
    startAutoRefresh();
}

function logout() {
    stopAutoRefresh();
    localStorage.removeItem('ppcr_admin_token');
    localStorage.removeItem('ppcr_admin_user');
    $('dashboard').classList.add('hidden');
    $('login-screen').classList.remove('hidden');
    $('login-form')?.reset();
}

function logoutAll() {
    if (!confirm('Log out and clear all local admin data?')) return;
    stopAutoRefresh();
    localStorage.removeItem('ppcr_admin_token');
    localStorage.removeItem('ppcr_admin_user');
    localStorage.removeItem('ppcr_admin_api');
    location.reload();
}

// ============================================================
// AUTO-REFRESH
// ============================================================
function startAutoRefresh() {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(autoRefreshTick, 8000);
}

function stopAutoRefresh() {
    if (autoRefreshTimer) {
        clearInterval(autoRefreshTimer);
        autoRefreshTimer = null;
    }
}

async function autoRefreshTick() {
    if (document.visibilityState === 'hidden') return;

    const modalsOpen =
        !$('report-modal')?.classList.contains('hidden') ||
        !$('user-modal')?.classList.contains('hidden');
    if (modalsOpen) return;

    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;

    try {
        const stats = await api('/admin/stats');
        const currentTotal = parseInt(stats.total_reports);

        if (lastKnownReportCount !== null && currentTotal > lastKnownReportCount) {
            const diff = currentTotal - lastKnownReportCount;
            toast(`🔔 ${diff} new report${diff > 1 ? 's' : ''} received!`, 4000);
            if (activeTab === 'reports') loadReports();
        }
        lastKnownReportCount = currentTotal;

        if (activeTab === 'overview') {
            $('stat-total').textContent = stats.total_reports;
            $('stat-today').textContent = stats.today;
            $('stat-week').textContent = stats.this_week;
            $('stat-users').textContent = stats.active_users;
            $('stat-trauma').textContent = stats.trauma_cases;
            $('stat-cardiac').textContent = stats.cardiac_cases;
            $('stat-respiratory').textContent = stats.respiratory_cases;
            $('stat-neuro').textContent = stats.neuro_cases;
            $('stat-ob').textContent = stats.ob_cases;
            loadActivity();
        } else if (activeTab === 'activity') {
            loadActivity(true);
        }
    } catch (err) {
        console.debug('Auto-refresh error:', err.message);
    }
}

// ============================================================
// TAB SWITCHING
// ============================================================
const TAB_TITLES = {
    overview: { title: 'Overview', sub: 'System dashboard and statistics' },
    reports: { title: 'Reports', sub: 'All submitted patient care reports' },
    users: { title: 'Users', sub: 'Manage system users and roles' },
    activity: { title: 'Activity Log', sub: 'Recent system activity' },
    audit: { title: 'Audit Trail', sub: 'Complete record of all actions' },
    settings: { title: 'Settings', sub: 'Configure your dashboard' }
};

function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.add('hidden'));
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));

    const tabEl = $(`tab-${tab}`);
    if (tabEl) tabEl.classList.remove('hidden');

    const btnEl = document.querySelector(`[data-tab="${tab}"]`);
    if (btnEl) btnEl.classList.add('active');

    if (TAB_TITLES[tab]) {
        $('page-title').textContent = TAB_TITLES[tab].title;
        $('page-subtitle').textContent = TAB_TITLES[tab].sub;
    }

    if (window.innerWidth < 1024) $('sidebar').classList.remove('open');

    if (tab === 'overview') { loadStats(); loadDailyChart(); loadProvidersChart(); loadActivity(); }
    if (tab === 'reports') loadReports();
    if (tab === 'users') loadUsers();
    if (tab === 'activity') loadActivity(true);
    if (tab === 'audit') loadAuditLogs();
}

function refreshAll() {
    loadStats();
    loadDailyChart();
    loadProvidersChart();
    loadActivity();
    const activeTab = document.querySelector('.nav-item.active')?.dataset.tab;
    if (activeTab === 'reports') loadReports();
    if (activeTab === 'users') loadUsers();
    if (activeTab === 'audit') loadAuditLogs();
    toast('🔄 Refreshed');
}

// ============================================================
// OVERVIEW — STATS
// ============================================================
async function loadStats() {
    try {
        const s = await api('/admin/stats');
        $('stat-total').textContent = s.total_reports;
        $('stat-today').textContent = s.today;
        $('stat-week').textContent = s.this_week;
        $('stat-users').textContent = s.active_users;
        $('stat-trauma').textContent = s.trauma_cases;
        $('stat-cardiac').textContent = s.cardiac_cases;
        $('stat-respiratory').textContent = s.respiratory_cases;
        $('stat-neuro').textContent = s.neuro_cases;
        $('stat-ob').textContent = s.ob_cases;
        lastKnownReportCount = parseInt(s.total_reports);
    } catch (err) { console.error('Stats error:', err); }
}

// ============================================================
// OVERVIEW — DAILY CHART (Fixed sizing)
// ============================================================
async function loadDailyChart() {
    try {
        const data = await api('/admin/charts/daily');
        const labels = data.map(d => fmtDateShort(d.day));
        const counts = data.map(d => parseInt(d.count));
        const canvas = $('daily-chart');
        if (!canvas) return;

        if (dailyChart) {
            dailyChart.destroy();
            dailyChart = null;
        }

        // Explicit inline sizing — prevents infinite growth
        canvas.style.height = '248px';
        canvas.style.width = '100%';

        dailyChart = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label: 'Reports',
                    data: counts,
                    borderColor: '#dc2626',
                    backgroundColor: 'rgba(220, 38, 38, 0.1)',
                    borderWidth: 3,
                    tension: 0.35,
                    fill: true,
                    pointBackgroundColor: '#dc2626',
                    pointRadius: 5,
                    pointHoverRadius: 7
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    } catch (err) { console.error('Daily chart error:', err); }
}

// ============================================================
// OVERVIEW — PROVIDERS CHART (with empty state)
// ============================================================
async function loadProvidersChart() {
    try {
        const data = await api('/admin/charts/providers');
        const canvas = $('providers-chart');
        if (!canvas) return;

        if (providersChart) {
            providersChart.destroy();
            providersChart = null;
        }

        canvas.style.height = '248px';
        canvas.style.width = '100%';

        let labels, counts, isEmpty = false;
        if (!data || data.length === 0) {
            labels = ['No data yet'];
            counts = [1];
            isEmpty = true;
        } else {
            labels = data.map(d => d.provider || 'Unknown');
            counts = data.map(d => parseInt(d.count));
        }

        providersChart = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: counts,
                    backgroundColor: isEmpty
                        ? ['#e5e7eb']
                        : ['#dc2626', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'],
                    borderWidth: 2,
                    borderColor: 'white'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                cutout: '65%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            font: { size: 11 },
                            boxWidth: 12,
                            padding: 8,
                            generateLabels: isEmpty ? () => [] : undefined
                        }
                    },
                    tooltip: { enabled: !isEmpty }
                }
            },
            plugins: [{
                id: 'emptyStateText',
                afterDraw: (chart) => {
                    if (!isEmpty) return;
                    const { ctx: c, chartArea } = chart;
                    c.save();
                    c.font = 'bold 13px -apple-system, sans-serif';
                    c.fillStyle = '#9ca3af';
                    c.textAlign = 'center';
                    c.fillText('No provider data yet', chartArea.left + chartArea.width / 2, chartArea.top + chartArea.height / 2);
                    c.restore();
                }
            }]
        });
    } catch (err) { console.error('Providers chart error:', err); }
}

// ============================================================
// ACTIVITY
// ============================================================
const ACTION_ICONS = {
    LOGIN_SUCCESS: { icon: '🔓', color: 'bg-emerald-100 text-emerald-600' },
    LOGIN_FAILED: { icon: '🚫', color: 'bg-red-100 text-red-600' },
    USER_REGISTERED: { icon: '🆕', color: 'bg-blue-100 text-blue-600' },
    USER_CREATED: { icon: '👤', color: 'bg-blue-100 text-blue-600' },
    USER_DELETED: { icon: '❌', color: 'bg-red-100 text-red-600' },
    USER_TOGGLED: { icon: '🔄', color: 'bg-amber-100 text-amber-600' },
    REPORT_CREATED: { icon: '📝', color: 'bg-emerald-100 text-emerald-600' },
    REPORT_VIEWED: { icon: '👁', color: 'bg-gray-100 text-gray-600' },
    REPORT_DELETED: { icon: '🗑', color: 'bg-red-100 text-red-600' },
    REPORT_SYNCED: { icon: '☁️', color: 'bg-blue-100 text-blue-600' }
};

function formatActivityText(a) {
    const who = a.full_name || a.username || 'Anonymous';
    const d = a.details || {};
    switch (a.action) {
        case 'LOGIN_SUCCESS': return `<strong>${escapeHtml(who)}</strong> logged in`;
        case 'LOGIN_FAILED': return `Failed login attempt for <strong>${escapeHtml(d.username || who)}</strong>`;
        case 'REPORT_CREATED': return `<strong>${escapeHtml(who)}</strong> created report ${escapeHtml(d.serial_no || '')}`;
        case 'REPORT_VIEWED': return `<strong>${escapeHtml(who)}</strong> viewed report ${escapeHtml(d.serial_no || '')}`;
        case 'REPORT_DELETED': return `<strong>${escapeHtml(who)}</strong> deleted report ${escapeHtml(d.serial_no || '')}`;
        case 'REPORT_SYNCED': return `<strong>${escapeHtml(who)}</strong> synced report ${escapeHtml(d.serial_no || '')}`;
        case 'USER_CREATED': return `<strong>${escapeHtml(who)}</strong> created user "${escapeHtml(d.new_user || '')}"`;
        case 'USER_DELETED': return `<strong>${escapeHtml(who)}</strong> deleted user "${escapeHtml(d.deleted_user || '')}"`;
        case 'USER_TOGGLED': return `<strong>${escapeHtml(who)}</strong> ${d.new_status === 'enabled' ? 'enabled' : 'disabled'} "${escapeHtml(d.target_user || '')}"`;
        default: return `<strong>${escapeHtml(who)}</strong> — ${escapeHtml(a.action)}`;
    }
}

async function loadActivity(fullPage = false) {
    try {
        const { activities } = await api('/admin/activity?limit=50');
        const container = fullPage ? $('activity-list-full') : $('activity-feed');
        if (!container) return;

        if (activities.length === 0) {
            container.innerHTML = `<p class="text-center py-8 text-gray-400 text-sm">No activity yet.</p>`;
            return;
        }

        const list = fullPage ? activities : activities.slice(0, 10);
        container.innerHTML = list.map(a => {
            const meta = ACTION_ICONS[a.action] || { icon: '📌', color: 'bg-gray-100 text-gray-600' };
            return `
                <div class="activity-item">
                    <div class="activity-icon ${meta.color}">${meta.icon}</div>
                    <div class="activity-content">
                        <div class="activity-text">${formatActivityText(a)}</div>
                        <div class="activity-time">${fmtTimeAgo(a.created_at)}</div>
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) { console.error('Activity error:', err); }
}

// ============================================================
// REPORTS LIST
// ============================================================
async function loadReports() {
    const tbody = $('reports-tbody');
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400">Loading…</td></tr>`;

    const params = new URLSearchParams({
        limit: currentLimit, offset: currentPage * currentLimit
    });
    const search = $('filter-search')?.value.trim();
    const startDate = $('filter-start')?.value;
    const endDate = $('filter-end')?.value;
    const nature = $('filter-nature')?.value;
    if (search) params.append('search', search);
    if (startDate) params.append('startDate', startDate);
    if (endDate) params.append('endDate', endDate);
    if (nature) params.append('nature', nature);

    try {
        const data = await api(`/admin/reports?${params.toString()}`);
        totalReports = data.total;
        $('report-count').textContent = `${totalReports} report(s) found`;
        $('page-info').textContent = `Showing ${data.offset + 1}–${Math.min(data.offset + currentLimit, totalReports)} of ${totalReports}`;
        $('btn-prev').disabled = currentPage === 0;
        $('btn-next').disabled = data.offset + currentLimit >= totalReports;

        if (data.reports.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400">No reports found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.reports.map(r => `
            <tr>
                <td class="font-mono text-xs">${escapeHtml(r.serial_no || '—')}</td>
                <td>
                    <div class="font-semibold">${escapeHtml(r.patient_name || '—')}</div>
                    <div class="text-xs text-gray-500">${escapeHtml(r.patient_age || '')} ${escapeHtml(r.patient_gender || '')}</div>
                </td>
                <td>
                    <span class="badge ${r.type_of_emergency === 'Trauma' ? 'badge-inactive' : 'badge-volunteer'}">
                        ${escapeHtml(r.type_of_emergency || r.nature_of_call || '—')}
                    </span>
                </td>
                <td class="text-xs">${escapeHtml(r.location || '—')}</td>
                <td class="text-xs">${escapeHtml(r.provider_name || '—')}</td>
                <td class="text-xs whitespace-nowrap">${fmtDate(r.created_at)}</td>
                <td class="text-right whitespace-nowrap">
                    <button onclick="openReport(${r.id})" class="text-red-700 hover:underline font-semibold text-xs">View</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-red-500">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function clearFilters() {
    $('filter-search').value = '';
    $('filter-start').value = '';
    $('filter-end').value = '';
    $('filter-nature').value = '';
    currentPage = 0;
    loadReports();
}

function prevPage() { if (currentPage > 0) { currentPage--; loadReports(); } }
function nextPage() {
    if ((currentPage + 1) * currentLimit < totalReports) { currentPage++; loadReports(); }
}

function exportReportsCSV() {
    const rows = document.querySelectorAll('#reports-tbody tr');
    if (!rows.length) return alert('Nothing to export.');
    let csv = 'Serial No,Patient,Type,Location,Provider,Date\n';
    rows.forEach(tr => {
        const cells = tr.querySelectorAll('td');
        if (cells.length < 6) return;
        const clean = (txt) => `"${(txt || '').replace(/"/g, '""').trim()}"`;
        csv += [
            clean(cells[0].textContent),
            clean(cells[1].textContent.split('\n')[0]),
            clean(cells[2].textContent),
            clean(cells[3].textContent),
            clean(cells[4].textContent),
            clean(cells[5].textContent)
        ].join(',') + '\n';
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PPCR_Reports_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('✅ CSV exported');
}

// ============================================================
// REPORT MODAL
// ============================================================
async function openReport(id) {
    $('report-modal').classList.remove('hidden');
    $('modal-body').innerHTML = `
        <div class="text-center py-12">
            <div class="inline-block w-10 h-10 border-4 border-red-200 border-t-red-600 rounded-full animate-spin"></div>
            <p class="mt-3 text-sm text-gray-500">Loading full report…</p>
        </div>
    `;

    try {
        const { report } = await api(`/admin/reports/${id}`);
        currentReport = report;
        $('modal-title').textContent = `PPCR Report — ${report.serial_no || '#' + report.id}`;
        $('modal-body').innerHTML = renderFullReport(report);
    } catch (err) {
        $('modal-body').innerHTML = `<p class="text-red-600 p-4">Error: ${escapeHtml(err.message)}</p>`;
    }
}

// ============================================================
// FULL REPORT RENDERER
// ============================================================
function renderFullReport(r) {
    const inc = r.incident_data || {};
    const pat = r.patient_data || {};
    const ps = r.primary_survey || {};
    const vs = r.vital_signs || {};
    const cm = r.care_management || {};
    const pa = r.patient_assessment || {};
    const sample = r.sample_history || {};
    const ni = r.nature_illness || {};
    const mech = r.mechanism || {};
    const narr = r.narrative || {};
    const cess = r.cessation || {};
    const prov = r.provider_info || {};
    const cmList = cm.checked || [];
    const niList = ni.checked || [];
    const mechList = mech.checked || [];
    const examList = pa.exam_findings || [];
    const injuredParts = pa.injured_parts || [];

    const header = `
        <div class="rpt-header">
            <div class="rpt-header-left">
                <div class="rpt-logo">+</div>
                <div>
                    <div class="rpt-org">PHILIPPINE RED CROSS</div>
                    <div class="rpt-org-sub">National Headquarters, Bonifacio Drive, Port Area, Manila</div>
                </div>
            </div>
            <div class="rpt-header-right">
                <div class="rpt-title">PRE HOSPITAL PATIENT CARE REPORT (PPCR)</div>
                <div class="rpt-serial">Serial No: <strong>${escapeHtml(r.serial_no || '—')}</strong></div>
            </div>
        </div>
    `;

    const S = (num, title, color, body) => `
        <div class="rpt-section">
            <div class="rpt-section-title" style="background:${color};">${num ? num + '. ' : ''}${title}</div>
            <div class="rpt-section-body">${body}</div>
        </div>
    `;

    const grid = (cols, body) => `<div class="rpt-grid rpt-grid-${cols}">${body}</div>`;

    const section1 = S(1, 'INCIDENT INFORMATION', '#dc2626', `
        ${grid(3,
            fieldLine('Nature of Call', inc.nature_of_call) +
            fieldLine('Type of Emergency', inc.type_of_emergency) +
            fieldLine('Date/Time', `${inc.call_date || ''} ${inc.call_time || ''}`)
        )}
        ${grid(3,
            fieldLine('Location', inc.location) +
            fieldLine('Mobile', inc.mobile) +
            fieldLine('Station Code', inc.station_code)
        )}
        ${grid(3,
            fieldLine('At Scene', inc.at_scene) +
            fieldLine('At Patient', inc.at_patient) +
            fieldLine('Depart Scene', inc.depart_scene)
        )}
        ${grid(3,
            fieldLine('At Arrival', inc.at_arrival) +
            fieldLine('At Handover', inc.at_handover) +
            fieldLine('Clear', inc.clear_time)
        )}
        ${grid(3,
            fieldLine('Ambulance Unit', inc.ambulance_unit) +
            fieldLine('Response Area', inc.response_area) +
            fieldLine('Facility Type', inc.facility_type)
        )}
    `);

    const section2 = S(2, 'PATIENT INFORMATION', '#2563eb', `
        ${grid(3,
            fieldLine('Patient Name', pat.name) +
            fieldLine('Age', pat.age) +
            fieldLine('Gender', pat.gender)
        )}
        ${grid(3,
            fieldLine('Address', pat.address) +
            fieldLine('Contact No.', pat.contact) +
            fieldLine('Time/Date of Onset', `${pat.time_onset || ''} ${pat.date_onset || ''}`)
        )}
        ${grid(2,
            fieldLine('Next of Kin (NOK)', pat.nok) +
            fieldLine('NOK Contact No.', pat.nok_contact)
        )}
        <div class="rpt-inline-check">
            ${cb(pat.treatment_refused, 'Treatment Refused')} &nbsp;&nbsp;
            ${cb(pat.transport_refused, 'Transport Refused')} &nbsp;&nbsp;
            ${cb(pat.treat_scene, 'Treat at Scene')} &nbsp;&nbsp;
            ${cb(pat.stood_down, 'Stood Down')}
        </div>
    `);

    const section3 = S(3, 'PRIMARY SURVEY', '#ea580c', `
        ${grid(2,
            `<div>${cb(ps.cspine === 'Suspected', 'Suspected')} ${cb(ps.cspine === 'Not Indicated', 'Not Indicated')}</div>
             <div class="rpt-label-inline">C-Spine</div>`
        )}
        ${grid(2,
            `<div>${cb(ps.airway === 'Clear', 'Clear')} ${cb(ps.airway === 'Partially Obstructed', 'Partially Obstructed')} ${cb(ps.airway === 'Obstructed', 'Obstructed')}</div>
             <div class="rpt-label-inline">Airway</div>`
        )}
        ${grid(2,
            `<div>${cb(ps.breathing === 'Normal', 'Normal')} ${cb(ps.breathing === 'Fast', 'Fast')} ${cb(ps.breathing === 'Slow', 'Slow')} ${cb(ps.breathing === 'Absent', 'Absent')}</div>
             <div class="rpt-label-inline">Breathing</div>`
        )}
        ${grid(2,
            `<div>${cb(ps.pulse === 'Present', 'Present')} ${cb(ps.pulse === 'Absent', 'Absent')} ${cb(ps.pulse === 'Haemorrhage', 'Haemorrhage')}</div>
             <div class="rpt-label-inline">Pulse</div>`
        )}
        ${grid(2,
            `<div>${cb(ps.skin === 'Normal', 'Normal')} ${cb(ps.skin === 'Pale', 'Pale')} ${cb(ps.skin === 'Flushed', 'Flushed')} ${cb(ps.skin === 'Cyanosed', 'Cyanosed')}</div>
             <div class="rpt-label-inline">Skin</div>`
        )}
        ${grid(2,
            `<div>${cb(ps.caprefill === '< 2 SEC', '< 2 SEC')} ${cb(ps.caprefill === '> 2 SEC', '> 2 SEC')}</div>
             <div class="rpt-label-inline">Cap-Refill</div>`
        )}
    `);

    const vitalRows = [
        ['Pulse Rate & Rhythm', vs.pulse_1, vs.pulse_2, vs.pulse_3],
        ['Respiratory Rate', vs.rr_1, vs.rr_2, vs.rr_3],
        ['Respiratory Quality', vs.rq_1, vs.rq_2, vs.rq_3],
        ['SpO2', vs.spo2_1, vs.spo2_2, vs.spo2_3],
        ['Blood Pressure', vs.bp_1, vs.bp_2, vs.bp_3],
        ['Temperature', vs.temp_1, vs.temp_2, vs.temp_3],
        ['Pupils', vs.pupils_1, vs.pupils_2, vs.pupils_3],
        ['Pain Score', vs.pain_1, vs.pain_2, vs.pain_3],
        ['Blood Glucose', vs.bg_1, vs.bg_2, vs.bg_3],
    ];

    const vitalTable = `
        <table class="rpt-vitals-table">
            <thead>
                <tr>
                    <th style="text-align:left;">Observation</th>
                    <th>Time (1)</th>
                    <th>Time (2)</th>
                    <th>Time (3)</th>
                </tr>
            </thead>
            <tbody>
                ${vitalRows.map(row => `
                    <tr>
                        <td style="font-weight:600;">${row[0]}</td>
                        <td>${escapeHtml(row[1] || '—')}</td>
                        <td>${escapeHtml(row[2] || '—')}</td>
                        <td>${escapeHtml(row[3] || '—')}</td>
                    </tr>
                `).join('')}
                <tr>
                    <td style="font-weight:600;">GCS (E/V/M/Total)</td>
                    <td colspan="3">
                        Eye: <strong>${escapeHtml(vs.gcs_eye || '—')}</strong> &nbsp;|&nbsp;
                        Verbal: <strong>${escapeHtml(vs.gcs_verbal || '—')}</strong> &nbsp;|&nbsp;
                        Motor: <strong>${escapeHtml(vs.gcs_motor || '—')}</strong> &nbsp;|&nbsp;
                        Total: <strong class="text-red-600">${escapeHtml(vs.gcs_total || '—')}</strong>
                    </td>
                </tr>
            </tbody>
        </table>
    `;

    const section4 = S(4, 'VITAL SIGNS', '#059669', vitalTable);

    const careGroup = (title, items) => `
        <div class="rpt-care-group">
            <div class="rpt-care-title">${title}</div>
            ${items.map(i => `<div>${cb(cmList.includes(i), i)}</div>`).join('')}
        </div>
    `;

    const section5 = S(5, 'CARE MANAGEMENT', '#7c3aed', `
        <div class="rpt-care-grid">
            ${careGroup('Airway', ['Manoeuvre', 'Suction', 'Manual FB Clearance', 'OPA / NPA'])}
            ${careGroup('Breathing', ['Pocket Mask', 'BVM', 'Simple Facemask', 'NRB Mask', 'Nasal Cannula', 'SAO2 Monitoring'])}
            ${careGroup('Circulation Support', ['Chest Compression', 'Defibrillation', 'Haemorrhage Control'])}
            ${careGroup('Immobilization / Extrication', ['Cervical Collar', 'Spinal Board', 'Rigid Splint', 'Traction Splint', 'SAM Splint', 'KED/Half Board'])}
            ${careGroup('Wound Care', ['Minor Injury TX', 'Bleeding Control', 'Cleaning/Disinfecting', 'Dressing'])}
            ${careGroup('Miscellaneous', ['Cold/Warm Compress', 'Positioning'])}
        </div>
    `);

    const bodyPartLabels = ['Head', 'Neck', 'Chest', 'Abdomen', 'Pelvis', 'Left Arm', 'Right Arm', 'Left Leg', 'Right Leg'];
    const bodySvg = `
        <svg viewBox="0 0 200 400" class="rpt-body-svg">
            ${bodyPartLabels.map(p => {
                const isActive = injuredParts.includes(p);
                const fill = isActive ? '#dc2626' : '#e5e7eb';
                const map = {
                    'Head': `<circle cx="100" cy="40" r="25" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Neck': `<rect x="90" y="65" width="20" height="15" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Chest': `<rect x="60" y="80" width="80" height="60" rx="5" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Abdomen': `<rect x="65" y="140" width="70" height="50" rx="5" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Pelvis': `<rect x="70" y="190" width="60" height="30" rx="5" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Left Arm': `<rect x="25" y="80" width="30" height="100" rx="10" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Right Arm': `<rect x="145" y="80" width="30" height="100" rx="10" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Left Leg': `<rect x="70" y="220" width="25" height="120" rx="8" fill="${fill}" stroke="#666" stroke-width="1.5"/>`,
                    'Right Leg': `<rect x="105" y="220" width="25" height="120" rx="8" fill="${fill}" stroke="#666" stroke-width="1.5"/>`
                };
                return map[p] || '';
            }).join('')}
        </svg>
    `;

    const examItems = ['B Burn', 'C Contusion', 'D Dislocation', 'F Fracture', 'N Numbness', 'P Pain', 'R Rash', 'S Swelling', 'W Wound'];

    const section6 = S(6, 'PATIENT ASSESSMENT & SECONDARY SURVEY', '#0d9488', `
        ${grid(2,
            `<div>${cb(pa.loc_loss === 'Yes', 'Yes')} ${cb(pa.loc_loss === 'No', 'No')}</div>
             <div class="rpt-label-inline">LOC Loss before Arrival</div>`
        )}
        ${grid(2,
            `<div>${cb(pa.loc_arrival === 'Alert', 'Alert')} ${cb(pa.loc_arrival === 'Verbal Response', 'Verbal')} ${cb(pa.loc_arrival === 'Painful Stimuli', 'Painful')} ${cb(pa.loc_arrival === 'Unresponsiveness', 'Unresponsive')}</div>
             <div class="rpt-label-inline">Consciousness upon Arrival</div>`
        )}
        ${grid(2,
            `<div>${cb(pa.burn_class === 'Critical', 'Critical')} ${cb(pa.burn_class === 'Moderate', 'Moderate')} ${cb(pa.burn_class === 'Minor', 'Minor')}</div>
             <div class="rpt-label-inline">Burn Classification</div>`
        )}
        ${grid(2,
            `<div><strong>${escapeHtml(pa.burn_percent || '—')}</strong></div>
             <div class="rpt-label-inline">Burn %</div>`
        )}

        <div class="rpt-grid rpt-grid-2" style="margin-top:10px;">
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Physical Exam Findings</div>
                <div class="rpt-exam-grid">
                    ${examItems.map(i => `<div>${cb(examList.includes(i), i)}</div>`).join('')}
                </div>
                <div class="rpt-care-title" style="margin-top:10px; margin-bottom:6px;">Injured Body Parts</div>
                <div style="font-size:12px; color:#374151;">${injuredParts.length ? injuredParts.map(p => `<span class="rpt-badge">${escapeHtml(p)}</span>`).join(' ') : '<em>None marked</em>'}</div>
            </div>
            <div style="text-align:center;">
                <div class="rpt-care-title" style="margin-bottom:6px;">Injured Body Map</div>
                ${bodySvg}
                <div style="font-size:10px; color:#6b7280; margin-top:4px;">🔴 Red = Injured</div>
            </div>
        </div>

        <div class="rpt-sample">
            <div class="rpt-care-title" style="margin-bottom:6px;">SAMPLE History</div>
            <div style="font-size:12px; line-height:1.8;">
                <div><strong>S</strong> — Signs & Symptoms: ${escapeHtml(sample.s || '—')}</div>
                <div><strong>A</strong> — Allergies: ${escapeHtml(sample.a || '—')}</div>
                <div><strong>M</strong> — Medications: ${escapeHtml(sample.m || '—')}</div>
                <div><strong>P</strong> — Past Medical History: ${escapeHtml(sample.p || '—')}</div>
                <div><strong>L</strong> — Last Intake: ${escapeHtml(sample.l || '—')}</div>
                <div><strong>E</strong> — Event: ${escapeHtml(sample.e || '—')}</div>
            </div>
        </div>
    `);

    const natureItems = ['Cardiac', 'Neurological', 'OB/Gynae', 'Respiratory', 'Trauma', 'Medical', 'General'];
    const mechItems = ['Assault', 'Attack/Bite', 'Chemical Poisoning', 'Drowning', 'Electrocution', 'Excessive Heat', 'Fall', 'Firearm Injury', 'KTA Bicycle', 'KTA Motorbike', 'KTA Pedestrian', 'KTA Vehicle', 'Water/Transport', 'Injury to Child', 'Machinery'];

    const section7 = S(7, 'NATURE OF ILLNESS & MECHANISM OF INJURY', '#d97706', `
        <div class="rpt-grid rpt-grid-2">
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Nature of Illness</div>
                <div class="rpt-exam-grid" style="grid-template-columns:1fr 1fr;">
                    ${natureItems.map(i => `<div>${cb(niList.includes(i), i)}</div>`).join('')}
                </div>
            </div>
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Mechanism of Injury</div>
                <div class="rpt-exam-grid" style="grid-template-columns:1fr 1fr;">
                    ${mechItems.map(i => `<div>${cb(mechList.includes(i), i)}</div>`).join('')}
                    ${mech.other ? `<div>${cb(true, 'Others: ' + mech.other)}</div>` : ''}
                </div>
            </div>
        </div>
    `);

    const deathItems = ['Decomposition', 'Rigor Mortis', 'Incineration', 'Decapitation', 'Pooling', 'Incompatible with life'];
    const deathList = narr.death_indicators || [];

    const section8 = S(8, 'NARRATIVE & SPECIAL CIRCUMSTANCES', '#4f46e5', `
        <div style="margin-bottom:10px;">
            <div class="rpt-care-title" style="margin-bottom:4px;">Narrative Notes</div>
            <div style="font-size:12px; background:#f9fafb; padding:8px; border-radius:6px; white-space:pre-wrap; min-height:40px;">
                ${escapeHtml(narr.notes || '—')}
            </div>
        </div>

        <div class="rpt-grid rpt-grid-2">
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Recognition of Death</div>
                <div class="rpt-exam-grid" style="grid-template-columns:1fr 1fr;">
                    ${deathItems.map(i => `<div>${cb(deathList.includes(i), i)}</div>`).join('')}
                </div>
                <div style="margin-top:6px; font-size:11px;">
                    <strong>Specify Nature:</strong> ${escapeHtml(narr.death_nature || '—')}
                </div>
            </div>
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Cessation of Resuscitation</div>
                <div style="font-size:11px; line-height:1.7;">
                    <div><strong>Coronary Disease:</strong> ${escapeHtml(cess.coronary || '—')}</div>
                    <div><strong>Collapse Witnessed:</strong> ${escapeHtml(cess.collapse || '—')}</div>
                    <div><strong>Time of Collapse:</strong> ${escapeHtml(cess.time_collapse || '—')}</div>
                    <div><strong>Time of Chest Pain:</strong> ${escapeHtml(cess.time_chestpain || '—')}</div>
                    <div><strong>Time CPR Commenced:</strong> ${escapeHtml(cess.time_cpr || '—')}</div>
                    <div><strong>Time First Analysis:</strong> ${escapeHtml(cess.time_analysis || '—')}</div>
                    <div><strong>Defibrillation:</strong> ${escapeHtml(cess.time_defib || '—')}</div>
                    <div><strong>Duration of CPR:</strong> ${escapeHtml(cess.time_duration || '—')}</div>
                    <div><strong>Spontaneous Pulse:</strong> ${escapeHtml(cess.time_pulse || '—')}</div>
                    <div><strong>Transferred To:</strong> ${escapeHtml(cess.time_transferred || '—')}</div>
                    <div><strong>Hospital CPR in Progress:</strong> ${escapeHtml(cess.time_hospital_cpr || '—')}</div>
                </div>
            </div>
        </div>

        <div style="margin-top:12px; border-top:1px solid #e5e7eb; padding-top:10px;">
            <div class="rpt-care-title" style="margin-bottom:4px;">Refusal of Treatment and/or Transport</div>
            <div style="font-size:10px; color:#6b7280; font-style:italic; margin-bottom:8px;">
                "I, the undersigned have been advised that the medical assistance on my behalf is necessary and that refusal of said medical assistance and/or transportation for further treatment may result in death, or impair my health condition. Nevertheless, I refuse to accept treatment and/or transport and assume all risk and consequences of my decision and release the PNRC Safety services Ambulance Crew from any liability arising from my refusal."
            </div>
            <div class="rpt-grid rpt-grid-2">
                ${fieldLine('Patient Name & Signature', r.refusal?.patient_sig)}
                ${fieldLine('Witness', r.refusal?.witness1)}
                ${fieldLine('Date Signed', r.refusal?.date_signed)}
                ${fieldLine('Witness', r.refusal?.witness2)}
            </div>
        </div>
    `);

    const section9 = S(9, 'PROVIDER INFORMATION', '#475569', `
        <div class="rpt-grid rpt-grid-2">
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Provider Information</div>
                ${fieldLine('Name', prov.name)}
                ${fieldLine('License No.', prov.license)}
                ${fieldLine('Signature', prov.signature_name)}
                ${fieldLine('Date/Time', prov.datetime)}
            </div>
            <div>
                <div class="rpt-care-title" style="margin-bottom:6px;">Receiving Provider</div>
                ${fieldLine('Name', prov.receiving_name)}
                ${fieldLine('License No.', prov.receiving_license)}
                ${fieldLine('Signature', prov.receiving_signature_name)}
                ${fieldLine('Date/Time', prov.receiving_datetime)}
            </div>
        </div>
    `);

    const section10 = r.additional_info ? S('', 'ADDITIONAL INFORMATION', '#e11d48', `
        <div style="font-size:12px; white-space:pre-wrap;">${escapeHtml(r.additional_info)}</div>
    `) : '';

    const sigs = [];
    if (r.signature_patient) sigs.push({ label: 'Patient', src: r.signature_patient });
    if (r.signature_provider) sigs.push({ label: 'Provider', src: r.signature_provider });
    if (r.signature_receiving) sigs.push({ label: 'Receiving Provider', src: r.signature_receiving });

    const sigSection = sigs.length ? `
        <div class="rpt-section">
            <div class="rpt-section-title" style="background:#6b7280;">DIGITAL SIGNATURES</div>
            <div class="rpt-section-body">
                <div style="display:flex; gap:20px; flex-wrap:wrap; justify-content:space-around;">
                    ${sigs.map(s => `
                        <div style="text-align:center; min-width:150px;">
                            <div style="font-size:11px; color:#6b7280; margin-bottom:4px;">${escapeHtml(s.label)}</div>
                            <img src="${s.src}" style="border:1px solid #d1d5db; border-radius:6px; background:white; max-height:100px; max-width:180px;">
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>
    ` : '';

    const footer = `
        <div class="rpt-footer">
            PPCR | Generated: ${new Date().toLocaleString()} | Report ID: ${r.id}
        </div>
    `;

    return header + section1 + section2 + section3 + section4 + section5 + section6 + section7 + section8 + section9 + section10 + sigSection + footer;
}

function closeReportModal() {
    $('report-modal').classList.add('hidden');
    currentReport = null;
}

function printReport() { window.print(); }

async function deleteReport() {
    if (!currentReport) return;
    if (!confirm(`Delete report ${currentReport.serial_no || currentReport.id}?`)) return;
    try {
        await api(`/admin/reports/${currentReport.id}`, { method: 'DELETE' });
        toast('✅ Report deleted');
        closeReportModal();
        loadReports();
        loadStats();
    } catch (err) { alert('Delete failed: ' + err.message); }
}

function exportSinglePDF() {
    if (!currentReport) return;
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF('p', 'mm', 'a4');
    const r = currentReport;

    let y = 10;
    const pageW = 210;
    const margin = 10;

    doc.setFillColor(220, 38, 38);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(13);
    doc.setFont(undefined, 'bold');
    doc.text('PHILIPPINE RED CROSS', margin, 8);
    doc.setFontSize(7);
    doc.setFont(undefined, 'normal');
    doc.text('National Headquarters, Bonifacio Drive, Port Area, Manila', margin, 12);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.text('PRE HOSPITAL PATIENT CARE REPORT (PPCR)', pageW - margin, 8, { align: 'right' });
    doc.text(`Serial: ${r.serial_no || '—'}`, pageW - margin, 13, { align: 'right' });
    y = 25;
    doc.setTextColor(0, 0, 0);

    const writeSection = (title, color, fields) => {
        if (y > 270) { doc.addPage(); y = 15; }
        doc.setFillColor(...color);
        doc.rect(margin, y, pageW - margin * 2, 6, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(9);
        doc.setFont(undefined, 'bold');
        doc.text(title, margin + 2, y + 4.5);
        doc.setTextColor(0, 0, 0);
        doc.setFont(undefined, 'normal');
        y += 8;
        fields.forEach(([label, value]) => {
            if (y > 280) { doc.addPage(); y = 15; }
            doc.setFontSize(7);
            doc.setTextColor(120, 120, 120);
            doc.text(label + ':', margin, y);
            doc.setFontSize(8);
            doc.setTextColor(0, 0, 0);
            const val = String(value || '—');
            const lines = doc.splitTextToSize(val, pageW - margin * 2 - 60);
            doc.text(lines, margin + 60, y);
            y += Math.max(4, lines.length * 3.5);
        });
        y += 2;
    };

    const inc = r.incident_data || {};
    writeSection('1. INCIDENT INFORMATION', [220, 38, 38], [
        ['Nature of Call', inc.nature_of_call],
        ['Type of Emergency', inc.type_of_emergency],
        ['Date/Time', `${inc.call_date || ''} ${inc.call_time || ''}`],
        ['Location', inc.location],
        ['Mobile', inc.mobile],
        ['Station Code', inc.station_code],
        ['Ambulance Unit', inc.ambulance_unit],
        ['Response Area', inc.response_area],
    ]);

    const pat = r.patient_data || {};
    writeSection('2. PATIENT INFORMATION', [37, 99, 235], [
        ['Patient Name', pat.name],
        ['Age / Gender', `${pat.age || '—'} / ${pat.gender || '—'}`],
        ['Contact', pat.contact],
        ['Address', pat.address],
        ['NOK', pat.nok],
        ['NOK Contact', pat.nok_contact],
    ]);

    const pages = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setFontSize(7);
        doc.setTextColor(150);
        doc.text(`PPCR | ${new Date().toLocaleString()} | Page ${i} of ${pages}`, pageW / 2, 290, { align: 'center' });
    }

    doc.save(`PPCR_${r.serial_no || r.id}.pdf`);
}

// ============================================================
// USERS
// ============================================================
async function loadUsers() {
    const tbody = $('users-tbody');
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">Loading…</td></tr>`;
    try {
        const { users } = await api('/admin/users');
        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-gray-400">No users found.</td></tr>`;
            return;
        }
        const me = getUser();
        tbody.innerHTML = users.map(u => `
            <tr>
                <td class="font-mono text-xs">${escapeHtml(u.username)}</td>
                <td>${escapeHtml(u.full_name || '—')}</td>
                <td class="text-xs">${escapeHtml(u.license_no || '—')}</td>
                <td><span class="badge badge-${u.role}">${u.role}</span></td>
                <td><span class="badge ${u.is_active ? 'badge-active' : 'badge-inactive'}">${u.is_active ? 'Active' : 'Disabled'}</span></td>
                <td class="text-xs">${u.last_login ? fmtDate(u.last_login) : '—'}</td>
                <td class="text-xs">${fmtDate(u.created_at)}</td>
                <td class="text-right whitespace-nowrap">
                    ${me && me.id === u.id ? '<span class="text-xs text-gray-400">(you)</span>' : `
                        <button onclick="toggleUser(${u.id})" class="text-blue-600 hover:underline text-xs mr-2">
                            ${u.is_active ? 'Disable' : 'Enable'}
                        </button>
                        <button onclick="deleteUser(${u.id}, '${escapeHtml(u.username)}')" class="text-red-600 hover:underline text-xs">Delete</button>
                    `}
                </td>
            </tr>
        `).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-red-500">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
}

async function toggleUser(id) {
    try {
        await api(`/admin/users/${id}/toggle`, { method: 'PATCH' });
        toast('✅ User updated'); loadUsers();
    } catch (err) { alert('Failed: ' + err.message); }
}

async function deleteUser(id, username) {
    if (!confirm(`Delete user "${username}"?`)) return;
    try {
        await api(`/admin/users/${id}`, { method: 'DELETE' });
        toast('✅ User deleted'); loadUsers();
    } catch (err) { alert('Failed: ' + err.message); }
}

function openUserModal() {
    $('user-modal').classList.remove('hidden');
    $('user-form').reset();
    $('user-form-error').classList.add('hidden');
}

function closeUserModal() { $('user-modal').classList.add('hidden'); }

$('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = $('user-form-error');
    errBox.classList.add('hidden');
    const body = {
        username: $('new-username').value.trim(),
        password: $('new-password').value,
        full_name: $('new-fullname').value.trim(),
        license_no: $('new-license').value.trim(),
        role: $('new-role').value
    };
    try {
        await api('/admin/users', { method: 'POST', body: JSON.stringify(body) });
        toast('✅ User created');
        closeUserModal();
        loadUsers();
    } catch (err) {
        errBox.textContent = err.message;
        errBox.classList.remove('hidden');
    }
});

// ============================================================
// AUDIT LOGS
// ============================================================
async function loadAuditLogs() {
    const tbody = $('audit-tbody');
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">Loading…</td></tr>`;
    const params = new URLSearchParams({ limit: auditLimit, offset: auditPage * auditLimit });
    const search = $('audit-search')?.value.trim();
    const action = $('audit-action')?.value;
    if (search) params.append('search', search);
    if (action) params.append('action', action);

    try {
        const data = await api(`/admin/audit-logs?${params.toString()}`);
        auditTotal = data.total;
        $('audit-page-info').textContent = `Showing ${data.offset + 1}–${Math.min(data.offset + auditLimit, auditTotal)} of ${auditTotal}`;
        $('audit-prev').disabled = auditPage === 0;
        $('audit-next').disabled = data.offset + auditLimit >= auditTotal;

        if (data.logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-gray-400">No logs found.</td></tr>`;
            return;
        }

        tbody.innerHTML = data.logs.map(l => {
            const meta = ACTION_ICONS[l.action] || { icon: '📌' };
            return `
                <tr>
                    <td class="text-xs whitespace-nowrap">${fmtDate(l.created_at)}</td>
                    <td>
                        <div class="font-semibold text-xs">${escapeHtml(l.full_name || l.username || '—')}</div>
                        <div class="text-[10px] text-gray-500">${escapeHtml(l.role || '')}</div>
                    </td>
                    <td><span class="badge badge-volunteer">${meta.icon} ${escapeHtml(l.action)}</span></td>
                    <td class="text-xs">${escapeHtml(JSON.stringify(l.details || {}).substring(0, 80))}</td>
                    <td class="text-xs text-gray-500">${escapeHtml(l.ip_address || '—')}</td>
                </tr>
            `;
        }).join('');
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-red-500">Error: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function auditPrevPage() { if (auditPage > 0) { auditPage--; loadAuditLogs(); } }
function auditNextPage() { if ((auditPage + 1) * auditLimit < auditTotal) { auditPage++; loadAuditLogs(); } }

// ============================================================
// SETTINGS
// ============================================================
function saveApiUrl() {
    const url = $('setting-api-url').value.trim();
    if (!url) return;
    API_URL = url;
    localStorage.setItem('ppcr_admin_api', url);
    toast('✅ API URL saved');
}

// ============================================================
// INIT
// ============================================================
window.addEventListener('load', () => {
    if (getToken()) showDashboard();
});

document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && getToken()) {
        startAutoRefresh();
    } else {
        stopAutoRefresh();
    }
});

// Expose
window.quickLogin = quickLogin;
window.switchTab = switchTab;
window.toggleSidebar = toggleSidebar;
window.refreshAll = refreshAll;
window.loadStats = loadStats;
window.loadDailyChart = loadDailyChart;
window.loadProvidersChart = loadProvidersChart;
window.loadReports = loadReports;
window.clearFilters = clearFilters;
window.prevPage = prevPage;
window.nextPage = nextPage;
window.exportReportsCSV = exportReportsCSV;
window.openReport = openReport;
window.closeReportModal = closeReportModal;
window.printReport = printReport;
window.exportSinglePDF = exportSinglePDF;
window.deleteReport = deleteReport;
window.toggleUser = toggleUser;
window.deleteUser = deleteUser;
window.openUserModal = openUserModal;
window.closeUserModal = closeUserModal;
window.loadActivity = loadActivity;
window.loadAuditLogs = loadAuditLogs;
window.auditPrevPage = auditPrevPage;
window.auditNextPage = auditNextPage;
window.saveApiUrl = saveApiUrl;
window.logout = logout;
window.logoutAll = logoutAll;
window.startAutoRefresh = startAutoRefresh;
window.stopAutoRefresh = stopAutoRefresh;