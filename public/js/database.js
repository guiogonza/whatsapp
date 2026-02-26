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
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem;">
            <div style="background: white; border-radius: 8px; padding: 12px; border: 1px solid #86efac;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-size: 1.25rem;">✅</span>
                    <span style="font-size: 0.875rem; font-weight: 600; color: #374151;">Estado</span>
                </div>
                <div style="color: #16a34a; font-weight: bold;">Conectado</div>
            </div>
            
            <div style="background: white; border-radius: 8px; padding: 12px; border: 1px solid #e5e7eb;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-size: 1.25rem;">🗄️</span>
                    <span style="font-size: 0.875rem; font-weight: 600; color: #374151;">Base de Datos</span>
                </div>
                <div style="color: #111827; font-family: monospace; font-size: 0.875rem;">${data.database}</div>
            </div>
            
            <div style="background: white; border-radius: 8px; padding: 12px; border: 1px solid #e5e7eb;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-size: 1.25rem;">📦</span>
                    <span style="font-size: 0.875rem; font-weight: 600; color: #374151;">Versión</span>
                </div>
                <div style="color: #111827; font-family: monospace; font-size: 0.875rem;">PostgreSQL ${version}</div>
            </div>
            
            <div style="background: white; border-radius: 8px; padding: 12px; border: 1px solid #e5e7eb;">
                <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 4px;">
                    <span style="font-size: 1.25rem;">💾</span>
                    <span style="font-size: 0.875rem; font-weight: 600; color: #374151;">Tamaño</span>
                </div>
                <div style="color: #111827; font-weight: bold;">${data.size}</div>
            </div>
        </div>
        
        <div style="margin-top: 1rem; background: white; border-radius: 8px; padding: 12px; border: 1px solid #e5e7eb;">
            <div style="font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 8px;">📊 Estadísticas</div>
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; text-align: center;">
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #2563eb;">${(data.stats?.total_messages || 0).toLocaleString()}</div>
                    <div style="font-size: 0.75rem; color: #4b5563;">Mensajes Totales</div>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #7c3aed;">${(data.stats?.unique_phones || 0).toLocaleString()}</div>
                    <div style="font-size: 0.75rem; color: #4b5563;">Números Únicos</div>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #ca8a04;">${(data.stats?.gpswox_alerts || 0).toLocaleString()}</div>
                    <div style="font-size: 0.75rem; color: #4b5563;">Alertas GPSwox</div>
                </div>
                <div>
                    <div style="font-size: 1.5rem; font-weight: bold; color: #16a34a;">${(data.stats?.fx_forwards || 0).toLocaleString()}</div>
                    <div style="font-size: 0.75rem; color: #4b5563;">Reenvíos FX</div>
                </div>
            </div>
        </div>
    `;
    
    console.log('✅ innerHTML asignado, contenido:', statusContent.innerHTML.substring(0, 100));
    
    // Renderizar tablas
    renderDatabaseTables(data.tables);
}

/**
 * Renderizar estado desconectado
 */
function renderDatabaseDisconnected(error) {
    const statusContent = document.getElementById('dbStatusContent');
    
    statusContent.innerHTML = `
        <div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 16px;">
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                <span style="font-size: 2rem;">❌</span>
                <div>
                    <div style="color: #b91c1c; font-weight: bold; font-size: 1.125rem;">Base de Datos Desconectada</div>
                    <div style="color: #dc2626; font-size: 0.875rem;">No se pudo establecer conexión con PostgreSQL</div>
                </div>
            </div>
            <div style="margin-top: 12px; padding: 12px; background: white; border-radius: 4px; border: 1px solid #fecaca;">
                <div style="font-size: 0.75rem; font-family: monospace; color: #374151;">${error}</div>
            </div>
        </div>
    `;
    
    // Limpiar tablas
    const tablesContent = document.getElementById('dbTablesContent');
    tablesContent.innerHTML = '<div style="text-align: center; color: #ef4444; padding: 1rem;">❌ No se puede obtener información de tablas</div>';
}

/**
 * Renderizar información de tablas
 */
function renderDatabaseTables(tables) {
    const tablesContent = document.getElementById('dbTablesContent');
    
    if (!tables || tables.length === 0) {
        tablesContent.innerHTML = '<div style="text-align: center; color: #6b7280; padding: 1rem;">No hay tablas disponibles</div>';
        return;
    }
    
    let html = `
        <table style="width: 100%; font-size: 0.875rem; border-collapse: collapse;">
            <thead style="background: #f3f4f6; border-bottom: 2px solid #e5e7eb;">
                <tr>
                    <th style="text-align: left; padding: 12px 16px; font-weight: 600;">Tabla</th>
                    <th style="text-align: right; padding: 12px 16px; font-weight: 600;">Registros</th>
                    <th style="text-align: right; padding: 12px 16px; font-weight: 600;">Tamaño</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    tables.forEach((table, index) => {
        const bgColor = index % 2 === 0 ? '#ffffff' : '#f9fafb';
        html += `
            <tr style="background: ${bgColor};">
                <td style="padding: 12px 16px;">
                    <div style="display: flex; align-items: center; gap: 8px;">
                        <span>📋</span>
                        <span style="font-family: monospace; font-weight: 600;">${table.tablename}</span>
                    </div>
                </td>
                <td style="padding: 12px 16px; text-align: right; font-family: monospace;">${(table.row_count || 0).toLocaleString()}</td>
                <td style="padding: 12px 16px; text-align: right; font-family: monospace; color: #4b5563;">${table.size || 'N/A'}</td>
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
