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

// ======================== NAVEGACIÓN ========================
function showSection(sectionId) {
    document.querySelectorAll('.section-content').forEach(s => s.classList.remove('active'));
    document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
    document.getElementById(`section-${sectionId}`).classList.add('active');
    document.getElementById(`nav-${sectionId}`).classList.add('active');
    const titles = {
        sessions: { title: 'Sesiones de WhatsApp', subtitle: 'Gestiona tus conexiones de WhatsApp' },
        monitor: { title: 'Monitor en Tiempo Real', subtitle: 'Visualiza la actividad de mensajes' },
        personal: { title: 'Mensaje Personalizado', subtitle: 'Envía mensajes individuales' },
        bulk: { title: 'Envío Masivo', subtitle: 'Envía mensajes a múltiples destinatarios' },
        analytics: { title: 'Analytics Dashboard', subtitle: 'Estadísticas y métricas de mensajes' }
    };
    document.getElementById('sectionTitle').textContent = titles[sectionId].title;
    document.getElementById('sectionSubtitle').textContent = titles[sectionId].subtitle;
    
    if (sectionId === 'monitor') startMonitor();
    else stopMonitor();
    
    if (sectionId === 'analytics') initAnalytics();
}

// ======================== SESIONES ========================
async function loadSessions() {
    try {
        const response = await fetch(`${API_URL}/api/sessions`);
        sessions = await response.json();
        await updateRotationInfo();
        updateSessionsList();
        populateSessionSelects();
        updateSessionsCount();
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
        const response = await fetch(`${API_URL}/api/rotation`);
        const rotationData = await response.json();
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
        if (s.state === 'WAITING_FOR_QR' && s.hasQR) loadQRCode(s.name);
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
    if (session.userInfo && session.state === 'READY') {
        userInfoHtml = `
            <div class="mt-3 p-3 bg-white rounded-lg border">
                <p class="text-sm"><strong>👤 Nombre:</strong> ${session.userInfo.pushname || 'N/A'}</p>
                <p class="text-sm"><strong>📞 Número:</strong> ${session.userInfo.wid || 'N/A'}</p>
                <p class="text-sm"><strong>📱 Plataforma:</strong> ${session.userInfo.platform || 'N/A'}</p>
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
                    <p>📊 Mensajes: ${session.messageCount || 0}</p>
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
        const response = await fetch(`${API_URL}/api/session/${sessionName}/qr`);
        if (response.ok) {
            const qrDataUrl = await response.text();
            if (qrDataUrl && qrDataUrl.startsWith('data:image')) {
                container.innerHTML = `<img src="${qrDataUrl}" alt="QR Code" class="w-48 h-48 mx-auto">`;
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
        const response = await fetch(`${API_URL}/api/sessions/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName })
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
        const response = await fetch(`${API_URL}/api/session/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionName })
        });
        const result = await response.json();
        if (result.success) loadSessions();
        else alert(`Error: ${result.error}`);
    } catch (error) {
        alert(`Error: ${error.message}`);
    }
}

async function reconnectSession(sessionName) {
    try {
        const response = await fetch(`${API_URL}/api/session/${sessionName}/reconnect`, { method: 'POST' });
        const result = await response.json();
        if (result.success) {
            alert('Reconectando sesión...');
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
        const statsHtml = sessionsData.map(session => {
            const msgCount = session.messageCount || 0;
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
        const statusColor = entry.status === 'success' ? 'text-green-400' : 'text-red-400';
        const statusIcon = entry.status === 'success' ? '✅' : '❌';
        
        return `
            <div class="border-b border-gray-700 py-2">
                <span class="text-gray-500">[${entry.time}]</span>
                <span class="text-purple-400">[${entry.session}]</span>
                <span class="${statusColor}">${statusIcon}</span>
                <span class="text-blue-400">→ ${entry.destination}</span>
                <div class="text-gray-300 ml-4 truncate">${entry.message}</div>
            </div>
        `;
    }).join('');
    
    logContainer.innerHTML = logHtml;
}

async function loadRecentMessages() {
    try {
        const response = await fetch(`${API_URL}/api/monitor/messages`);
        const data = await response.json();
        
        if (data.messages && data.messages.length > 0) {
            monitorMessages = data.messages.slice(0, MAX_MONITOR_MESSAGES).map(msg => {
                const date = new Date(msg.timestamp);
                return {
                    time: date.toLocaleTimeString('es-CO'),
                    type: 'whatsapp',
                    session: msg.session,
                    destination: msg.destination,
                    message: msg.message.substring(0, 50) + (msg.message.length > 50 ? '...' : ''),
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

function showMonitorTab(tabName) {
    document.querySelectorAll('[id^="monitorTab-"]').forEach(tab => tab.classList.add('hidden'));
    document.querySelectorAll('.monitor-tab').forEach(tab => {
        tab.classList.remove('active', 'border-purple-500', 'text-purple-600');
        tab.classList.add('border-transparent', 'text-gray-500');
    });
    
    document.getElementById(`monitorTab-${tabName}`).classList.remove('hidden');
    const activeTab = document.getElementById(`tab-${tabName}`);
    activeTab.classList.add('active', 'border-purple-500', 'text-purple-600');
    activeTab.classList.remove('border-transparent', 'text-gray-500');
    
    if (tabName === 'history') loadHistory();
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
        
        const sessionHtml = data.bySession.length > 0 ? data.bySession.map(item => {
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
        
    } catch (error) {
        console.error('Error cargando historial:', error);
        document.getElementById('historyByDate').innerHTML = '<p class="text-red-500 col-span-full text-center">Error cargando historial</p>';
    }
}

// ======================== MENSAJES ========================
function getSelectedPersonalSessions() {
    return Array.from(document.querySelectorAll('input[name="personalSession"]:checked')).map(cb => cb.value);
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


// Actualizar intervalo de rotacion
async function updateRotationInterval() {
    const select = document.getElementById('rotationIntervalSelect');
    const newInterval = parseInt(select.value);
    
    try {
        const response = await fetch('http://164.68.118.86:5001/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rotation_interval_seconds: newInterval })
        });
        
        if (response.ok) {
            const result = await response.json();
            console.log('Rotation interval updated:', result);
            
            // Mostrar notificacion
            const rotationInfo = document.getElementById('rotationInfo');
            const originalText = rotationInfo.textContent;
            rotationInfo.textContent = ` Intervalo: ${newInterval}s`;
            setTimeout(() => rotationInfo.textContent = originalText, 2000);
        } else {
            console.error('Error updating rotation interval');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

// Cargar intervalo de rotacion actual
async function loadRotationConfig() {
    try {
        const response = await fetch('http://164.68.118.86:5001/config');
        if (response.ok) {
            const config = await response.json();
            const select = document.getElementById('rotationIntervalSelect');
            if (select && config.rate_limit_config && config.rate_limit_config.rotation_interval_seconds) {
                const interval = config.rate_limit_config.rotation_interval_seconds;
                // Seleccionar la opcion mas cercana
                const options = Array.from(select.options);
                let closest = options[0];
                for (const opt of options) {
                    if (parseInt(opt.value) === interval) {
                        closest = opt;
                        break;
                    }
                }
                select.value = closest.value;
            }
        }
    } catch (error) {
        console.error('Error loading config:', error);
    }
}


// Auto-refresh sessions
setInterval(() => {
    if (!document.getElementById('mainApp').classList.contains('hidden')) {
        loadSessions();
        loadRotationConfig();
    }
}, 30000);
