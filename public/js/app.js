// ======================== VARIABLES GLOBALES ========================
const API_URL = window.location.origin;
let sessions = [];
let bulkCurrentTab = 'numbers';
let currentRotationSession = null;
let rotationUpdateInterval = null;
let monitorAutoRefresh = true;
let monitorRefreshInterval = null;
let monitorMessages = [];
const MAX_MONITOR_MESSAGES = 50;

// ======================== UTILIDADES ========================
function showToast(message, type = 'info') {
    // Crear toast container si no existe
    let container = document.getElementById('toastContainer');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toastContainer';
        container.className = 'fixed top-4 right-4 z-50 flex flex-col gap-2';
        document.body.appendChild(container);
    }
    
    // Colores según tipo
    const colors = {
        success: 'bg-green-500',
        error: 'bg-red-500',
        warning: 'bg-yellow-500',
        info: 'bg-blue-500'
    };
    
    // Crear toast
    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full`;
    toast.textContent = message;
    container.appendChild(toast);
    
    // Animar entrada
    setTimeout(() => toast.classList.remove('translate-x-full'), 10);
    
    // Auto eliminar después de 3 segundos
    setTimeout(() => {
        toast.classList.add('translate-x-full');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ======================== NAVEGACIÓN ========================
function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.getElementById(`section-${sectionId}`).classList.add('active');
    document.getElementById(`nav-${sectionId}`).classList.add('active');
    const titles = {
        sessions: { title: 'Sesiones de WhatsApp', subtitle: 'Gestiona tus conexiones de WhatsApp' },
        monitor: { title: 'Monitor en Tiempo Real', subtitle: 'Visualiza la actividad de mensajes' },
        search: { title: 'Búsqueda de Mensajes', subtitle: 'Busca mensajes por número y fecha' },
        personal: { title: 'Mensaje Personalizado', subtitle: 'Envía mensajes individuales' },
        bulk: { title: 'Envío Masivo', subtitle: 'Envía mensajes a múltiples destinatarios' },
        analytics: { title: 'Analytics Dashboard', subtitle: 'Estadísticas y métricas de mensajes' },
        settings: { title: 'Configuración', subtitle: 'Ajustes del sistema' }
    };
    
    document.getElementById('sectionTitle').textContent = titles[sectionId].title;
    document.getElementById('sectionSubtitle').textContent = titles[sectionId].subtitle;
    
    if (sectionId === 'monitor') startMonitor();
    else stopMonitor();
    
    if (sectionId === 'analytics') initAnalytics();
    if (sectionId === 'settings') initSettings();
    if (sectionId === 'search') loadPhoneNumbers();
}

// ======================== SESIONES ========================
let networkInfo = { publicIP: 'Cargando...', lastChecked: null };

async function loadSessions() {
    try {
        const response = await fetch(`${API_URL}/api/sessions`);
        const data = await response.json();
        sessions = data.sessions || [];
        if (data.networkInfo) {
            networkInfo = data.networkInfo;
        }
        await updateRotationInfo();
        updateSessionsList();
        populateSessionSelects();
        updateSessionsCount();
        updateNetworkInfo();
    } catch (error) {
        console.error('Error cargando sesiones:', error);
        document.getElementById('sessionsList').innerHTML = `
            <div class="col-span-full bg-red-50 border border-red-200 p-6 rounded-lg text-center">
                <p class="text-red-600">Error al cargar sesiones: ${error.message}</p>
                <button onclick="loadSessions()" class="mt-2 bg-red-500 text-white px-4 py-2 rounded-lg">Reintentar</button>
            </div>`;
    }
}

async function rotateSessionManually() {
    const btn = document.getElementById('rotateBtn');
    const originalText = btn.innerHTML;
    
    try {
        btn.disabled = true;
        btn.innerHTML = '⏳ Rotando...';
        btn.classList.add('opacity-50');
        
        const response = await fetch(`${API_URL}/api/sessions/rotation/rotate`, { method: 'POST' });
        const data = await response.json();
        
        if (response.ok) {
            await updateRotationInfo();
            await loadSessions();
            btn.innerHTML = '✅ Rotado!';
            btn.classList.remove('bg-purple-500');
            btn.classList.add('bg-green-500');
            setTimeout(() => {
                btn.innerHTML = originalText;
                btn.classList.remove('bg-green-500');
                btn.classList.add('bg-purple-500');
            }, 2000);
        } else {
            throw new Error(data.error || 'Error al rotar sesión');
        }
    } catch (error) {
        console.error('Error rotando sesión:', error);
        btn.innerHTML = '❌ Error';
        btn.classList.remove('bg-purple-500');
        btn.classList.add('bg-red-500');
        setTimeout(() => {
            btn.innerHTML = originalText;
            btn.classList.remove('bg-red-500');
            btn.classList.add('bg-purple-500');
        }, 2000);
    } finally {
        btn.disabled = false;
        btn.classList.remove('opacity-50');
    }
}

async function updateRotationInfo() {
    try {
        const response = await fetch(`${API_URL}/api/sessions/rotation/info`);
        const data = await response.json();
        const rotationData = data.rotation;
        currentRotationSession = rotationData.currentSession;
        
        const infoEl = document.getElementById('rotationInfo');
        if (rotationData.totalActiveSessions > 0) {
            const nextRotation = new Date(rotationData.nextRotation);
            const timeUntilMs = nextRotation - new Date();
            const timeUntilMin = Math.floor(timeUntilMs / 1000 / 60);
            const timeUntilSec = Math.floor((timeUntilMs / 1000) % 60);
            let timeDisplay = timeUntilMin > 0 ? `${timeUntilMin}m ${timeUntilSec}s` : `${timeUntilSec}s`;
            if (timeUntilMs <= 0) timeDisplay = '🔄 Rotando...';
            infoEl.innerHTML = `🔄 <strong class="text-purple-700">${currentRotationSession || 'N/A'}</strong> enviando | Próxima rotación: <span class="font-mono">${timeDisplay}</span>`;
        } else {
            infoEl.innerHTML = '⚠️ No hay sesiones activas para rotación';
        }
    } catch (error) {
        console.error('Error obteniendo info de rotación:', error);
    }
}

function startRotationUpdates() {
    if (rotationUpdateInterval) clearInterval(rotationUpdateInterval);
    updateRotationInfo();
    loadSessions();
    rotationUpdateInterval = setInterval(() => {
        updateRotationInfo();
        loadSessions();
    }, 30000);
}

function stopRotationUpdates() {
    if (rotationUpdateInterval) {
        clearInterval(rotationUpdateInterval);
        rotationUpdateInterval = null;
    }
}

function updateNetworkInfo() {
    const container = document.getElementById('networkInfoDisplay');
    if (container && networkInfo.publicIP) {
        // Usar la información del servidor si está disponible
        const usingProxy = networkInfo.usingProxy || false;
        const location = networkInfo.location || (usingProxy ? 'Colombia (via Proxy)' : 'VPS Directo');
        const flagEmoji = usingProxy ? '🇨🇴' : '🇩🇪';
        const statusColor = usingProxy ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800';
        const statusText = usingProxy ? 'Proxy Activo' : 'Conexión Directa';
        
        container.innerHTML = `
            <div class="flex items-center gap-2 text-sm flex-wrap">
                <span class="font-bold">🌐 IP:</span>
                <span class="font-mono bg-purple-100 text-purple-800 px-2 py-1 rounded">${networkInfo.publicIP}</span>
                <span class="${statusColor} px-2 py-1 rounded text-xs font-medium">${statusText}</span>
                <span>${flagEmoji} ${location}</span>
            </div>`;
    }
}

function updateSessionsList() {
    const container = document.getElementById('sessionsList');
    if (sessions.length === 0) {
        container.innerHTML = `
            <div class="col-span-full text-center p-8 bg-white rounded-lg shadow">
                <div class="text-6xl mb-4">📱</div>
                <p class="text-gray-600 mb-2">No hay sesiones activas</p>
            </div>`;
        return;
    }
    
    const sortedSessions = [...sessions].sort((a, b) => {
        const statePriority = { 'READY': 1, 'LOADING': 2, 'WAITING_FOR_QR': 3, 'DISCONNECTED': 4, 'ERROR': 5 };
        const priorityA = statePriority[a.state] || 99;
        const priorityB = statePriority[b.state] || 99;
        if (priorityA !== priorityB) return priorityA - priorityB;
        return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    
    container.innerHTML = sortedSessions.map(s => createSessionCard(s)).join('');
    sortedSessions.forEach(s => {
        if (s.state === 'WAITING_FOR_QR' && s.qrReady) loadQRCode(s.name);
    });
}

function createSessionCard(session) {
    const colors = {
        'READY': 'border-green-500 bg-green-50',
        'WAITING_FOR_QR': 'border-yellow-500 bg-yellow-50',
        'LOADING': 'border-blue-500 bg-blue-50',
        'DISCONNECTED': 'border-red-500 bg-red-50',
        'ERROR': 'border-red-500 bg-red-50'
    };
    const labels = {
        'READY': '✅ Conectado',
        'WAITING_FOR_QR': '📱 Esperando QR',
        'LOADING': '⏳ Cargando',
        'DISCONNECTED': '❌ Desconectado',
        'ERROR': '⚠️ Error'
    };
    const colorClass = colors[session.state] || 'border-gray-500 bg-gray-50';
    const stateLabel = labels[session.state] || session.state;
    const isActiveSession = session.name === currentRotationSession && session.state === 'READY';
    
    let userInfoHtml = '';
    if (session.phoneNumber && session.state === 'READY') {
        userInfoHtml = `
            <div class="mt-3 p-3 bg-white rounded-lg border">
                <p class="text-sm"><strong>📞 Número:</strong> ${session.phoneNumber}</p>
            </div>`;
    }
    
    let qrHtml = session.state === 'WAITING_FOR_QR' ? `<div id="qr-container-${session.name}" class="mt-3 flex justify-center"><div class="spinner"></div></div>` : '';
    
    return `
        <div class="session-card bg-white rounded-lg shadow-lg overflow-hidden ${isActiveSession ? 'ring-2 ring-purple-500 heartbeat-active' : ''}">
            <div class="border-l-4 ${colorClass} p-6">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex-1">
                        <div class="flex items-center gap-2 mb-1">
                            <h3 class="text-lg font-bold">${session.name}</h3>
                            ${isActiveSession ? '<span class="active-session-badge text-white text-xs px-2 py-1 rounded-full font-bold">💓 ACTIVA</span>' : ''}
                        </div>
                        <span class="text-sm">${stateLabel}</span>
                    </div>
                    <button onclick="deleteSession('${session.name}')" class="text-red-500 hover:text-red-700 p-1">🗑️</button>
                </div>
                ${userInfoHtml}
                ${qrHtml}
                <div class="mt-3 text-xs text-gray-500">
                    <p>📊 Mensajes: ${session.messagesCount || 0}</p>
                    <p class="mt-1">🌐 IP: <span class="font-mono">${networkInfo.publicIP || 'N/A'}</span></p>
                </div>
                ${session.state === 'DISCONNECTED' || session.state === 'ERROR' ? `
                    <div class="mt-4">
                        <button onclick="reconnectSession('${session.name}')" class="w-full bg-blue-500 text-white py-2 rounded text-sm hover:bg-blue-600">🔄 Reconectar</button>
                    </div>` : ''}
            </div>
        </div>`;
}

async function loadQRCode(sessionName) {
    const container = document.getElementById(`qr-container-${sessionName}`);
    if (!container) return;
    try {
        const response = await fetch(`${API_URL}/api/sessions/${sessionName}/qr`);
        if (response.ok) {
            const data = await response.json();
            if (data.success && data.qr) {
                container.innerHTML = `<img src="${data.qr}" alt="QR Code" class="w-48 h-48 mx-auto">`;
            } else {
                container.innerHTML = `<p class="text-gray-500 text-sm">Esperando código QR...</p>`;
            }
        }
    } catch (error) {
        container.innerHTML = `<p class="text-red-500 text-sm">Error al cargar QR</p>`;
    }
}

async function createSession() {
    const nameInput = document.getElementById('sessionName');
    const sessionName = nameInput.value.trim();
    const statusEl = document.getElementById('createSessionStatus');
    const button = document.getElementById('createSessionBtn');

    if (!sessionName) {
        statusEl.className = 'mt-2 text-sm text-red-500';
        statusEl.textContent = 'Por favor ingresa un nombre para la sesión';
        return;
    }

    button.disabled = true;
    button.innerHTML = '<span class="spinner inline-block mr-2"></span> Creando...';

    try {
        const response = await fetch(`${API_URL}/api/sessions/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: sessionName })
        });
        const result = await response.json();
        if (result.success) {
            statusEl.className = 'mt-2 text-sm text-green-500';
            statusEl.textContent = '✅ Sesión creada. Escanea el código QR.';
            nameInput.value = '';
            setTimeout(loadSessions, 1000);
            setTimeout(loadSessions, 3000);
        } else {
            statusEl.className = 'mt-2 text-sm text-red-500';
            statusEl.textContent = `❌ Error: ${result.error}`;
        }
    } catch (error) {
        statusEl.className = 'mt-2 text-sm text-red-500';
        statusEl.textContent = `❌ Error: ${error.message}`;
    } finally {
        button.disabled = false;
        button.textContent = 'Crear Sesión';
    }
}

async function deleteSession(sessionName) {
    if (!confirm(`¿Eliminar la sesión "${sessionName}"?`)) return;
    try {
        const response = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(sessionName)}?deleteData=true`, {
            method: 'DELETE'
        });
        const result = await response.json();
        if (result.success) {
            alert('Sesión eliminada exitosamente');
            loadSessions();
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function reconnectSession(sessionName) {
    try {
        // Primero cerrar la sesión
        await fetch(`${API_URL}/api/sessions/${sessionName}`, {
            method: 'DELETE'
        });
        
        // Esperar un momento
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Crear nueva sesión con el mismo nombre
        const response = await fetch(`${API_URL}/api/sessions/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: sessionName })
        });
        const result = await response.json();
        if (result.success) {
            alert('Sesión reiniciada. Por favor escanea el código QR nuevamente.');
            setTimeout(loadSessions, 3000);
        } else {
            alert(`Error: ${result.error}`);
        }
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

function updateSessionsCount() {
    const ready = sessions.filter(s => s.state === 'READY').length;
    document.getElementById('activeSessionsCount').textContent = `${ready} de ${sessions.length} sesiones activas`;
}

function populateSessionSelects() {
    const readySessions = sessions.filter(s => s.state === 'READY');
    
    const personalHtml = readySessions.length > 0
        ? readySessions.map(s => `
            <label class="flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                <input type="checkbox" name="personalSession" value="${s.name}" class="mr-2 rounded text-blue-500">
                <span class="flex-1 font-medium">${s.name}</span>
                <span class="text-xs text-green-600">✅ ${s.userInfo?.wid || ''}</span>
            </label>`).join('')
        : '<p class="text-gray-500 text-sm">No hay sesiones activas</p>';
    document.getElementById('personalSessionCheckboxes').innerHTML = personalHtml;

    const bulkHtml = readySessions.length > 0
        ? readySessions.map(s => `
            <label class="flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                <input type="checkbox" name="bulkSession" value="${s.name}" class="mr-2 rounded text-purple-500">
                <span class="flex-1 font-medium">${s.name}</span>
                <span class="text-xs text-green-600">✅ ${s.userInfo?.wid || ''}</span>
            </label>`).join('')
        : '<p class="text-gray-500 text-sm">No hay sesiones activas</p>';
    document.getElementById('bulkSessionCheckboxes').innerHTML = bulkHtml;

    const groupSelect = document.getElementById('groupSessionSelect');
    groupSelect.innerHTML = '<option value="">-- Selecciona una sesión --</option>' +
        readySessions.map(s => `<option value="${s.name}">${s.name} (${s.userInfo?.wid || ''})</option>`).join('');
}

// ======================== MONITOR ========================
function startMonitor() {
    refreshMonitorStats();
    loadHistory(); // Cargar historial al iniciar
    loadQueueMessages(); // Cargar cola al iniciar
    if (monitorAutoRefresh && !monitorRefreshInterval) {
        monitorRefreshInterval = setInterval(refreshMonitorStats, 5000);
    }
}

function stopMonitor() {
    if (monitorRefreshInterval) {
        clearInterval(monitorRefreshInterval);
        monitorRefreshInterval = null;
    }
}

function toggleMonitorAutoRefresh() {
    monitorAutoRefresh = !monitorAutoRefresh;
    const btn = document.getElementById('monitorAutoRefreshBtn');
    
    if (monitorAutoRefresh) {
        btn.textContent = '▶️ Auto';
        btn.classList.remove('bg-gray-500');
        btn.classList.add('bg-green-500', 'hover:bg-green-600');
        startMonitor();
    } else {
        btn.textContent = '⏸️ Pausado';
        btn.classList.remove('bg-green-500', 'hover:bg-green-600');
        btn.classList.add('bg-gray-500');
        stopMonitor();
    }
}

async function refreshMonitorStats() {
    try {
        const rotationResponse = await fetch(`${API_URL}/api/rotation`);
        const rotationData = await rotationResponse.json();
        
        document.getElementById('monitorActiveSession').textContent = rotationData.currentSession || 'Ninguna';
        
        const nextRotation = new Date(rotationData.nextRotation);
        const now = new Date();
        const diffMs = nextRotation - now;
        
        await loadRecentMessages();
        
        if (diffMs > 0) {
            const mins = Math.floor(diffMs / 60000);
            const secs = Math.floor((diffMs % 60000) / 1000);
            document.getElementById('monitorNextRotation').textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
        } else {
            document.getElementById('monitorNextRotation').textContent = '🔄 Rotando...';
        }
        
        const sessionsResponse = await fetch(`${API_URL}/api/sessions`);
        const sessionsData = await sessionsResponse.json();
        
        let totalMessages = 0;
        const statsHtml = (sessionsData.sessions || []).map(session => {
            const msgCount = session.messagesCount || 0;
            totalMessages += msgCount;
            const isActive = session.name === rotationData.currentSession;
            const statusColor = session.state === 'READY' ? 'bg-green-100 border-green-300' : 'bg-gray-100 border-gray-300';
            const activeIndicator = isActive ? '<span class="absolute -top-1 -right-1 bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full">ACTIVA</span>' : '';
            
            return `
                <div class="relative ${statusColor} border rounded-lg p-4">
                    ${activeIndicator}
                    <div class="font-semibold text-gray-800">${session.name}</div>
                    <div class="text-2xl font-bold text-purple-600">${msgCount}</div>
                    <div class="text-xs text-gray-500">mensajes enviados</div>
                    <div class="mt-2 text-xs ${session.state === 'READY' ? 'text-green-600' : 'text-gray-500'}">
                        ${session.state === 'READY' ? '✅ Conectada' : '⚠️ ' + session.state}
                    </div>
                </div>
            `;
        }).join('');
        
        document.getElementById('monitorTotalMessages').textContent = totalMessages;
        document.getElementById('monitorSessionStats').innerHTML = statsHtml || '<p class="text-gray-500 col-span-full text-center">No hay sesiones</p>';
        
        // Actualizar badge de cola
        try {
            const queueResponse = await fetch(`${API_URL}/api/queue/messages?limit=1`);
            const queueData = await queueResponse.json();
            const badge = document.getElementById('queueBadge');
            if (queueData.success && queueData.stats && queueData.stats.totalQueued > 0) {
                badge.textContent = queueData.stats.totalQueued;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        } catch (e) { /* ignore */ }
        
    } catch (error) {
        console.error('Error actualizando monitor:', error);
    }
}

function updateMonitorLog() {
    const logContainer = document.getElementById('monitorMessageLog');
    
    if (monitorMessages.length === 0) {
        logContainer.innerHTML = '<p class="text-gray-500">Esperando mensajes...</p>';
        return;
    }
    
    const logHtml = monitorMessages.map(entry => {
        const isSuccess = entry.status === 'success' || entry.status === 'sent' || entry.status === 'received';
        const statusColor = isSuccess ? 'text-green-400' : 'text-red-400';
        const statusIcon = isSuccess ? '✅' : '❌';
        
        return `
            <div class="border-b border-gray-700 py-2">
                <span class="text-gray-500">[${entry.time}]</span>
                <span class="text-purple-400">[${entry.session}]</span>
                <span class="${statusColor}">${statusIcon}</span>
                <span class="text-blue-400">→ ${entry.destination}</span>
                <div class="text-gray-300 ml-4 whitespace-pre-wrap break-words">${entry.message}</div>
            </div>
        `;
    }).join('');
    
    logContainer.innerHTML = logHtml;
}

async function loadRecentMessages() {
    try {
        let response = await fetch(`${API_URL}/api/monitor/messages?limit=500`);
        const data = await response.json();
        
        if (data.messages && data.messages.length > 0) {
            monitorMessages = data.messages.map(msg => {
                const date = new Date(msg.timestamp);
                return {
                    time: date.toLocaleTimeString('es-CO'),
                    type: 'whatsapp',
                    session: msg.session,
                    destination: msg.destination || msg.origin || '',
                    message: msg.message || '',
                    status: msg.status
                };
            });
            updateMonitorLog();
        }
    } catch (error) {
        console.error('Error cargando mensajes recientes:', error);
    }
}

function clearMonitorLog() {
    monitorMessages = [];
    updateMonitorLog();
}

// Función simplificada ya que no hay pestañas
function showMonitorTab(tabName) {
    // Esta función ya no es necesaria pero se mantiene para compatibilidad
    if (tabName === 'history') loadHistory();
    if (tabName === 'queue') loadQueueMessages();
}

// Estado actual de la pestaña de cola
let currentQueueTab = 'pending';

// Cambiar pestaña de cola
function switchQueueTab(tab) {
    currentQueueTab = tab;
    
    // Actualizar estilos de pestañas
    const tabPending = document.getElementById('tabPending');
    const tabSent = document.getElementById('tabSent');
    
    if (tab === 'pending') {
        tabPending.className = 'px-4 py-2 text-sm font-medium text-orange-600 border-b-2 border-orange-500';
        tabSent.className = 'px-4 py-2 text-sm font-medium text-gray-500 hover:text-green-600';
    } else {
        tabPending.className = 'px-4 py-2 text-sm font-medium text-gray-500 hover:text-orange-600';
        tabSent.className = 'px-4 py-2 text-sm font-medium text-green-600 border-b-2 border-green-500';
    }
    
    loadQueueMessages();
}

async function loadQueueMessages() {
    try {
        const response = await fetch(`${API_URL}/api/queue/messages?status=${currentQueueTab}&limit=50`);
        const data = await response.json();
        
        if (!data.success) {
            const msgList = document.getElementById('queueMessageList');
            if (msgList) msgList.innerHTML = '<p class="text-red-500 text-center">Error al cargar cola</p>';
            return;
        }
        
        // Actualizar stats (con verificación de null)
        const stats = data.stats || {};
        const setTextSafe = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.textContent = value;
        };
        
        setTextSafe('queueTotalNumbers', stats.pendingNumbers || 0);
        setTextSafe('queueTotalMessages', stats.total || 0);
        setTextSafe('queueSentToday', stats.sentToday || 0);
        setTextSafe('pendingCount', stats.total || 0);
        setTextSafe('sentTodayCount', stats.sentToday || 0);
        
        // Actualizar badge
        const badge = document.getElementById('queueBadge');
        if (badge) {
            if (stats.total > 0) {
                badge.textContent = stats.total;
                badge.classList.remove('hidden');
            } else {
                badge.classList.add('hidden');
            }
        }
        
        // Renderizar lista de mensajes
        const messages = data.messages || [];
        const msgListEl = document.getElementById('queueMessageList');
        if (messages.length === 0) {
            const emptyMsg = currentQueueTab === 'pending' 
                ? '📭 Sin mensajes pendientes' 
                : '📭 Sin mensajes enviados hoy';
            if (msgListEl) msgListEl.innerHTML = `<p class="text-gray-500 text-center py-8">${emptyMsg}</p>`;
            return;
        }
        
        const html = messages.map(msg => {
            const isPending = msg.status === 'pending' || !msg.sent_at;
            const timeField = isPending ? msg.arrived_at : msg.sent_at;
            const date = new Date(timeField);
            const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit' });
            const msgPreview = msg.message ? msg.message.substring(0, 80) + (msg.message.length > 80 ? '...' : '') : '(sin texto)';
            
            let statusBadge;
            if (isPending) {
                statusBadge = '<span class="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded">⏳ pendiente</span>';
            } else if (msg.send_type === 'manual') {
                statusBadge = '<span class="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">✋ manual</span>';
            } else {
                statusBadge = '<span class="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">✅ auto</span>';
            }
            
            const timeLabel = isPending ? 'Recibido' : 'Enviado';
            
            return `
                <div class="border-b border-gray-200 py-3 last:border-0">
                    <div class="flex justify-between items-start">
                        <div>
                            <span class="font-mono text-sm text-gray-800">📱 ${msg.phone_number}</span>
                            <span class="text-xs text-gray-400 ml-2">${timeLabel}: ${dateStr} ${timeStr}</span>
                        </div>
                        ${statusBadge}
                    </div>
                    <div class="text-sm text-gray-600 mt-1">${msgPreview}</div>
                    ${msg.char_count ? `<div class="text-xs text-gray-400 mt-1">${msg.char_count} caracteres</div>` : ''}
                </div>
            `;
        }).join('');
        
        if (msgListEl) msgListEl.innerHTML = html;
        
    } catch (error) {
        console.error('Error loading queue:', error);
        const el = document.getElementById('queueMessageList');
        if (el) el.innerHTML = '<p class="text-red-500 text-center">Error de conexión</p>';
    }
}

// Marcar todos los mensajes pendientes como enviados manualmente
async function markAllAsSent() {
    const stats = document.getElementById('queueTotalMessages').textContent;
    if (stats === '0') {
        showToast('No hay mensajes pendientes para marcar', 'info');
        return;
    }
    
    if (!confirm(`¿Estás seguro de marcar ${stats} mensajes pendientes como enviados manualmente?\n\nEsto NO los enviará, solo los marcará como "enviado manual" para limpiar la cola.`)) {
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/queue/mark-all-sent`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        const data = await response.json();
        
        if (data.success) {
            showToast(`✅ ${data.markedCount} mensajes marcados como enviados`, 'success');
            loadQueueMessages(); // Recargar la lista
        } else {
            showToast('Error: ' + data.error, 'error');
        }
    } catch (error) {
        console.error('Error marking as sent:', error);
        showToast('Error de conexión', 'error');
    }
}

// ======================== BÚSQUEDA DE MENSAJES ========================

let searchCurrentOffset = 0;
let searchTotalMessages = 0;

function openSearchMessageModal(el) {
    const modal = document.getElementById('searchMessageModal');
    const body = document.getElementById('searchMessageModalBody');
    if (!modal || !body || !el) return;

    const encoded = el.getAttribute('data-message') || '';
    const message = encoded ? decodeURIComponent(encoded) : '';
    body.textContent = message || '-';
    modal.classList.remove('hidden');
    modal.classList.add('flex');
}

function closeSearchMessageModal() {
    const modal = document.getElementById('searchMessageModal');
    const body = document.getElementById('searchMessageModalBody');
    if (body) body.textContent = '';
    if (modal) {
        modal.classList.add('hidden');
        modal.classList.remove('flex');
    }
}

async function loadPhoneNumbers() {
    try {
        const response = await fetch(`${API_URL}/api/messages/phones`);
        const data = await response.json();
        
        if (!data.success) return;
        
        const select = document.getElementById('searchPhone');
        select.innerHTML = '<option value="">Todos los números</option>';
        
        data.phones.forEach(phone => {
            const option = document.createElement('option');
            option.value = phone.phone_number;
            option.textContent = `${phone.phone_number} (${phone.message_count} msgs)`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading phone numbers:', error);
    }
}

async function searchMessages(offset = 0) {
    try {
        const phone = document.getElementById('searchPhone').value;
        const startDate = document.getElementById('searchStartDate').value;
        const endDate = document.getElementById('searchEndDate').value;
        const limit = document.getElementById('searchLimit').value;
        
        searchCurrentOffset = offset;
        
        const params = new URLSearchParams();
        if (phone) params.append('phone', phone);
        if (startDate) params.append('startDate', startDate);
        if (endDate) params.append('endDate', endDate);
        params.append('limit', limit);
        params.append('offset', offset);
        
        const response = await fetch(`${API_URL}/api/messages/search?${params}`);
        const data = await response.json();
        
        if (!data.success) {
            document.getElementById('searchResultsTable').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Error al buscar</td></tr>';
            return;
        }
        
        searchTotalMessages = data.total;
        document.getElementById('searchResultCount').textContent = `(${data.total} mensajes encontrados)`;
        
        if (data.messages.length === 0) {
            document.getElementById('searchResultsTable').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">No se encontraron mensajes</td></tr>';
            document.getElementById('searchPagination').innerHTML = '';
            return;
        }
        
        const html = data.messages.map(msg => {
            const date = new Date(msg.timestamp);
            const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            const statusClass = msg.status === 'sent' || msg.status === 'success' ? 'bg-green-100 text-green-700' : 
                               msg.status === 'received' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';
            const statusText = msg.status === 'sent' || msg.status === 'success' ? '✅ Enviado' : 
                              msg.status === 'received' ? '📥 Recibido' : '❌ Error';
            const fullMessage = msg.message_preview || '';
            const preview = fullMessage ? fullMessage.substring(0, 80) + (fullMessage.length > 80 ? '...' : '') : '-';
            const encodedMessage = fullMessage ? encodeURIComponent(fullMessage) : '';
            const messageCell = fullMessage
                ? `<button type="button" class="text-left text-gray-600 max-w-xs truncate hover:underline block w-full" data-message="${encodedMessage}" onclick="openSearchMessageModal(this)">${preview}</button>`
                : `<span class="text-gray-600">-</span>`;
            
            return `
                <tr class="hover:bg-gray-50">
                    <td class="px-4 py-3 whitespace-nowrap">
                        <div class="text-gray-800">${dateStr}</div>
                        <div class="text-gray-500 text-xs">${timeStr}</div>
                    </td>
                    <td class="px-4 py-3 text-purple-600 font-medium">${msg.session}</td>
                    <td class="px-4 py-3 font-mono text-sm">${msg.phone_number}</td>
                    <td class="px-4 py-3">${messageCell}</td>
                    <td class="px-4 py-3 text-indigo-600 font-medium">${(msg.char_count || 0).toLocaleString()}</td>
                    <td class="px-4 py-3"><span class="px-2 py-1 rounded-full text-xs ${statusClass}">${statusText}</span></td>
                </tr>
            `;
        }).join('');
        
        document.getElementById('searchResultsTable').innerHTML = html;
        
        // Paginación
        renderSearchPagination(data.total, parseInt(limit), offset);
        
    } catch (error) {
        console.error('Error searching messages:', error);
        document.getElementById('searchResultsTable').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-red-500">Error de conexión</td></tr>';
    }
}

function renderSearchPagination(total, limit, offset) {
    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    
    if (totalPages <= 1) {
        document.getElementById('searchPagination').innerHTML = '';
        return;
    }
    
    let html = '';
    
    // Botón anterior
    if (currentPage > 1) {
        html += `<button onclick="searchMessages(${(currentPage - 2) * limit})" class="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">←</button>`;
    }
    
    // Páginas
    const startPage = Math.max(1, currentPage - 2);
    const endPage = Math.min(totalPages, currentPage + 2);
    
    for (let i = startPage; i <= endPage; i++) {
        const active = i === currentPage ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200';
        html += `<button onclick="searchMessages(${(i - 1) * limit})" class="px-3 py-1 rounded ${active}">${i}</button>`;
    }
    
    // Botón siguiente
    if (currentPage < totalPages) {
        html += `<button onclick="searchMessages(${currentPage * limit})" class="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">→</button>`;
    }
    
    document.getElementById('searchPagination').innerHTML = html;
}

function clearSearchFilters() {
    document.getElementById('searchPhone').value = '';
    document.getElementById('searchStartDate').value = '';
    document.getElementById('searchEndDate').value = '';
    document.getElementById('searchLimit').value = '50';
    document.getElementById('searchResultsTable').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">Selecciona filtros y haz clic en Buscar</td></tr>';
    document.getElementById('searchResultCount').textContent = '';
    document.getElementById('searchPagination').innerHTML = '';
}

async function loadHistory() {
    try {
        const response = await fetch(`${API_URL}/api/monitor/history`);
        const data = await response.json();
        
        const dateHtml = data.byDate.length > 0 ? data.byDate.map(item => {
            const successRate = item.total > 0 ? Math.round((item.success / item.total) * 100) : 0;
            const date = new Date(item.date);
            const dateStr = date.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
            
            return `
                <div class="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
                    <div class="font-semibold text-gray-800">${dateStr}</div>
                    <div class="text-2xl font-bold text-blue-600">${item.total}</div>
                    <div class="text-xs text-gray-500">mensajes</div>
                    <div class="mt-2 flex items-center gap-2">
                        <span class="text-green-600 text-sm">✅ ${item.success}</span>
                        <span class="text-red-600 text-sm">❌ ${item.error}</span>
                    </div>
                    <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                        <div class="bg-green-500 h-2 rounded-full" style="width: ${successRate}%"></div>
                    </div>
                </div>
            `;
        }).join('') : '<p class="text-gray-500 col-span-full text-center">No hay datos de historial</p>';
        
        document.getElementById('historyByDate').innerHTML = dateHtml;
        
        const bySession = Array.isArray(data.bySession) ? data.bySession : [];
        const queueItems = bySession.filter(item => String(item.session || '').toLowerCase() === 'queue');
        const sessionItems = bySession.filter(item => String(item.session || '').toLowerCase() !== 'queue');

        const sessionHtml = sessionItems.length > 0 ? sessionItems.map(item => {
            const successRate = item.total > 0 ? Math.round((item.success / item.total) * 100) : 0;
            const sessionInfo = data.sessions.find(s => s.name === item.session);
            const isActive = sessionInfo && sessionInfo.isActive;
            const isConnected = sessionInfo && sessionInfo.state === 'READY';
            
            return `
                <div class="bg-gradient-to-br ${isActive ? 'from-purple-50 to-indigo-50 border-purple-300' : 'from-gray-50 to-gray-100 border-gray-200'} border rounded-lg p-4 relative">
                    ${isActive ? '<span class="absolute -top-1 -right-1 bg-purple-500 text-white text-xs px-2 py-0.5 rounded-full">ACTIVA</span>' : ''}
                    <div class="font-semibold text-gray-800">${item.session}</div>
                    <div class="text-2xl font-bold text-purple-600">${item.total}</div>
                    <div class="text-xs text-gray-500">mensajes enviados</div>
                    <div class="mt-2 flex items-center gap-2">
                        <span class="text-green-600 text-sm">✅ ${item.success}</span>
                        <span class="text-red-600 text-sm">❌ ${item.error}</span>
                    </div>
                    <div class="mt-2 text-xs ${isConnected ? 'text-green-600' : 'text-gray-500'}">
                        ${isConnected ? '✅ Conectada' : '⚠️ Desconectada'}
                    </div>
                </div>
            `;
        }).join('') : '<p class="text-gray-500 col-span-full text-center">No hay datos de sesiones</p>';
        
        document.getElementById('historyBySession').innerHTML = sessionHtml;

        const queueEl = document.getElementById('historyQueue');
        if (queueEl) {
            const queueHtml = queueItems.length > 0 ? queueItems.map(item => {
                const successRate = item.total > 0 ? Math.round((item.success / item.total) * 100) : 0;
                return `
                    <div class="bg-gradient-to-br from-orange-50 to-amber-50 border border-orange-200 rounded-lg p-4">
                        <div class="font-semibold text-gray-800">Cola</div>
                        <div class="text-2xl font-bold text-orange-600">${item.total}</div>
                        <div class="text-xs text-gray-500">mensajes en cola</div>
                        <div class="mt-2 flex items-center gap-2">
                            <span class="text-green-600 text-sm">OK ${item.success}</span>
                            <span class="text-red-600 text-sm">ERR ${item.error}</span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2 mt-2">
                            <div class="bg-orange-500 h-2 rounded-full" style="width: ${successRate}%"></div>
                        </div>
                    </div>
                `;
            }).join('') : '<p class="text-gray-500 col-span-full text-center">No hay datos de cola</p>';
            queueEl.innerHTML = queueHtml;
        }
        
    } catch (error) {
        console.error('Error cargando historial:', error);
        document.getElementById('historyByDate').innerHTML = '<p class="text-red-500 col-span-full text-center">Error cargando historial</p>';
        const queueEl = document.getElementById('historyQueue');
        if (queueEl) {
            queueEl.innerHTML = '<p class="text-red-500 col-span-full text-center">Error cargando historial</p>';
        }
    }
}

// ======================== MENSAJES ========================
function getSelectedPersonalSessions() {
    return Array.from(document.querySelectorAll('input[name="personalSession"]:checked')).map(cb => cb.value);
}

function selectAllPersonalSessions() {
    document.querySelectorAll('input[name="personalSession"]').forEach(cb => cb.checked = true);
}

function deselectAllPersonalSessions() {
    document.querySelectorAll('input[name="personalSession"]').forEach(cb => cb.checked = false);
}

function getSelectedBulkSessions() {
    return Array.from(document.querySelectorAll('input[name="bulkSession"]:checked')).map(cb => cb.value);
}

function selectAllBulkSessions() {
    document.querySelectorAll('input[name="bulkSession"]').forEach(cb => cb.checked = true);
}

function deselectAllBulkSessions() {
    document.querySelectorAll('input[name="bulkSession"]').forEach(cb => cb.checked = false);
}

function selectAllGroups() {
    document.querySelectorAll('input[name="bulkGroup"]').forEach(cb => cb.checked = true);
}

function deselectAllGroups() {
    document.querySelectorAll('input[name="bulkGroup"]').forEach(cb => cb.checked = false);
}

async function sendPersonalMessage() {
    const selectedSessions = getSelectedPersonalSessions();
    const phoneNumber = document.getElementById('personalPhone').value.trim();
    const message = document.getElementById('personalMessage').value.trim();
    const fileInput = document.getElementById('personalFile');
    const statusEl = document.getElementById('personalStatus');
    const button = document.getElementById('sendPersonalBtn');

    if (selectedSessions.length === 0) {
        statusEl.className = 'text-sm text-red-500';
        statusEl.textContent = 'Selecciona al menos una sesión';
        return;
    }
    if (!phoneNumber) {
        statusEl.className = 'text-sm text-red-500';
        statusEl.textContent = 'Ingresa el número de teléfono';
        return;
    }
    if (!message && !fileInput.files[0]) {
        statusEl.className = 'text-sm text-red-500';
        statusEl.textContent = 'Escribe un mensaje o adjunta un archivo';
        return;
    }

    button.disabled = true;
    button.innerHTML = '<span class="spinner inline-block mr-2"></span> Enviando...';

    let sentCount = 0, failedCount = 0;
    const file = fileInput.files[0];

    for (const sessionName of selectedSessions) {
        statusEl.className = 'text-sm text-blue-500';
        statusEl.textContent = `Enviando desde ${sessionName}...`;

        try {
            let response;
            if (file) {
                const formData = new FormData();
                formData.append('sessionName', sessionName);
                formData.append('phoneNumber', phoneNumber);
                formData.append('caption', message || '');
                formData.append('file', file);
                response = await fetch(`${API_URL}/api/session/send-file`, { method: 'POST', body: formData });
            } else {
                response = await fetch(`${API_URL}/api/session/send-message`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionName, phoneNumber, message })
                });
            }
            const result = await response.json();
            if (result.success) sentCount++;
            else failedCount++;
        } catch (error) {
            failedCount++;
        }
    }

    if (failedCount === 0) {
        statusEl.className = 'text-sm text-green-500';
        statusEl.textContent = `✅ Mensaje enviado desde ${sentCount} sesión(es)`;
        document.getElementById('personalMessage').value = '';
        fileInput.value = '';
    } else {
        statusEl.className = 'text-sm text-yellow-500';
        statusEl.textContent = `⚠️ Enviado: ${sentCount} exitosos, ${failedCount} fallidos`;
    }

    button.disabled = false;
    button.innerHTML = '📨 Enviar Mensaje';
}

function switchBulkTab(tab) {
    bulkCurrentTab = tab;
    const tabNumbers = document.getElementById('tabNumbers');
    const tabGroups = document.getElementById('tabGroups');
    const panelNumbers = document.getElementById('panelNumbers');
    const panelGroups = document.getElementById('panelGroups');

    if (tab === 'numbers') {
        tabNumbers.className = 'px-4 py-2 border-b-2 border-purple-500 text-purple-600 font-medium';
        tabGroups.className = 'px-4 py-2 border-b-2 border-transparent text-gray-500 hover:text-gray-700';
        panelNumbers.classList.remove('hidden');
        panelGroups.classList.add('hidden');
    } else {
        tabNumbers.className = 'px-4 py-2 border-b-2 border-transparent text-gray-500 hover:text-gray-700';
        tabGroups.className = 'px-4 py-2 border-b-2 border-purple-500 text-purple-600 font-medium';
        panelNumbers.classList.add('hidden');
        panelGroups.classList.remove('hidden');
    }
}

async function loadGroupsFromSession() {
    const sessionName = document.getElementById('groupSessionSelect').value;
    const groupsList = document.getElementById('groupsList');

    if (!sessionName) {
        groupsList.innerHTML = '<p class="text-gray-500 text-sm">Selecciona una sesión para ver los grupos</p>';
        return;
    }

    groupsList.innerHTML = '<div class="flex items-center"><div class="spinner mr-2"></div> Cargando grupos de ' + sessionName + '...</div>';

    try {
        const response = await fetch(`${API_URL}/api/session/${sessionName}/groups`);
        const data = await response.json();

        if (data.success && data.groups && data.groups.length > 0) {
            groupsList.innerHTML = data.groups.map(group => `
                <label class="flex items-center p-2 hover:bg-gray-100 rounded cursor-pointer">
                    <input type="checkbox" name="bulkGroup" value="${group.id}" class="mr-2 rounded">
                    <span class="flex-1">${group.name}</span>
                    <span class="text-xs text-gray-400">${group.participants || '?'} miembros</span>
                </label>`).join('');
        } else {
            groupsList.innerHTML = '<p class="text-gray-500 text-sm">No se encontraron grupos en ' + sessionName + '</p>';
        }
    } catch (error) {
        groupsList.innerHTML = `<p class="text-red-500 text-sm">Error: ${error.message}</p>`;
    }
}

async function sendBulkMessages() {
    const message = document.getElementById('bulkMessage').value.trim();
    const delay = parseInt(document.getElementById('bulkDelay').value) * 1000;
    const fileInput = document.getElementById('bulkFileInput');
    const statusEl = document.getElementById('bulkStatus');
    const button = document.getElementById('sendBulkBtn');
    const progressContainer = document.getElementById('bulkProgress');
    const progressBar = document.getElementById('bulkProgressBar');
    const progressText = document.getElementById('bulkProgressText');

    let recipients = [];
    let selectedSessions = [];
    let isGroupSend = false;

    if (bulkCurrentTab === 'numbers') {
        selectedSessions = getSelectedBulkSessions();
        if (selectedSessions.length === 0) {
            statusEl.className = 'text-sm text-red-500';
            statusEl.textContent = 'Selecciona al menos una sesión';
            return;
        }
        const contactsText = document.getElementById('bulkContacts').value.trim();
        if (!contactsText) {
            statusEl.className = 'text-sm text-red-500';
            statusEl.textContent = 'Ingresa los números de teléfono';
            return;
        }
        recipients = contactsText.split('\n').map(l => l.trim()).filter(l => l && /^[0-9]+$/.test(l));
        if (recipients.length === 0) {
            statusEl.className = 'text-sm text-red-500';
            statusEl.textContent = 'No se encontraron números válidos';
            return;
        }
        if (recipients.length > 50) {
            statusEl.className = 'text-sm text-red-500';
            statusEl.textContent = 'Máximo 50 contactos por envío';
            return;
        }
    } else {
        const sessionName = document.getElementById('groupSessionSelect').value;
        if (!sessionName) {
            statusEl.className = 'text-sm text-red-500';
            statusEl.textContent = 'Selecciona una sesión para enviar a grupos';
            return;
        }
        selectedSessions = [sessionName];
        const checkboxes = document.querySelectorAll('input[name="bulkGroup"]:checked');
        recipients = Array.from(checkboxes).map(cb => cb.value);
        isGroupSend = true;
        if (recipients.length === 0) {
            statusEl.className = 'text-sm text-red-500';
            statusEl.textContent = 'Selecciona al menos un grupo';
            return;
        }
    }

    if (!message && !fileInput.files[0]) {
        statusEl.className = 'text-sm text-red-500';
        statusEl.textContent = 'Escribe un mensaje o adjunta un archivo';
        return;
    }

    const recipientType = isGroupSend ? 'grupo(s)' : 'número(s)';
    const totalMensajes = recipients.length * selectedSessions.length;
    if (!confirm(`¿Enviar mensaje a ${recipients.length} ${recipientType} desde ${selectedSessions.length} sesión(es)?\n\nTotal: ${totalMensajes} mensajes`)) return;

    button.disabled = true;
    button.innerHTML = '<span class="spinner inline-block mr-2"></span> Enviando...';
    progressContainer.classList.remove('hidden');
    progressBar.style.width = '0%';

    let sentCount = 0, failedCount = 0;
    const total = recipients.length * selectedSessions.length;
    const file = fileInput.files[0];
    let processed = 0;

    for (const sessionName of selectedSessions) {
        statusEl.className = 'text-sm text-blue-500';
        statusEl.textContent = `Enviando desde ${sessionName}...`;

        for (let i = 0; i < recipients.length; i++) {
            const recipient = recipients[i];
            try {
                let response;
                if (file) {
                    const formData = new FormData();
                    formData.append('sessionName', sessionName);
                    formData.append('phoneNumber', recipient);
                    formData.append('caption', message || '');
                    formData.append('file', file);
                    response = await fetch(`${API_URL}/api/session/send-file`, { method: 'POST', body: formData });
                } else {
                    response = await fetch(`${API_URL}/api/session/send-message`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sessionName, phoneNumber: recipient, message })
                    });
                }
                const result = await response.json();
                if (result.success) sentCount++;
                else failedCount++;
            } catch (error) {
                failedCount++;
            }

            processed++;
            const progress = (processed / total) * 100;
            progressBar.style.width = `${progress}%`;
            progressText.textContent = `${processed}/${total} procesados`;

            if (i < recipients.length - 1) {
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }

    if (failedCount === 0) {
        statusEl.className = 'text-sm text-green-500';
        statusEl.textContent = `✅ Completado: ${sentCount} mensajes enviados`;
    } else if (sentCount > 0) {
        statusEl.className = 'text-sm text-yellow-500';
        statusEl.textContent = `⚠️ Parcial: ${sentCount} enviados, ${failedCount} fallidos`;
    } else {
        statusEl.className = 'text-sm text-red-500';
        statusEl.textContent = `❌ Fallido: ${failedCount} mensajes no enviados`;
    }

    button.disabled = false;
    button.innerHTML = '🚀 Enviar Masivo';
    setTimeout(() => progressContainer.classList.add('hidden'), 3000);
}

function clearBulkForm() {
    document.getElementById('bulkContacts').value = '';
    document.getElementById('bulkMessage').value = '';
    document.getElementById('bulkFileInput').value = '';
    document.getElementById('bulkStatus').textContent = '';
    document.getElementById('bulkProgress').classList.add('hidden');
    document.querySelectorAll('input[name="bulkGroup"]').forEach(cb => cb.checked = false);
    document.getElementById('groupSessionSelect').value = '';
    document.getElementById('groupsList').innerHTML = '<p class="text-gray-500 text-sm">Selecciona una sesión para ver los grupos</p>';
}

// ======================== CONFIGURACIÓN (BATCH) ========================

async function initSettings() {
    await refreshBatchStatus();
    await loadNotificationSettings();
    
    // Configurar listener para el slider
    const range = document.getElementById('batchIntervalRange');
    const value = document.getElementById('batchIntervalValue');
    
    if (range && value) {
        range.addEventListener('input', (e) => {
            value.textContent = e.target.value;
        });
    }
}

async function refreshBatchStatus() {
    try {
        const response = await fetch(`${API_URL}/api/settings/batch`);
        const data = await response.json();
        
        if (data.success) {
            const { settings } = data;
            
            // Actualizar UI
            const range = document.getElementById('batchIntervalRange');
            const value = document.getElementById('batchIntervalValue');
            const queueSize = document.getElementById('queueSize');
            const pendingNumbers = document.getElementById('pendingNumbers');
            const currentInterval = document.getElementById('currentInterval');

            if (range) range.value = settings.interval;
            if (value) value.textContent = settings.interval;
            if (queueSize) queueSize.textContent = settings.queueSize;
            if (pendingNumbers) pendingNumbers.textContent = settings.pendingNumbers;
            if (currentInterval) currentInterval.textContent = `${settings.interval} min`;
        }
    } catch (error) {
        console.error('Error cargando configuración:', error);
    }
}

async function saveBatchSettings() {
    const interval = document.getElementById('batchIntervalRange').value;
    
    try {
        const response = await fetch(`${API_URL}/api/settings/batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert('✅ Configuración guardada exitosamente');
            refreshBatchStatus();
        } else {
            alert(`❌ Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error guardando configuración:', error);
        alert('❌ Error de conexión');
    }
}

let selectedNotificationInterval = 30;

function setNotificationInterval(minutes) {
    selectedNotificationInterval = minutes;
    
    // Actualizar estilos de botones
    document.querySelectorAll('.notification-interval-btn').forEach(btn => {
        btn.classList.remove('border-blue-500', 'bg-blue-50');
        btn.classList.add('border-gray-300');
    });
    
    const selectedBtn = document.getElementById(`notif-${minutes}`);
    if (selectedBtn) {
        selectedBtn.classList.remove('border-gray-300');
        selectedBtn.classList.add('border-blue-500', 'bg-blue-50');
    }
}

async function saveNotificationSettings() {
    try {
        const response = await fetch(`${API_URL}/api/settings/notification-interval`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ interval: selectedNotificationInterval })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ Notificaciones configuradas cada ${selectedNotificationInterval} minutos`);
        } else {
            alert(`❌ Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error guardando configuración:', error);
        alert('❌ Error de conexión');
    }
}

async function loadNotificationSettings() {
    try {
        const response = await fetch(`${API_URL}/api/settings/notification-interval`);
        const data = await response.json();
        
        if (data.success && data.interval) {
            selectedNotificationInterval = data.interval;
            setNotificationInterval(data.interval);
        }
    } catch (error) {
        console.error('Error cargando configuración:', error);
    }
}

// Auto-refresh sessions
setInterval(() => {
    if (!document.getElementById('mainApp').classList.contains('hidden')) {
        loadSessions();
    }
}, 30000);


