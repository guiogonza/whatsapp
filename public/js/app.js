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
let countdownInterval = null; // Intervalo para actualizar cuentas regresivas

// Variables para ordenamiento de tablas
let searchSortColumn = 'timestamp';
let searchSortDirection = 'desc';
let searchCurrentData = [];

// ======================== UTILIDADES ========================

/**
 * Formatea milisegundos en formato MM:SS para cuenta regresiva
 */
function formatCountdown(ms) {
    if (ms <= 0) return '00:00';
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * Actualiza todas las cuentas regresivas en la página
 */
function updateCountdowns() {
    const countdownElements = document.querySelectorAll('.countdown-timer');
    countdownElements.forEach(el => {
        let resetMs = parseInt(el.dataset.resetMs, 10);
        if (resetMs > 0) {
            resetMs -= 1000; // Restar 1 segundo
            el.dataset.resetMs = resetMs;
            el.textContent = formatCountdown(resetMs);
            
            // Si llegó a 0, cambiar estilo
            if (resetMs <= 0) {
                el.textContent = '¡Disponible!';
                el.classList.add('text-green-600');
                el.classList.remove('text-orange-600');
            }
        }
    });
}

/**
 * Inicia el intervalo de actualización de cuentas regresivas
 */
function startCountdownInterval() {
    if (countdownInterval) {
        clearInterval(countdownInterval);
    }
    countdownInterval = setInterval(updateCountdowns, 1000);
}

/**
 * Convierte código de país a emoji de bandera
 */
function getFlagEmoji(countryCode) {
    if (!countryCode || countryCode.length !== 2) return '';
    const codePoints = countryCode
        .toUpperCase()
        .split('')
        .map(char => 127397 + char.charCodeAt(0));
    return String.fromCodePoint(...codePoints);
}

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
        conversation: { title: 'Conversación IA Anti-Ban', subtitle: 'Genera actividad natural entre sesiones' },
        settings: { title: 'Configuración', subtitle: 'Ajustes del sistema' },
        database: { title: 'Base de Datos PostgreSQL', subtitle: 'Estado y monitoreo de la base de datos' },
        webhooks: { title: 'Centro de Mensajes', subtitle: 'Mensajes entrantes de WhatsApp Cloud API' }
    };
    
    document.getElementById('sectionTitle').textContent = titles[sectionId].title;
    document.getElementById('sectionSubtitle').textContent = titles[sectionId].subtitle;
    
    if (sectionId === 'monitor') startMonitor();
    else stopMonitor();
    
    if (sectionId === 'analytics') initAnalytics();
    if (sectionId === 'settings') initSettings();
    if (sectionId === 'database') initDatabase();
    if (sectionId === 'search') {
        loadPhoneNumbers();
        loadSearchSessions();
    }
    if (sectionId === 'conversation') populateConversationSessions();
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

async function loadCloudApiStats() {
    try {
        const response = await fetch(`${API_URL}/api/cloud/stats`);
        const data = await response.json();
        
        if (data.success) {
            // Actualizar estadísticas
            document.getElementById('cloudApiToday').textContent = data.database?.today || 0;
            document.getElementById('cloudApiHour').textContent = data.database?.thisHour || 0;
            document.getElementById('cloudApiTotal').textContent = data.database?.total || 0;
            document.getElementById('cloudApiPercentage').textContent = `${data.percentage || 50}%`;
            
            // Número de teléfono
            if (data.phoneNumber) {
                document.getElementById('cloudApiPhone').textContent = data.phoneNumber;
            }
            
            // Estado del modo híbrido
            const hybridEl = document.getElementById('cloudApiHybridStatus');
            if (data.hybridMode) {
                hybridEl.textContent = `🔀 Modo Híbrido (${data.percentage}% Cloud)`;
            } else {
                hybridEl.textContent = '📱 Solo Baileys';
            }
            
            // Estado de Cloud API
            const statusEl = document.getElementById('cloudApiStatus');
            const accountStatusEl = document.getElementById('cloudApiAccountStatus');
            const accountErrorEl = document.getElementById('cloudApiAccountError');
            const errorTextEl = document.getElementById('cloudApiErrorText');
            const btnEnableEl = document.getElementById('btnEnableCloud');
            const btnDisableEl = document.getElementById('btnDisableCloud');
            const hourUsage = data.cloudApi?.messagesThisHour || 0;
            const hourLimit = data.cloudApi?.hourlyLimit || 500;
            
            // Verificar estado de la cuenta
            const accountReady = data.cloudApi?.accountReady !== false;
            const accountError = data.cloudApi?.accountError;
            
            if (!accountReady) {
                // Cuenta no está lista
                statusEl.classList.add('hidden');
                accountStatusEl.classList.remove('hidden');
                accountStatusEl.textContent = '⏳ CUENTA PENDIENTE';
                accountStatusEl.className = 'bg-yellow-400 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold';
                
                // Mostrar error si existe
                if (accountError) {
                    accountErrorEl.classList.remove('hidden');
                    errorTextEl.textContent = accountError;
                } else {
                    accountErrorEl.classList.add('hidden');
                }
                
                // Mostrar botón de habilitar
                btnEnableEl.classList.remove('hidden');
                btnDisableEl.classList.add('hidden');
            } else {
                // Cuenta está lista
                accountStatusEl.classList.add('hidden');
                accountErrorEl.classList.add('hidden');
                statusEl.classList.remove('hidden');
                
                // Mostrar botón de deshabilitar
                btnEnableEl.classList.add('hidden');
                btnDisableEl.classList.remove('hidden');
                
                if (hourUsage >= hourLimit) {
                    statusEl.className = 'bg-red-400 text-red-900 px-3 py-1 rounded-full text-xs font-bold';
                    statusEl.textContent = '⚠️ LÍMITE';
                } else if (hourUsage >= hourLimit * 0.8) {
                    statusEl.className = 'bg-yellow-400 text-yellow-900 px-3 py-1 rounded-full text-xs font-bold';
                    statusEl.textContent = '⚠️ 80%+';
                } else {
                    statusEl.className = 'bg-green-400 text-green-900 px-3 py-1 rounded-full text-xs font-bold';
                    statusEl.textContent = '● ACTIVA';
                }
            }
        }
    } catch (error) {
        console.error('Error cargando stats Cloud API:', error);
    }
}

// Habilitar Cloud API
async function enableCloudApi() {
    try {
        const btn = document.getElementById('btnEnableCloud');
        btn.disabled = true;
        btn.textContent = '⏳ Habilitando...';
        
        const response = await fetch(`${API_URL}/api/cloud/enable`, { method: 'POST' });
        const data = await response.json();
        
        if (data.success) {
            await loadCloudApiStats();
            alert('✅ Cloud API habilitada correctamente');
        } else {
            throw new Error(data.error || 'Error al habilitar');
        }
    } catch (error) {
        console.error('Error habilitando Cloud API:', error);
        alert('❌ Error: ' + error.message);
    } finally {
        const btn = document.getElementById('btnEnableCloud');
        btn.disabled = false;
        btn.textContent = '✓ Habilitar Cloud API';
    }
}

// Deshabilitar Cloud API
async function disableCloudApi() {
    if (!confirm('¿Seguro que deseas deshabilitar Cloud API? Los mensajes irán solo por Baileys o quedarán en cola.')) {
        return;
    }
    
    try {
        const btn = document.getElementById('btnDisableCloud');
        btn.disabled = true;
        btn.textContent = '⏳ Deshabilitando...';
        
        const response = await fetch(`${API_URL}/api/cloud/disable`, { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason: 'Deshabilitada manualmente desde panel' })
        });
        const data = await response.json();
        
        if (data.success) {
            await loadCloudApiStats();
            alert('✅ Cloud API deshabilitada. Los mensajes ahora van solo por Baileys.');
        } else {
            throw new Error(data.error || 'Error al deshabilitar');
        }
    } catch (error) {
        console.error('Error deshabilitando Cloud API:', error);
        alert('❌ Error: ' + error.message);
    } finally {
        const btn = document.getElementById('btnDisableCloud');
        btn.disabled = false;
        btn.textContent = '✕ Deshabilitar';
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
    loadCloudApiStats();
    startCountdownInterval(); // Iniciar cuentas regresivas
    rotationUpdateInterval = setInterval(() => {
        updateRotationInfo();
        loadSessions();
        loadCloudApiStats();
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
    // Si alcanzó límite horario, cambiar colores
    let colorClass = colors[session.state] || 'border-gray-500 bg-gray-50';
    if (session.hourlyLimitReached && session.state === 'READY') {
        colorClass = 'border-orange-500 bg-orange-50';
    }
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
                        <div class="flex items-center gap-2 mb-1 flex-wrap">
                            <h3 class="text-lg font-bold">${session.name}</h3>
                            ${isActiveSession ? '<span class="active-session-badge text-white text-xs px-2 py-1 rounded-full font-bold">💓 ACTIVA</span>' : ''}
                            ${session.hourlyLimitReached ? '<span class="bg-orange-500 text-white text-xs px-2 py-1 rounded-full font-bold animate-pulse">⏸️ LÍMITE</span>' : ''}
                        </div>
                        <span class="text-sm">${stateLabel}</span>
                    </div>
                    <button onclick="deleteSession('${session.name}')" class="text-red-500 hover:text-red-700 p-1">🗑️</button>
                </div>
                ${userInfoHtml}
                ${qrHtml}
                <div class="mt-3 text-xs text-gray-500">
                    <p>📦 Consolidados: <span class="font-bold text-purple-600">${session.consolidatedCount || 0}</span></p>
                    <p class="mt-1">📥 Recibidos: <span class="font-bold text-green-600">${session.messagesReceivedCount || 0}</span> | 📤 Enviados: <span class="font-bold text-blue-600">${session.messagesSentCount || 0}</span></p>
                    <p class="mt-1">⏱️ Esta hora: <span class="font-bold ${session.hourlyLimitReached ? 'text-orange-600' : 'text-green-600'}">${session.hourlyCount || 0}/${session.hourlyLimit || 60}</span> ${session.hourlyLimitReached ? '🚫' : '✅'}</p>
                    ${session.hourlyLimitReached && session.resetTimeMs > 0 ? `<p class="mt-1 text-orange-600 font-bold">⏳ Disponible en: <span class="countdown-timer" data-reset-ms="${session.resetTimeMs}">${formatCountdown(session.resetTimeMs)}</span></p>` : ''}
                    <p class="mt-1">🌐 IP: <span class="font-mono ${session.proxyInfo?.ip ? 'text-green-600 font-bold' : ''}">${session.proxyInfo?.ip || networkInfo.publicIP || 'N/A'}</span></p>
                    <p class="mt-1">📍 Ubicación: <span class="font-semibold">${session.proxyInfo?.city || 'Desconocido'}, ${session.proxyInfo?.country || 'Desconocido'}</span> ${session.proxyInfo?.countryCode ? getFlagEmoji(session.proxyInfo.countryCode) : ''}</p>
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
    
    // Agregar sesiones para conversación IA
    populateConversationSessions();
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
        
        // Recargar sesiones para obtener datos actualizados (esto actualiza la variable global 'sessions')
        await loadSessions();
        
        // Actualizar la sesión activa de rotación
        currentRotationSession = rotationData.currentSession;
        
        let totalMessages = 0;
        const statsHtml = sessions.map(session => {
            const sentCount = session.messagesSentCount || 0;
            const receivedCount = session.messagesReceivedCount || 0;
            const consolidatedCount = session.consolidatedCount || 0;
            totalMessages += sentCount;
            const isActive = session.name === rotationData.currentSession;
            
            // Usar el mismo estilo que las tarjetas de sesión
            const colors = {
                'READY': 'border-green-500 bg-green-50',
                'WAITING_FOR_QR': 'border-yellow-500 bg-yellow-50',
                'LOADING': 'border-blue-500 bg-blue-50',
                'DISCONNECTED': 'border-red-500 bg-red-50',
                'ERROR': 'border-red-500 bg-red-50'
            };
            const labels = {
                'READY': '✅ Conectada',
                'WAITING_FOR_QR': '📱 Esperando QR',
                'LOADING': '⏳ Cargando',
                'DISCONNECTED': '❌ Desconectada',
                'ERROR': '⚠️ Error'
            };
            const colorClass = colors[session.state] || 'border-gray-500 bg-gray-50';
            const stateLabel = labels[session.state] || session.state;
            
            return `
                <div class="session-card bg-white rounded-lg shadow-lg overflow-hidden ${isActive ? 'ring-2 ring-purple-500 heartbeat-active' : ''}">
                    <div class="border-l-4 ${colorClass} p-6">
                        <div class="flex justify-between items-start mb-3">
                            <div class="flex-1">
                                <div class="flex items-center gap-2 mb-1">
                                    <h3 class="text-lg font-bold">${session.name}</h3>
                                    ${isActive ? '<span class="active-session-badge text-white text-xs px-2 py-1 rounded-full font-bold">💓 ACTIVA</span>' : ''}
                                </div>
                                <span class="text-sm">${stateLabel}</span>
                            </div>
                        </div>
                        ${session.phoneNumber && session.state === 'READY' ? `
                            <div class="mt-3 p-3 bg-white rounded-lg border">
                                <p class="text-sm"><strong>📞 Número:</strong> ${session.phoneNumber}</p>
                            </div>` : ''}
                        <div class="mt-3 text-xs text-gray-500">
                            <p>📦 Consolidados: <span class="font-bold text-purple-600">${consolidatedCount}</span></p>
                            <p class="mt-1">📥 Recibidos: <span class="font-bold text-green-600">${receivedCount}</span> | 📤 Enviados: <span class="font-bold text-blue-600">${sentCount}</span></p>
                            <p class="mt-1">🌐 IP: <span class="font-mono ${session.proxyInfo?.ip ? 'text-green-600 font-bold' : ''}">${session.proxyInfo?.ip || 'N/A'}</span></p>
                            <p class="mt-1">📍 Ubicación: <span class="font-semibold">${session.proxyInfo?.city || 'Desconocido'}, ${session.proxyInfo?.country || 'Desconocido'}</span> ${session.proxyInfo?.countryCode ? getFlagEmoji(session.proxyInfo.countryCode) : ''}</p>
                        </div>
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

async function loadSearchSessions() {
    try {
        const response = await fetch(`${API_URL}/api/messages/sessions`);
        const data = await response.json();
        
        if (!data.success) return;
        
        const select = document.getElementById('searchSession');
        select.innerHTML = '<option value="">Todas las sesiones</option>';
        
        data.sessions.forEach(session => {
            const option = document.createElement('option');
            option.value = session.session;
            option.textContent = `${session.session} (${session.message_count} msgs)`;
            select.appendChild(option);
        });
    } catch (error) {
        console.error('Error loading sessions:', error);
    }
}

async function searchMessages(offset = 0) {
    try {
        const phone = document.getElementById('searchPhone').value;
        const session = document.getElementById('searchSession').value;
        const startDate = document.getElementById('searchStartDate').value;
        const endDate = document.getElementById('searchEndDate').value;
        const limit = document.getElementById('searchLimit').value;
        
        searchCurrentOffset = offset;
        
        const params = new URLSearchParams();
        if (phone) params.append('phone', phone);
        if (session) params.append('session', session);
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
        searchCurrentData = data.messages; // Guardar datos para ordenamiento
        resetSearchSortIndicators(); // Resetear indicadores al cargar nuevos datos
        document.getElementById('searchResultCount').textContent = `(${data.total} mensajes encontrados)`;
        
        if (data.messages.length === 0) {
            document.getElementById('searchResultsTable').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">No se encontraron mensajes</td></tr>';
            document.getElementById('searchPagination').innerHTML = '';
            return;
        }
        
        // Usar la función de renderizado compartida
        renderSearchResults(data.messages);
        
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
    document.getElementById('searchSession').value = '';
    document.getElementById('searchStartDate').value = '';
    document.getElementById('searchEndDate').value = '';
    document.getElementById('searchLimit').value = '50';
    document.getElementById('searchResultsTable').innerHTML = '<tr><td colspan="6" class="px-4 py-8 text-center text-gray-500">Selecciona filtros y haz clic en Buscar</td></tr>';
    document.getElementById('searchResultCount').textContent = '';
    document.getElementById('searchPagination').innerHTML = '';
    searchCurrentData = [];
    resetSearchSortIndicators();
}

// ======================== ORDENAMIENTO DE TABLAS ========================
function sortSearchTable(column) {
    if (searchCurrentData.length === 0) return;
    
    // Cambiar dirección si es la misma columna
    if (searchSortColumn === column) {
        searchSortDirection = searchSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        searchSortColumn = column;
        searchSortDirection = 'asc';
    }
    
    // Ordenar datos
    const sorted = [...searchCurrentData].sort((a, b) => {
        let valA = a[column];
        let valB = b[column];
        
        // Manejar valores nulos
        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';
        
        // Comparar según tipo
        if (column === 'char_count' || column === 'total' || column === 'enviados' || column === 'errores' || column === 'en_cola') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        } else if (column === 'timestamp') {
            valA = new Date(valA).getTime();
            valB = new Date(valB).getTime();
        } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }
        
        if (valA < valB) return searchSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return searchSortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    
    // Actualizar indicadores visuales
    updateSearchSortIndicators(column);
    
    // Re-renderizar tabla
    renderSearchResults(sorted);
}

function updateSearchSortIndicators(activeColumn) {
    const columns = ['timestamp', 'session', 'phone_number', 'char_count', 'status'];
    columns.forEach(col => {
        const el = document.getElementById(`searchSort_${col}`);
        if (el) {
            el.textContent = col === activeColumn 
                ? (searchSortDirection === 'asc' ? '↑' : '↓')
                : '↕';
        }
    });
}

function resetSearchSortIndicators() {
    const columns = ['timestamp', 'session', 'phone_number', 'char_count', 'status'];
    columns.forEach(col => {
        const el = document.getElementById(`searchSort_${col}`);
        if (el) el.textContent = '↕';
    });
    searchSortColumn = 'timestamp';
    searchSortDirection = 'desc';
}

function renderSearchResults(messages) {
    const html = messages.map(msg => {
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
    await loadSessionTimeoutSettings();
    
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
let selectedSessionTimeout = 10;

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

function setSessionTimeout(minutes) {
    selectedSessionTimeout = minutes;
    
    // Actualizar estilos de botones
    document.querySelectorAll('.session-timeout-btn').forEach(btn => {
        btn.classList.remove('border-green-500', 'bg-green-50');
        btn.classList.add('border-gray-300');
    });
    
    const selectedBtn = document.getElementById(`timeout-${minutes}`);
    if (selectedBtn) {
        selectedBtn.classList.remove('border-gray-300');
        selectedBtn.classList.add('border-green-500', 'bg-green-50');
    }
}

async function saveSessionTimeoutSettings() {
    try {
        const response = await fetch(`${API_URL}/api/settings/session-timeout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ timeout: selectedSessionTimeout })
        });
        
        const data = await response.json();
        
        if (data.success) {
            alert(`✅ Tiempo de sesión configurado a ${selectedSessionTimeout} minutos`);
            // Actualizar el timeout inmediatamente en la sesión actual
            if (typeof updateSessionTimeout === 'function') {
                await updateSessionTimeout();
            }
        } else {
            alert(`❌ Error: ${data.error}`);
        }
    } catch (error) {
        console.error('Error guardando configuración:', error);
        alert('❌ Error de conexión');
    }
}

async function loadSessionTimeoutSettings() {
    try {
        const response = await fetch(`${API_URL}/api/settings/session-timeout`);
        const data = await response.json();
        
        if (data.success && data.timeout) {
            selectedSessionTimeout = data.timeout;
            setSessionTimeout(data.timeout);
        }
    } catch (error) {
        console.error('Error cargando configuración:', error);
    }
}

// ======================== CONVERSACIÓN IA ANTI-BAN ========================
let conversationActive = false;
let conversationAbortController = null;

// Inicializar sliders de conversación
document.addEventListener('DOMContentLoaded', function() {
    const messageCountSlider = document.getElementById('conversationMessageCount');
    const messageCountValue = document.getElementById('conversationMessageCountValue');
    const delaySlider = document.getElementById('conversationDelay');
    const delayValue = document.getElementById('conversationDelayValue');
    
    if (messageCountSlider) {
        messageCountSlider.addEventListener('input', function() {
            messageCountValue.textContent = this.value;
        });
    }
    
    if (delaySlider) {
        delaySlider.addEventListener('input', function() {
            delayValue.textContent = this.value + 's';
        });
    }
});

function populateConversationSessions() {
    const container = document.getElementById('conversationSessionCheckboxes');
    if (!container) return;
    
    const activeSessions = sessions.filter(s => s.state === 'READY');
    
    if (activeSessions.length < 2) {
        container.innerHTML = '<p class="text-red-500 text-sm">⚠️ Necesitas al menos 2 sesiones activas para usar esta función</p>';
        return;
    }
    
    container.innerHTML = activeSessions.map(s => `
        <label class="flex items-center gap-2 p-2 hover:bg-gray-100 rounded cursor-pointer">
            <input type="checkbox" name="conversationSession" value="${s.name}" class="rounded text-purple-500">
            <span class="text-sm">${s.name}</span>
            <span class="text-xs text-gray-400">${s.phoneNumber || ''}</span>
        </label>
    `).join('');
}

function selectAllConversationSessions() {
    document.querySelectorAll('input[name="conversationSession"]').forEach(cb => cb.checked = true);
}

function deselectAllConversationSessions() {
    document.querySelectorAll('input[name="conversationSession"]').forEach(cb => cb.checked = false);
}

function getSelectedConversationSessions() {
    return Array.from(document.querySelectorAll('input[name="conversationSession"]:checked')).map(cb => cb.value);
}

function addConversationLog(message, type = 'info') {
    const log = document.getElementById('conversationLog');
    if (!log) return;
    
    const colors = {
        info: 'text-blue-400',
        sent: 'text-green-400',
        received: 'text-yellow-400',
        error: 'text-red-400',
        system: 'text-purple-400'
    };
    
    const time = new Date().toLocaleTimeString('es-CO');
    const entry = document.createElement('div');
    entry.className = colors[type] || 'text-gray-400';
    entry.innerHTML = `<span class="text-gray-500">[${time}]</span> ${message}`;
    
    // Limpiar mensaje inicial si existe
    if (log.querySelector('p.text-gray-500')) {
        log.innerHTML = '';
    }
    
    log.appendChild(entry);
    log.scrollTop = log.scrollHeight;
}

function clearConversationLog() {
    const log = document.getElementById('conversationLog');
    if (log) {
        log.innerHTML = '<p class="text-gray-500">Esperando inicio de conversación...</p>';
    }
}

async function startAIConversation() {
    const selectedSessions = getSelectedConversationSessions();
    const topic = document.getElementById('conversationTopic')?.value?.trim();
    const messageCount = parseInt(document.getElementById('conversationMessageCount')?.value) || 5;
    const delay = parseInt(document.getElementById('conversationDelay')?.value) || 15;
    const style = document.getElementById('conversationStyle')?.value || 'casual';
    
    if (selectedSessions.length < 2) {
        showToast('Selecciona al menos 2 sesiones', 'error');
        return;
    }
    
    if (!topic) {
        showToast('Escribe un tema para iniciar la conversación', 'error');
        return;
    }
    
    conversationActive = true;
    conversationAbortController = new AbortController();
    
    // Actualizar UI
    document.getElementById('startConversationBtn').classList.add('hidden');
    document.getElementById('stopConversationBtn').classList.remove('hidden');
    document.getElementById('conversationStatus').innerHTML = `
        <div class="bg-purple-50 border border-purple-200 rounded-lg p-4">
            <div class="flex items-center gap-2">
                <div class="animate-spin rounded-full h-4 w-4 border-2 border-purple-600 border-t-transparent"></div>
                <span class="text-purple-700">Conversación en progreso...</span>
            </div>
        </div>
    `;
    
    clearConversationLog();
    addConversationLog(`🚀 Iniciando conversación entre ${selectedSessions.length} sesiones`, 'system');
    addConversationLog(`📝 Tema: "${topic}"`, 'system');
    addConversationLog(`💬 Mensajes por sesión: ${messageCount} | Delay: ${delay}s | Estilo: ${style}`, 'system');
    
    try {
        const response = await fetch(`${API_URL}/api/conversation/start`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sessions: selectedSessions,
                topic,
                messageCount,
                delay,
                style
            }),
            signal: conversationAbortController.signal
        });
        
        const data = await response.json();
        
        if (data.success) {
            addConversationLog(`✅ Conversación iniciada exitosamente`, 'system');
            
            // Mostrar mensajes del log
            if (data.messages) {
                data.messages.forEach(msg => {
                    const type = msg.direction === 'sent' ? 'sent' : 'received';
                    addConversationLog(`${msg.from} → ${msg.to}: ${msg.text}`, type);
                });
            }
            
            addConversationLog(`🏁 Conversación completada: ${data.totalMessages || 0} mensajes enviados`, 'system');
        } else {
            addConversationLog(`❌ Error: ${data.error}`, 'error');
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            addConversationLog('⏹️ Conversación detenida por el usuario', 'system');
        } else {
            addConversationLog(`❌ Error: ${error.message}`, 'error');
        }
    } finally {
        stopAIConversation();
    }
}

function stopAIConversation() {
    conversationActive = false;
    if (conversationAbortController) {
        conversationAbortController.abort();
        conversationAbortController = null;
    }
    
    document.getElementById('startConversationBtn').classList.remove('hidden');
    document.getElementById('stopConversationBtn').classList.add('hidden');
    document.getElementById('conversationStatus').innerHTML = '';
}

// ======================== OPENAI BALANCE ========================

async function loadOpenAIBalance() {
    const balanceDiv = document.getElementById('openaiBalanceInfo');
    const contentDiv = document.getElementById('openaiBalanceContent');
    
    balanceDiv.classList.remove('hidden');
    balanceDiv.className = 'bg-green-50 border border-green-200 rounded-lg p-3 mb-4';
    contentDiv.innerHTML = '<div class="flex items-center gap-2"><span class="animate-spin">⏳</span> Consultando saldo de OpenAI...</div>';
    
    try {
        const response = await fetch(`${API_URL}/api/openai/balance`);
        const data = await response.json();
        
        if (data.success && data.apiConfigured) {
            let html = '<strong>✅ API de OpenAI configurada correctamente</strong><br>';
            
            // Mostrar balance si está disponible
            if (data.balance) {
                const hardLimit = data.balance.hard_limit_usd || 0;
                const softLimit = data.balance.soft_limit_usd || 0;
                const systemHardLimit = data.balance.system_hard_limit_usd || 0;
                
                html += `<div class="mt-2 space-y-1">`;
                if (hardLimit > 0) {
                    html += `<div class="text-sm">💳 Límite de cuenta: <strong class="text-green-700">$${hardLimit.toFixed(2)}</strong></div>`;
                }
                if (softLimit > 0 && softLimit !== hardLimit) {
                    html += `<div class="text-sm">⚠️ Límite suave: $${softLimit.toFixed(2)}</div>`;
                }
                html += `</div>`;
            }
            
            // Mostrar créditos si están disponibles
            if (data.credits && data.credits.total_granted > 0) {
                const totalGranted = data.credits.total_granted || 0;
                const totalUsed = data.credits.total_used || 0;
                const totalAvailable = data.credits.total_available || 0;
                
                html += `<div class="mt-2 space-y-1">`;
                html += `<div class="text-sm">🎁 Créditos otorgados: $${totalGranted.toFixed(2)}</div>`;
                html += `<div class="text-sm">📊 Créditos usados: $${totalUsed.toFixed(2)}</div>`;
                html += `<div class="text-sm">💰 Créditos disponibles: <strong class="text-green-700">$${totalAvailable.toFixed(2)}</strong></div>`;
                html += `</div>`;
            }
            
            // Mostrar uso del mes actual
            if (data.usage && data.usage.total_usage) {
                const totalUsage = (data.usage.total_usage / 100).toFixed(2); // Convertir de centavos a dólares
                html += `<div class="mt-2 text-sm">📈 Uso este mes: $${totalUsage}</div>`;
            }
            
            if (data.message && !data.balance && !data.credits) {
                html += `<div class="text-xs mt-1">${data.message}</div>`;
            }
            
            if (data.dashboardUrl) {
                html += `<br><a href="${data.dashboardUrl}" target="_blank" class="text-blue-600 hover:underline text-xs mt-2 inline-block">
                    🔗 Ver detalles completos en OpenAI Dashboard →
                </a>`;
            }
            
            contentDiv.innerHTML = html;
            
            // Auto-ocultar después de 15 segundos
            setTimeout(() => {
                balanceDiv.classList.add('hidden');
            }, 15000);
        } else {
            contentDiv.innerHTML = `<strong>⚠️ ${data.error || 'No se pudo obtener información'}</strong>`;
            balanceDiv.className = 'bg-red-50 border border-red-200 rounded-lg p-3 mb-4';
        }
    } catch (error) {
        contentDiv.innerHTML = `<strong>❌ Error al consultar: ${error.message}</strong>`;
        balanceDiv.className = 'bg-red-50 border border-red-200 rounded-lg p-3 mb-4';
    }
}
