// ======================== BASE DE DATOS MONITOR ========================

const DB_API_URL = window.location.origin;
let dbRefreshInterval = null;

/**
 * Inicializar monitor de base de datos
 */
function initDatabase() {
    console.log('🗄️ Inicializando monitor de base de datos...');
    refreshDatabaseStatus();
    
    // Auto-refresh cada 30 segundos
    if (dbRefreshInterval) clearInterval(dbRefreshInterval);
    dbRefreshInterval = setInterval(refreshDatabaseStatus, 30000);
}

/**
 * Refrescar estado de la base de datos
 */
async function refreshDatabaseStatus() {
    console.log('🔄 Refrescando estado de BD...');
    try {
        const response = await fetch(`${DB_API_URL}/api/database/status`);
        const data = await response.json();
        console.log('📊 Datos recibidos:', data);
        
        if (data.success && data.connected) {
            renderDatabaseConnected(data);
        } else {
            renderDatabaseDisconnected(data.error || 'No se pudo conectar');
        }
    } catch (error) {
        console.error('❌ Error obteniendo estado de BD:', error);
        renderDatabaseDisconnected(error.message);
    }
}

/**
 * Renderizar estado conectado
 */
function renderDatabaseConnected(data) {
    console.log('🎨 Ejecutando renderDatabaseConnected...');
    const statusContent = document.getElementById('dbStatusContent');
    console.log('📍 Elemento dbStatusContent:', statusContent);
    
    if (!statusContent) {
        console.error('❌ No se encontró elemento dbStatusContent');
        return;
    }
    
    // Extraer versión simple
    const versionMatch = data.version.match(/PostgreSQL ([\d.]+)/);
    const version = versionMatch ? versionMatch[1] : 'Unknown';
    
    statusContent.innerHTML = `
        <div class="grid grid-cols-2 gap-4">
            <div class="bg-white rounded-lg p-3 border border-green-200">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-green-500 text-xl">✅</span>
                    <span class="text-sm font-semibold text-gray-700">Estado</span>
                </div>
                <div class="text-green-600 font-bold">Conectado</div>
            </div>
            
            <div class="bg-white rounded-lg p-3 border">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-blue-500 text-xl">🗄️</span>
                    <span class="text-sm font-semibold text-gray-700">Base de Datos</span>
                </div>
                <div class="text-gray-900 font-mono text-sm">${data.database}</div>
            </div>
            
            <div class="bg-white rounded-lg p-3 border">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-purple-500 text-xl">📦</span>
                    <span class="text-sm font-semibold text-gray-700">Versión</span>
                </div>
                <div class="text-gray-900 font-mono text-sm">PostgreSQL ${version}</div>
            </div>
            
            <div class="bg-white rounded-lg p-3 border">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-orange-500 text-xl">💾</span>
                    <span class="text-sm font-semibold text-gray-700">Tamaño</span>
                </div>
                <div class="text-gray-900 font-bold">${data.size}</div>
            </div>
        </div>
        
        <div class="mt-4 bg-white rounded-lg p-3 border">
            <div class="text-sm font-semibold text-gray-700 mb-2">📊 Estadísticas</div>
            <div class="grid grid-cols-3 gap-3 text-center">
                <div>
                    <div class="text-2xl font-bold text-blue-600">${data.stats.total_messages.toLocaleString()}</div>
                    <div class="text-xs text-gray-600">Mensajes Totales</div>
                </div>
                <div>
                    <div class="text-2xl font-bold text-yellow-600">${data.stats.queue_total.toLocaleString()}</div>
                    <div class="text-xs text-gray-600">En Cola (Total)</div>
                </div>
                <div>
                    <div class="text-2xl font-bold text-green-600">${data.stats.queue_pending.toLocaleString()}</div>
                    <div class="text-xs text-gray-600">Pendientes</div>
                </div>
            </div>
        </div>
    `;
    
    // Renderizar tablas
    renderDatabaseTables(data.tables);
}

/**
 * Renderizar estado desconectado
 */
function renderDatabaseDisconnected(error) {
    const statusContent = document.getElementById('dbStatusContent');
    
    statusContent.innerHTML = `
        <div class="bg-red-50 border border-red-200 rounded-lg p-4">
            <div class="flex items-center gap-3 mb-2">
                <span class="text-red-500 text-3xl">❌</span>
                <div>
                    <div class="text-red-700 font-bold text-lg">Base de Datos Desconectada</div>
                    <div class="text-red-600 text-sm">No se pudo establecer conexión con PostgreSQL</div>
                </div>
            </div>
            <div class="mt-3 p-3 bg-white rounded border border-red-200">
                <div class="text-xs font-mono text-gray-700">${error}</div>
            </div>
        </div>
    `;
    
    // Limpiar tablas
    const tablesContent = document.getElementById('dbTablesContent');
    tablesContent.innerHTML = '<div class="text-center text-red-500 py-4">❌ No se puede obtener información de tablas</div>';
}

/**
 * Renderizar información de tablas
 */
function renderDatabaseTables(tables) {
    const tablesContent = document.getElementById('dbTablesContent');
    
    if (!tables || tables.length === 0) {
        tablesContent.innerHTML = '<div class="text-center text-gray-500 py-4">No hay tablas disponibles</div>';
        return;
    }
    
    let html = `
        <table class="min-w-full text-sm">
            <thead class="bg-gray-100 border-b-2">
                <tr>
                    <th class="text-left py-3 px-4 font-semibold">Tabla</th>
                    <th class="text-right py-3 px-4 font-semibold">Registros</th>
                    <th class="text-right py-3 px-4 font-semibold">Tamaño</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    tables.forEach((table, index) => {
        const bgClass = index % 2 === 0 ? 'bg-white' : 'bg-gray-50';
        html += `
            <tr class="${bgClass} hover:bg-blue-50 transition-colors">
                <td class="py-3 px-4">
                    <div class="flex items-center gap-2">
                        <span class="text-blue-500">📋</span>
                        <span class="font-mono font-semibold">${table.tablename}</span>
                    </div>
                </td>
                <td class="py-3 px-4 text-right font-mono">${(table.row_count || 0).toLocaleString()}</td>
                <td class="py-3 px-4 text-right font-mono text-gray-600">${table.size || 'N/A'}</td>
            </tr>
        `;
    });
    
    html += `
            </tbody>
        </table>
    `;
    
    tablesContent.innerHTML = html;
}

// Auto-inicializar cuando se muestra la sección
document.addEventListener('DOMContentLoaded', () => {
    const originalShowSection = window.showSection;
    window.showSection = function(section) {
        originalShowSection(section);
        if (section === 'database') {
            initDatabase();
        }
    };
});
