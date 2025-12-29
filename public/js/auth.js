// ======================== CONFIGURACIÓN Y AUTENTICACIÓN ========================
const CREDENTIALS = { username: 'admin', password: 'guio123*' };
const SESSION_TIMEOUT = 5 * 60 * 1000; // 5 minutos
const SESSION_KEY = 'wpp_dashboard_session';
let sessionTimer = null;
let timerInterval = null;
let timeRemaining = SESSION_TIMEOUT;

function login() {
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const errorEl = document.getElementById('loginError');
    if (username === CREDENTIALS.username && password === CREDENTIALS.password) {
        const sessionData = {
            loggedIn: true,
            expiry: Date.now() + SESSION_TIMEOUT
        };
        localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
        showMainApp();
    } else {
        errorEl.textContent = 'Usuario o contraseña incorrectos';
        errorEl.classList.remove('hidden');
    }
}

function showMainApp() {
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    startSessionTimer();
    loadSessions();
    startRotationUpdates();
}

function logout() {
    clearTimeout(sessionTimer);
    clearInterval(timerInterval);
    stopRotationUpdates();
    localStorage.removeItem(SESSION_KEY);
    document.getElementById('mainApp').classList.add('hidden');
    document.getElementById('loginScreen').classList.remove('hidden');
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
}

function checkSavedSession() {
    const savedSession = localStorage.getItem(SESSION_KEY);
    if (savedSession) {
        const sessionData = JSON.parse(savedSession);
        if (sessionData.loggedIn && sessionData.expiry > Date.now()) {
            timeRemaining = sessionData.expiry - Date.now();
            showMainApp();
            return true;
        }
        localStorage.removeItem(SESSION_KEY);
    }
    return false;
}

function startSessionTimer() {
    clearTimeout(sessionTimer);
    clearInterval(timerInterval);
    timeRemaining = SESSION_TIMEOUT;
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        timeRemaining -= 1000;
        if (timeRemaining <= 0) {
            logout();
            alert('Sesión expirada por inactividad');
        } else {
            updateTimerDisplay();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const minutes = Math.floor(timeRemaining / 60000);
    const seconds = Math.floor((timeRemaining % 60000) / 1000);
    document.getElementById('sessionTimer').textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function resetTimer() {
    const sessionData = { loggedIn: true, expiry: Date.now() + SESSION_TIMEOUT };
    localStorage.setItem(SESSION_KEY, JSON.stringify(sessionData));
    startSessionTimer();
}

// Reiniciar timer con actividad del usuario
document.addEventListener('click', () => {
    if (!document.getElementById('mainApp').classList.contains('hidden')) resetTimer();
});
document.addEventListener('keypress', () => {
    if (!document.getElementById('mainApp').classList.contains('hidden')) resetTimer();
});

// Inicialización
document.addEventListener('DOMContentLoaded', () => {
    checkSavedSession();
    document.getElementById('loginForm').addEventListener('submit', (e) => {
        e.preventDefault();
        login();
    });
});
