/**
 * Login de la página de geozonas (geo.apptu.net).
 * Sesión en memoria con cookie httpOnly; vence tras SESSION_TTL_MS sin actividad.
 * Usuario y clave salen de GEO_USER y GEO_PASS (.env).
 */
const crypto = require('crypto');

const COOKIE_NAME = 'geo_session';
// El navegador cierra a los 5 min de inactividad; el servidor da un margen extra
const SESSION_TTL_MS = 7 * 60 * 1000;
const MAX_FAILED = 5;
const FAILED_WINDOW_MS = 10 * 60 * 1000;

const sessions = new Map();   // token -> última actividad
const failedByIp = new Map(); // ip -> { count, since }

function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function parseCookies(req) {
    const out = {};
    String(req.headers.cookie || '').split(';').forEach(part => {
        const i = part.indexOf('=');
        if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    });
    return out;
}

function clientIp(req) {
    return req.headers['x-real-ip'] || req.ip || 'unknown';
}

function purgeExpired() {
    const now = Date.now();
    for (const [token, last] of sessions) {
        if (now - last > SESSION_TTL_MS) sessions.delete(token);
    }
}

function setCookie(res, token, maxAgeMs) {
    res.append('Set-Cookie',
        `${COOKIE_NAME}=${token}; Max-Age=${Math.floor(maxAgeMs / 1000)}; Path=/; HttpOnly; Secure; SameSite=Strict`);
}

// Devuelve el token si la sesión es válida (y renueva su actividad)
function touch(req) {
    purgeExpired();
    const token = parseCookies(req)[COOKIE_NAME];
    if (!token || !sessions.has(token)) return null;
    sessions.set(token, Date.now());
    return token;
}

function requireAuth(req, res, next) {
    if (!touch(req)) return res.status(401).json({ error: 'Sesión no iniciada o vencida' });
    next();
}

function login(req, res) {
    const user = process.env.GEO_USER;
    const pass = process.env.GEO_PASS;
    if (!user || !pass) return res.status(503).json({ error: 'Login no configurado en el servidor' });

    const ip = clientIp(req);
    const now = Date.now();
    const failed = failedByIp.get(ip);
    if (failed && now - failed.since > FAILED_WINDOW_MS) failedByIp.delete(ip);
    const current = failedByIp.get(ip);
    if (current && current.count >= MAX_FAILED) {
        return res.status(429).json({ error: 'Demasiados intentos. Espere 10 minutos.' });
    }

    const { username, password } = req.body || {};
    const ok = safeEqual(username || '', user) & safeEqual(password || '', pass);
    if (!ok) {
        const entry = failedByIp.get(ip) || { count: 0, since: now };
        entry.count++;
        failedByIp.set(ip, entry);
        return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
    }

    failedByIp.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, now);
    setCookie(res, token, SESSION_TTL_MS);
    res.json({ success: true });
}

function logout(req, res) {
    const token = parseCookies(req)[COOKIE_NAME];
    if (token) sessions.delete(token);
    setCookie(res, '', 0);
    res.json({ success: true });
}

// Mantiene viva la sesión mientras haya actividad en la página
function me(req, res) {
    if (!touch(req)) return res.status(401).json({ error: 'Sesión no iniciada o vencida' });
    res.json({ success: true });
}

module.exports = { requireAuth, login, logout, me };
