// ======================== ANALYTICS DASHBOARD ========================

// Registrar plugin de datalabels para Chart.js
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

let analyticsTimelineChart = null;
let analyticsTopChart = null;
let analyticsInitialized = false;
let analyticsRefreshInterval = null;
let analyticsTopData = []; // Guardar datos para filtrado
let analyticsSelectedPhone = null; // Número seleccionado
let analyticsSelectedMessages = { total: 0, offset: 0, limit: 50 }; // Estado de paginación

// Variables para ordenamiento de tabla analytics
let analyticsSortColumn = 'total';
let analyticsSortDirection = 'desc';

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function initAnalytics() {
    if (analyticsInitialized) {
        refreshAnalytics();
        return;
    }
    
    analyticsInitialized = true;
    
    // Configurar fechas por defecto
    const today = new Date();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    document.getElementById('analyticsEndDate').value = today.toISOString().split('T')[0];
    document.getElementById('analyticsStartDate').value = weekAgo.toISOString().split('T')[0];
    
    // Configurar selectores de fecha
    document.getElementById('analyticsDayPicker').value = today.toISOString().split('T')[0];
    
    // Configurar selector de semana (formato: YYYY-Www)
    const weekNum = getWeekNumber(today);
    document.getElementById('analyticsWeekPicker').value = `${today.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    
    // Configurar selector de mes (formato: YYYY-MM)
    document.getElementById('analyticsMonthPicker').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Configurar selector de año
    initYearPicker();
    
    // Event listeners
    document.getElementById('analyticsPeriod').addEventListener('change', () => {
        updateAnalyticsRangeOptions();
        refreshAnalytics();
    });
    
    document.getElementById('analyticsDayPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
    });
    
    document.getElementById('analyticsWeekPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
    });
    
    document.getElementById('analyticsMonthPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
    });
    
    document.getElementById('analyticsYearPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
    });
    
    document.getElementById('analyticsTopN').addEventListener('change', refreshAnalytics);
    document.getElementById('analyticsTopNChart').addEventListener('change', refreshAnalytics);
    document.getElementById('analyticsStartDate').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
    });
    document.getElementById('analyticsEndDate').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
    });
    
    updateAnalyticsRangeOptions();
    refreshAnalytics();
    
    // Auto-refresh cada 30 segundos
    if (analyticsRefreshInterval) clearInterval(analyticsRefreshInterval);
    analyticsRefreshInterval = setInterval(refreshAnalytics, 30000);
}

// Función auxiliar para obtener número de semana
function getWeekNumber(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

// Función para inicializar selector de años
function initYearPicker() {
    const yearPicker = document.getElementById('analyticsYearPicker');
    const currentYear = new Date().getFullYear();
    yearPicker.innerHTML = '';
    
    for (let year = currentYear; year >= currentYear - 5; year--) {
        const option = document.createElement('option');
        option.value = year;
        option.textContent = year;
        yearPicker.appendChild(option);
    }
}

// Función para obtener fechas de una semana desde string "YYYY-Www"
function getWeekDates(weekString) {
    const [year, week] = weekString.split('-W').map(Number);
    const jan1 = new Date(year, 0, 1);
    
    // Encontrar el primer lunes del año
    const dayOfWeek = jan1.getDay();
    const firstMonday = new Date(jan1);
    firstMonday.setDate(jan1.getDate() + (dayOfWeek <= 1 ? 1 - dayOfWeek : 8 - dayOfWeek));
    
    // Calcular inicio de la semana seleccionada
    const weekStart = new Date(firstMonday);
    weekStart.setDate(firstMonday.getDate() + (week - 1) * 7);
    
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekStart.getDate() + 6);
    
    return { start: weekStart, end: weekEnd };
}

function updateAnalyticsRangeOptions() {
    const period = document.getElementById('analyticsPeriod').value;
    const dayContainer = document.getElementById('analyticsDayContainer');
    const weekContainer = document.getElementById('analyticsWeekContainer');
    const monthContainer = document.getElementById('analyticsMonthContainer');
    const yearContainer = document.getElementById('analyticsYearContainer');
    const customDateContainer = document.getElementById('analyticsCustomDateContainer');
    const customDateContainer2 = document.getElementById('analyticsCustomDateContainer2');
    
    // Ocultar todos los contenedores
    dayContainer.classList.add('hidden');
    weekContainer.classList.add('hidden');
    monthContainer.classList.add('hidden');
    yearContainer.classList.add('hidden');
    customDateContainer.classList.add('hidden');
    customDateContainer2.classList.add('hidden');
    
    // Mostrar el contenedor correspondiente
    if (period === 'day') {
        dayContainer.classList.remove('hidden');
    } else if (period === 'week') {
        weekContainer.classList.remove('hidden');
    } else if (period === 'month') {
        monthContainer.classList.remove('hidden');
    } else if (period === 'year') {
        yearContainer.classList.remove('hidden');
    } else if (period === 'custom') {
        customDateContainer.classList.remove('hidden');
        customDateContainer2.classList.remove('hidden');
    }
    
    updateAnalyticsPeriodInfo();
}

function updateAnalyticsPeriodInfo() {
    const period = document.getElementById('analyticsPeriod').value;
    const currentPeriodInfo = document.getElementById('analyticsCurrentPeriodInfo');
    
    if (period === 'day') {
        const dayPicker = document.getElementById('analyticsDayPicker').value;
        const date = new Date(dayPicker + 'T00:00:00');
        const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
        currentPeriodInfo.textContent = date.toLocaleDateString('es-CO', options);
    } else if (period === 'week') {
        const weekPicker = document.getElementById('analyticsWeekPicker').value;
        if (weekPicker) {
            const { start, end } = getWeekDates(weekPicker);
            currentPeriodInfo.textContent = `Semana del ${start.toLocaleDateString('es-CO')} al ${end.toLocaleDateString('es-CO')}`;
        }
    } else if (period === 'month') {
        const monthPicker = document.getElementById('analyticsMonthPicker').value;
        if (monthPicker) {
            const [year, month] = monthPicker.split('-');
            const date = new Date(year, month - 1, 1);
            const options = { year: 'numeric', month: 'long' };
            currentPeriodInfo.textContent = date.toLocaleDateString('es-CO', options);
        }
    } else if (period === 'year') {
        const yearPicker = document.getElementById('analyticsYearPicker').value;
        currentPeriodInfo.textContent = `Año ${yearPicker}`;
    } else if (period === 'custom') {
        const startDate = document.getElementById('analyticsStartDate').value;
        const endDate = document.getElementById('analyticsEndDate').value;
        currentPeriodInfo.textContent = `Del ${startDate} al ${endDate}`;
    }
}

// Obtener rango de fechas según el período seleccionado
function getAnalyticsDateRange() {
    const period = document.getElementById('analyticsPeriod').value;
    let startDate, endDate;
    
    if (period === 'day') {
        const dayPicker = document.getElementById('analyticsDayPicker').value;
        startDate = dayPicker;
        endDate = dayPicker;
    } else if (period === 'week') {
        const weekPicker = document.getElementById('analyticsWeekPicker').value;
        if (weekPicker) {
            const { start, end } = getWeekDates(weekPicker);
            startDate = start.toISOString().split('T')[0];
            endDate = end.toISOString().split('T')[0];
        }
    } else if (period === 'month') {
        const monthPicker = document.getElementById('analyticsMonthPicker').value;
        if (monthPicker) {
            const [year, month] = monthPicker.split('-').map(Number);
            const firstDay = new Date(year, month - 1, 1);
            const lastDay = new Date(year, month, 0);
            startDate = firstDay.toISOString().split('T')[0];
            endDate = lastDay.toISOString().split('T')[0];
        }
    } else if (period === 'year') {
        const yearPicker = document.getElementById('analyticsYearPicker').value;
        startDate = `${yearPicker}-01-01`;
        endDate = `${yearPicker}-12-31`;
    } else if (period === 'custom') {
        startDate = document.getElementById('analyticsStartDate').value;
        endDate = document.getElementById('analyticsEndDate').value;
    }
    
    return { startDate, endDate };
}

async function fetchAnalyticsData() {
    const period = document.getElementById('analyticsPeriod').value;
    const topN = document.getElementById('analyticsTopNChart')?.value || document.getElementById('analyticsTopN').value;
    const statusBadge = document.getElementById('analyticsStatusBadge');
    
    try {
        const { startDate, endDate } = getAnalyticsDateRange();
        const params = new URLSearchParams({ 
            period: 'custom', 
            start_date: startDate, 
            end_date: endDate, 
            top: topN 
        });
        
        statusBadge.textContent = 'Cargando...';
        statusBadge.className = 'px-2 py-1 text-xs rounded-full bg-yellow-200 text-yellow-800';
        
        const res = await fetch(`${API_URL}/api/analytics/messages?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        
        statusBadge.textContent = 'OK';
        statusBadge.className = 'px-2 py-1 text-xs rounded-full bg-green-200 text-green-800';
        return res.json();
    } catch (error) {
        statusBadge.textContent = 'Error';
        statusBadge.className = 'px-2 py-1 text-xs rounded-full bg-red-200 text-red-800';
        throw error;
    }
}

async function fetchAnalyticsHealth() {
    try {
        const res = await fetch(`${API_URL}/health`);
        if (res.ok) return res.json();
    } catch (e) { console.error('Error fetching health:', e); }
    return null;
}

function updateAnalyticsKPIs(timeline) {
    const sum = (arr, key) => arr.reduce((acc, x) => acc + (Number(x[key]) || 0), 0);
    
    if (!timeline || timeline.length === 0) {
        ['analytics_kpi_total', 'analytics_kpi_enviados', 'analytics_kpi_errores', 'analytics_kpi_cola'].forEach(id => {
            document.getElementById(id).textContent = '0';
        });
        return;
    }
    document.getElementById('analytics_kpi_total').textContent = sum(timeline, 'total').toLocaleString();
    document.getElementById('analytics_kpi_enviados').textContent = sum(timeline, 'enviados').toLocaleString();
    document.getElementById('analytics_kpi_errores').textContent = sum(timeline, 'errores').toLocaleString();
    document.getElementById('analytics_kpi_cola').textContent = sum(timeline, 'en_cola').toLocaleString();
}

function updateAnalyticsSystemStatus(health) {
    if (!health) return;
    
    const rotation = health.rotation_info || {};
    const sent = rotation.messages_sent_current || 0;
    const max = rotation.max_per_session || 100;
    
    document.getElementById('analyticsCurrentSession').textContent = rotation.current_session || '—';
    document.getElementById('analyticsSessionProgress').textContent = `${sent}/${max}`;
    
    const progressPercentage = max > 0 ? (sent / max) * 100 : 0;
    document.getElementById('analyticsProgressBar').style.width = `${Math.min(progressPercentage, 100)}%`;
    
    const sessions = health.available_sessions || [];
    document.getElementById('analyticsAvailableSessions').textContent = sessions.length > 0 ? sessions.join(', ') : '—';
}

function updateAnalyticsFooter(db_stats) {
    document.getElementById('analyticsDbSize').textContent = db_stats?.db_size_mb ?? '—';
    const byStatus = db_stats?.total_by_status || {};
    document.getElementById('analyticsDbByStatus').textContent = Object.entries(byStatus).map(([k, v]) => `${k}: ${v.toLocaleString()}`).join(' | ') || '—';
    document.getElementById('analyticsLastUpdate').textContent = new Date().toLocaleTimeString('es-CO');
}

function buildAnalyticsTimelineChart(ctx, labels, enviados, errores, cola, chartType = 'line') {
    if (analyticsTimelineChart) analyticsTimelineChart.destroy();
    
    const datasets = [
        { label: 'Enviados', data: enviados, tension: 0.35, borderColor: '#10b981', backgroundColor: 'rgba(16, 185, 129, 0.8)', fill: false },
        { label: 'Errores', data: errores, tension: 0.35, borderColor: '#ef4444', backgroundColor: 'rgba(239, 68, 68, 0.8)', fill: false },
        { label: 'En cola', data: cola, tension: 0.35, borderColor: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.8)', fill: false },
    ];
    
    const stacked = chartType === 'bar';
    
    analyticsTimelineChart = new Chart(ctx, {
        type: chartType,
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: { mode: 'index', intersect: false },
                datalabels: { display: false }
            },
            interaction: { mode: 'index', intersect: false },
            scales: {
                y: { beginAtZero: true, stacked, ticks: { precision: 0 } },
                x: { stacked }
            }
        }
    });
}

function buildAnalyticsTopChart(ctx, labels, totals, fullData) {
    if (analyticsTopChart) analyticsTopChart.destroy();
    
    // Guardar datos para filtrado
    analyticsTopData = fullData;
    
    // Resetear ordenamiento al cargar nuevos datos
    resetAnalyticsSortIndicators();
    
    analyticsTopChart = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels.map(l => String(l).length > 12 ? String(l).substring(0, 12) + '...' : l),
            datasets: [{
                label: 'Total mensajes',
                data: totals,
                backgroundColor: labels.map((l, i) =>
                    analyticsSelectedPhone === fullData[i]?.phone_number
                        ? 'rgba(147, 51, 234, 0.9)'
                        : 'rgba(59, 130, 246, 0.8)'
                ),
                borderColor: labels.map((l, i) =>
                    analyticsSelectedPhone === fullData[i]?.phone_number
                        ? '#9333ea'
                        : '#3b82f6'
                ),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            onClick: (event, elements) => {
                if (elements.length > 0) {
                    const index = elements[0].index;
                    const phoneData = fullData[index];
                    if (phoneData) {
                        selectAnalyticsPhone(phoneData.phone_number, index);
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } },
                datalabels: {
                    anchor: 'end',
                    align: 'top',
                    color: '#374151',
                    font: { weight: 'bold', size: 12 },
                    formatter: (value) => value.toLocaleString()
                }
            },
            scales: {
                y: { beginAtZero: true, ticks: { precision: 0 } },
                x: { grid: { display: false } }
            }
        }
    });
}

function selectAnalyticsPhone(phone, index) {
    analyticsSelectedPhone = phone;
    
    // Actualizar título
    document.getElementById('analyticsDetailTitle').textContent = `- ${phone}`;
    document.getElementById('analyticsClearFilterBtn').classList.remove('hidden');
    loadAnalyticsMessagesForPhone(phone);
    
    // Filtrar tabla a solo ese número
    const filtered = analyticsTopData.filter(r => r.phone_number === phone);
    updateAnalyticsTopTable(filtered, true);
    
    // Actualizar colores del gráfico
    if (analyticsTopChart) {
        analyticsTopChart.data.datasets[0].backgroundColor = analyticsTopData.map((d, i) =>
            d.phone_number === phone ? 'rgba(147, 51, 234, 0.9)' : 'rgba(59, 130, 246, 0.8)'
        );
        analyticsTopChart.data.datasets[0].borderColor = analyticsTopData.map((d, i) =>
            d.phone_number === phone ? '#9333ea' : '#3b82f6'
        );
        analyticsTopChart.update();
    }
}

function clearAnalyticsFilter() {
    analyticsSelectedPhone = null;
    document.getElementById('analyticsDetailTitle').textContent = '';
    document.getElementById('analyticsClearFilterBtn').classList.add('hidden');
    hideAnalyticsSelectedMessages();
    
    // Restaurar tabla completa
    updateAnalyticsTopTable(analyticsTopData);
    
    // Restaurar colores del gráfico
    if (analyticsTopChart) {
        analyticsTopChart.data.datasets[0].backgroundColor = analyticsTopData.map(() => 'rgba(59, 130, 246, 0.8)');
        analyticsTopChart.data.datasets[0].borderColor = analyticsTopData.map(() => '#3b82f6');
        analyticsTopChart.update();
    }
}

function updateAnalyticsTopTable(rows, isFiltered = false) {
    const tbody = document.getElementById('analyticsTopTableBody');
    tbody.innerHTML = '';
    
    if (!rows || rows.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-gray-500">No hay datos disponibles</td></tr>';
        return;
    }
    
    rows.forEach((r, i) => {
        const tr = document.createElement('tr');
        const isSelected = analyticsSelectedPhone && r.phone_number === analyticsSelectedPhone;
        tr.className = isSelected ? 'bg-purple-50' : (i % 2 ? 'bg-gray-50' : '');
        tr.innerHTML = `
            <td class="py-2 pr-4 font-semibold">${i + 1}</td>
            <td class="py-2 pr-4 font-mono text-sm ${isSelected ? 'text-purple-700 font-bold' : ''}">${r.phone_number || '—'}</td>
            <td class="py-2 pr-4 font-semibold">${(r.total || 0).toLocaleString()}</td>
            <td class="py-2 pr-4 text-green-600">${(r.enviados || 0).toLocaleString()}</td>
            <td class="py-2 pr-4 text-red-600">${(r.errores || 0).toLocaleString()}</td>
            <td class="py-2 pr-4 text-yellow-600">${(r.en_cola || 0).toLocaleString()}</td>
        `;
        
        // Hacer fila clickeable
        tr.style.cursor = 'pointer';
        tr.addEventListener('click', () => selectAnalyticsPhone(r.phone_number, i));
        
        tbody.appendChild(tr);
    });
}

// ======================== ORDENAMIENTO DE TABLA ANALYTICS ========================
function sortAnalyticsTable(column) {
    if (!analyticsTopData || analyticsTopData.length === 0) return;
    
    // Cambiar dirección si es la misma columna
    if (analyticsSortColumn === column) {
        analyticsSortDirection = analyticsSortDirection === 'asc' ? 'desc' : 'asc';
    } else {
        analyticsSortColumn = column;
        analyticsSortDirection = 'desc'; // Por defecto descendente para números
    }
    
    // Ordenar datos
    const sorted = [...analyticsTopData].sort((a, b) => {
        let valA = a[column];
        let valB = b[column];
        
        // Manejar valores nulos
        if (valA === null || valA === undefined) valA = '';
        if (valB === null || valB === undefined) valB = '';
        
        // Comparar según tipo
        if (column === 'total' || column === 'enviados' || column === 'errores' || column === 'en_cola') {
            valA = Number(valA) || 0;
            valB = Number(valB) || 0;
        } else {
            valA = String(valA).toLowerCase();
            valB = String(valB).toLowerCase();
        }
        
        if (valA < valB) return analyticsSortDirection === 'asc' ? -1 : 1;
        if (valA > valB) return analyticsSortDirection === 'asc' ? 1 : -1;
        return 0;
    });
    
    // Actualizar indicadores visuales
    updateAnalyticsSortIndicators(column);
    
    // Re-renderizar tabla con datos ordenados
    updateAnalyticsTopTable(sorted);
}

function updateAnalyticsSortIndicators(activeColumn) {
    const columns = ['phone_number', 'total', 'enviados', 'errores', 'en_cola'];
    columns.forEach(col => {
        const el = document.getElementById(`analyticsSort_${col}`);
        if (el) {
            el.textContent = col === activeColumn 
                ? (analyticsSortDirection === 'asc' ? '↑' : '↓')
                : '↕';
        }
    });
}

function resetAnalyticsSortIndicators() {
    const columns = ['phone_number', 'total', 'enviados', 'errores', 'en_cola'];
    columns.forEach(col => {
        const el = document.getElementById(`analyticsSort_${col}`);
        if (el) el.textContent = '↕';
    });
    analyticsSortColumn = 'total';
    analyticsSortDirection = 'desc';
}

function showAnalyticsSelectedMessages(phone) {
    const section = document.getElementById('analyticsSelectedMessagesSection');
    const title = document.getElementById('analyticsSelectedPhoneTitle');
    if (title) title.textContent = phone ? `- ${phone}` : '';
    if (section) section.classList.remove('hidden');
}

function hideAnalyticsSelectedMessages() {
    const section = document.getElementById('analyticsSelectedMessagesSection');
    const body = document.getElementById('analyticsSelectedMessagesBody');
    const pagination = document.getElementById('analyticsSelectedMessagesPagination');
    if (body) {
        body.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">Selecciona un número</td></tr>';
    }
    if (pagination) pagination.innerHTML = '';
    if (section) section.classList.add('hidden');
}

function renderAnalyticsSelectedMessagesPagination(total, limit, offset, phone) {
    const pagination = document.getElementById('analyticsSelectedMessagesPagination');
    if (!pagination) return;
    
    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    if (totalPages <= 1) {
        pagination.innerHTML = '';
        return;
    }
    
    const maxButtons = 5;
    let startPage = Math.max(1, currentPage - Math.floor(maxButtons / 2));
    let endPage = Math.min(totalPages, startPage + maxButtons - 1);
    if (endPage - startPage + 1 < maxButtons) {
        startPage = Math.max(1, endPage - maxButtons + 1);
    }
    
    let html = '';
    if (currentPage > 1) {
        html += `<button onclick="loadAnalyticsMessagesForPhone('${phone}', ${(currentPage - 2) * limit})" class="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">Anterior</button>`;
    }
    for (let i = startPage; i <= endPage; i++) {
        const active = i === currentPage ? 'bg-purple-600 text-white' : 'bg-gray-100 hover:bg-gray-200';
        html += `<button onclick="loadAnalyticsMessagesForPhone('${phone}', ${(i - 1) * limit})" class="px-3 py-1 rounded ${active}">${i}</button>`;
    }
    if (currentPage < totalPages) {
        html += `<button onclick="loadAnalyticsMessagesForPhone('${phone}', ${currentPage * limit})" class="px-3 py-1 rounded bg-gray-100 hover:bg-gray-200">Siguiente</button>`;
    }
    
    pagination.innerHTML = html;
}

async function loadAnalyticsMessagesForPhone(phone, offset = 0) {
    const body = document.getElementById('analyticsSelectedMessagesBody');
    if (!body) return;
    if (!phone) {
        hideAnalyticsSelectedMessages();
        return;
    }
    
    showAnalyticsSelectedMessages(phone);
    body.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">Cargando mensajes...</td></tr>';
    
    try {
        const limit = analyticsSelectedMessages.limit || 50;
        const params = new URLSearchParams({ phone, limit: String(limit), offset: String(offset) });
        const res = await fetch(`${API_URL}/api/messages/search?${params}`);
        
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        
        const data = await res.json();
        if (!data.success) {
            throw new Error(data.error || 'Respuesta inválida del servidor');
        }
        
        if (!Array.isArray(data.messages)) {
            throw new Error('Formato de datos inválido');
        }
        
        analyticsSelectedMessages.total = data.total || 0;
        analyticsSelectedMessages.offset = offset;
        
        if (data.messages.length === 0) {
            body.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">No hay mensajes para este número</td></tr>';
            renderAnalyticsSelectedMessagesPagination(0, limit, offset, phone);
            return;
        }
        
        const rows = data.messages.map((msg, i) => {
            const date = new Date(msg.timestamp);
            const dateStr = date.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: '2-digit' });
            const timeStr = date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
            const statusClass = msg.status === 'sent' || msg.status === 'success' ? 'bg-green-100 text-green-700' :
                               msg.status === 'received' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700';
            const statusText = msg.status === 'sent' || msg.status === 'success' ? 'Enviado' :
                              msg.status === 'received' ? 'Recibido' : 'Error';
            const message = escapeHtml(msg.message_preview || '');
            
            return `
                <tr class="hover:bg-gray-50">
                    <td class="py-2 pr-4 font-semibold">${offset + i + 1}</td>
                    <td class="py-2 pr-4 whitespace-nowrap">
                        <div class="text-gray-800">${dateStr}</div>
                        <div class="text-gray-500 text-xs">${timeStr}</div>
                    </td>
                    <td class="py-2 pr-4 text-purple-600 font-medium">${escapeHtml(msg.session || '')}</td>
                    <td class="py-2 pr-4 text-gray-600">${message || '-'}</td>
                    <td class="py-2 pr-4"><span class="px-2 py-1 rounded-full text-xs ${statusClass}">${statusText}</span></td>
                </tr>
            `;
        }).join('');
        
        body.innerHTML = rows;
        renderAnalyticsSelectedMessagesPagination(analyticsSelectedMessages.total, limit, offset, phone);
    } catch (error) {
        console.error('Error cargando mensajes del número:', error);
        const errorMsg = error.message || 'Error desconocido';
        body.innerHTML = `<tr><td colspan="5" class="py-4 text-center text-red-500">Error cargando mensajes: ${escapeHtml(errorMsg)}</td></tr>`;
    }
}

async function refreshAnalytics() {
    try {
        const [data, health] = await Promise.all([fetchAnalyticsData(), fetchAnalyticsHealth()]);
        if (!data) return;
        
        updateAnalyticsKPIs(data.timeline || []);
        updateAnalyticsFooter(data.db_stats || {});
        updateAnalyticsSystemStatus(health);
        
        const timeline = data.timeline || [];
        const labels = timeline.map(x => x.periodo);
        const enviados = timeline.map(x => Number(x.enviados || 0));
        const errores = timeline.map(x => Number(x.errores || 0));
        const cola = timeline.map(x => Number(x.en_cola || 0));
        
        const period = document.getElementById('analyticsPeriod').value;
        let chartType = (period === 'month' || period === 'year') ? 'bar' : 'line';
        
        const timelineCtx = document.getElementById('analyticsTimelineChart');
        if (timelineCtx) {
            buildAnalyticsTimelineChart(timelineCtx.getContext('2d'), labels, enviados, errores, cola, chartType);
        }
        
        const topRows = data.top_numbers || [];
        analyticsTopData = topRows; // Guardar para filtrado
        resetAnalyticsSortIndicators(); // Resetear ordenamiento
        const topLabels = topRows.map(x => x.phone_number);
        const topTotals = topRows.map(x => Number(x.total || 0));
        
        const topCtx = document.getElementById('analyticsTopChart');
        if (topCtx) {
            buildAnalyticsTopChart(topCtx.getContext('2d'), topLabels, topTotals, topRows);
        }
        
        // Si hay filtro activo, mantenerlo
        if (analyticsSelectedPhone) {
            const filtered = topRows.filter(r => r.phone_number === analyticsSelectedPhone);
            if (filtered.length > 0) {
                updateAnalyticsTopTable(filtered, true);
                loadAnalyticsMessagesForPhone(analyticsSelectedPhone);
            } else {
                clearAnalyticsFilter();
                updateAnalyticsTopTable(topRows);
            }
        } else {
            updateAnalyticsTopTable(topRows);
        }
        
    } catch (error) {
        console.error('Error refreshing analytics:', error);
    }
}

function exportAnalyticsCSV() {
    fetchAnalyticsData().then(data => {
        if (!data || !data.top_numbers) return;
        
        const rows = data.top_numbers;
        const headers = ['rank', 'phone_number', 'total', 'enviados', 'errores', 'en_cola'];
        const csv = [
            headers.join(','),
            ...rows.map((r, i) => [i + 1, r.phone_number, r.total, r.enviados, r.errores, r.en_cola].join(','))
        ].join('\n');
        
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }).catch(error => {
        console.error('Error exporting CSV:', error);
    });
}











