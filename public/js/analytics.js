// ======================== ANALYTICS DASHBOARD ========================

// Registrar plugin de datalabels para Chart.js
if (typeof ChartDataLabels !== 'undefined') {
    Chart.register(ChartDataLabels);
}

let analyticsTimelineChart = null;
let analyticsTopChart = null;
let analyticsSessionsMonthlyChart = null;
let analyticsInitialized = false;
let analyticsRefreshInterval = null;
let analyticsTopData = []; // Guardar datos para filtrado
let analyticsSelectedPhone = null; // Número seleccionado
let analyticsSelectedMessages = { total: 0, offset: 0, limit: 50 }; // Estado de paginación

// Variables para ordenamiento de tabla analytics
let analyticsSortColumn = 'total';
let analyticsSortDirection = 'desc';
let analyticsAvailableSessions = []; // Lista de sesiones para filtro

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
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
        return;
    }
    
    analyticsInitialized = true;
    
    // Configurar fechas por defecto usando zona horaria Colombia
    const getColombiaDate = () => {
        const now = new Date();
        return new Date(now.toLocaleString('en-US', { timeZone: 'America/Bogota' }));
    };
    
    const today = getColombiaDate();
    const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
    
    const formatDate = (date) => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    
    document.getElementById('analyticsEndDate').value = formatDate(today);
    document.getElementById('analyticsStartDate').value = formatDate(weekAgo);
    
    // Configurar selectores de fecha
    document.getElementById('analyticsDayPicker').value = formatDate(today);
    
    // Configurar selector de semana (formato: YYYY-Www)
    const weekNum = getWeekNumber(today);
    document.getElementById('analyticsWeekPicker').value = `${today.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
    
    // Configurar selector de mes (formato: YYYY-MM)
    document.getElementById('analyticsMonthPicker').value = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
    
    // Configurar selector de año
    initYearPicker();
    
    // Event listeners — cada cambio de filtro refresca gráficas Y tabla
    document.getElementById('analyticsPeriod').addEventListener('change', () => {
        updateAnalyticsRangeOptions();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsDayPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsWeekPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsMonthPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsYearPicker').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsTopN').addEventListener('change', refreshAnalytics);
    document.getElementById('analyticsTopNChart').addEventListener('change', refreshAnalytics);
    document.getElementById('analyticsStartDate').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsEndDate').addEventListener('change', () => {
        updateAnalyticsPeriodInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsSessionFilter').addEventListener('change', () => {
        updateAnalyticsSessionFilterInfo();
        refreshAnalytics();
        loadSentMessagesTable(0);
        loadReceivedMessagesTable(0);
    });
    document.getElementById('analyticsTableLimit').addEventListener('change', refreshAnalytics);
    document.getElementById('sentMessagesStatusFilter').addEventListener('change', () => loadSentMessagesTable(0));
    
    // Cargar lista de sesiones disponibles
    loadAnalyticsSessions();
    
    updateAnalyticsRangeOptions();
    refreshAnalytics();
    loadSentMessagesTable(0); // carga inicial de la tabla
    loadReceivedMessagesTable(0); // carga inicial de recibidos
    
    // Auto-refresh cada 30 segundos: solo KPIs y gráficas, NO la tabla
    if (analyticsRefreshInterval) clearInterval(analyticsRefreshInterval);
    analyticsRefreshInterval = setInterval(refreshAnalyticsOnly, 30000);
}

// Cargar sesiones disponibles para el filtro
async function loadAnalyticsSessions() {
    try {
        const res = await fetch(`${API_URL}/api/sessions`);
        if (res.ok) {
            const data = await res.json();
            const sessions = data.sessions || [];
            const select = document.getElementById('analyticsSessionFilter');
            
            // Mantener opción "Todas"
            select.innerHTML = '<option value="">Todas las sesiones</option>';
            
            // Agregar sesiones activas
            sessions.forEach(session => {
                const option = document.createElement('option');
                option.value = session.name;
                option.textContent = `${session.name} (${session.status})`;
                select.appendChild(option);
            });
            
            analyticsAvailableSessions = sessions.map(s => s.name);
        }
    } catch (e) {
        console.error('Error cargando sesiones:', e);
    }
}

// Actualizar info del filtro de sesión
function updateAnalyticsSessionFilterInfo() {
    const session = document.getElementById('analyticsSessionFilter').value;
    document.getElementById('analyticsCurrentSessionFilter').textContent = session || 'Todas';
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
    
    // ISO 8601: La semana 1 es la primera semana con al menos 4 días en el año nuevo
    // El primer jueves del año siempre está en la semana 1
    
    // Encontrar el primer jueves del año
    const jan4 = new Date(year, 0, 4); // 4 de enero siempre está en la semana 1
    const jan4Day = jan4.getDay(); // 0=domingo, 1=lunes, ..., 6=sábado
    
    // Calcular el lunes de la semana 1 (retrocediendo desde el 4 de enero)
    // Si jan4 es jueves (4), retrocedemos 3 días para llegar al lunes
    // Si jan4 es viernes (5), retrocedemos 4 días, etc.
    const daysToMonday = (jan4Day === 0) ? 6 : jan4Day - 1;
    const firstMonday = new Date(jan4);
    firstMonday.setDate(jan4.getDate() - daysToMonday);
    
    // Calcular inicio de la semana seleccionada (lunes)
    const weekStart = new Date(firstMonday);
    weekStart.setDate(firstMonday.getDate() + (week - 1) * 7);
    
    // Fin de la semana (domingo)
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
    const sessionFilter = document.getElementById('analyticsSessionFilter')?.value || '';
    const tableLimit = document.getElementById('analyticsTableLimit')?.value || 50;
    const statusBadge = document.getElementById('analyticsStatusBadge');
    
    try {
        const { startDate, endDate } = getAnalyticsDateRange();
        const params = new URLSearchParams({ 
            period: 'custom', 
            start_date: startDate, 
            end_date: endDate, 
            top: topN,
            limit: tableLimit
        });
        
        // Añadir filtro de sesión si está seleccionado
        if (sessionFilter) {
            params.append('session', sessionFilter);
        }
        
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
    document.getElementById('analytics_kpi_cola').textContent = sum(timeline, 'recibidos').toLocaleString();
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

function buildAnalyticsTimelineChart(ctx, labels, recibidos, enviados, errores, chartType = 'line', totales = null) {
    if (analyticsTimelineChart) analyticsTimelineChart.destroy();
    
    const datasets = [
        { 
            label: 'Recibidos (individuales)', 
            data: recibidos, 
            tension: 0.35, 
            borderColor: '#f59e0b', 
            backgroundColor: chartType === 'bar' ? '#f59e0b' : 'rgba(245, 158, 11, 0.8)', 
            fill: false,
            borderWidth: chartType === 'bar' ? 0 : 2
        },
        { 
            label: 'Enviados', 
            data: enviados, 
            tension: 0.35, 
            borderColor: '#10b981', 
            backgroundColor: chartType === 'bar' ? '#10b981' : 'rgba(16, 185, 129, 0.8)', 
            fill: false,
            borderWidth: chartType === 'bar' ? 0 : 2
        },
        { 
            label: 'Errores', 
            data: errores, 
            tension: 0.35, 
            borderColor: '#ef4444', 
            backgroundColor: chartType === 'bar' ? '#ef4444' : 'rgba(239, 68, 68, 0.8)', 
            fill: false,
            borderWidth: chartType === 'bar' ? 0 : 2
        },
    ];
    
    if (totales) {
        datasets.unshift({
            label: 'Total',
            data: totales,
            tension: 0.35,
            borderColor: '#6366f1',
            backgroundColor: chartType === 'bar' ? 'rgba(99, 102, 241, 0.3)' : 'rgba(99, 102, 241, 0.2)',
            fill: false,
            borderWidth: chartType === 'bar' ? 1 : 2,
            borderDash: chartType === 'bar' ? [] : [5, 5]
        });
    }
    
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
                y: { beginAtZero: true, stacked: false, ticks: { precision: 0 } },
                x: { stacked: false }
            }
        }
    });
}

let analyticsConsolidationChart = null;

function buildConsolidationChart(labels, recibidos, consolidados, msgsEnConsolidados) {
    const ctx = document.getElementById('consolidationChart');
    if (!ctx) return;
    
    if (analyticsConsolidationChart) analyticsConsolidationChart.destroy();
    
    const datasets = [
        {
            label: 'Recibidos (individuales)',
            data: recibidos,
            backgroundColor: '#f59e0b',
            borderWidth: 0
        },
        {
            label: 'Enviados (consolidados)',
            data: consolidados,
            backgroundColor: '#10b981',
            borderWidth: 0
        }
    ];
    
    if (msgsEnConsolidados) {
        datasets.push({
            label: 'Alertas agrupadas en envíos',
            data: msgsEnConsolidados,
            backgroundColor: 'rgba(99, 102, 241, 0.4)',
            borderColor: '#6366f1',
            borderWidth: 1
        });
    }
    
    analyticsConsolidationChart = new Chart(ctx.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'bottom' },
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        afterBody: function(tooltipItems) {
                            const idx = tooltipItems[0].dataIndex;
                            const rec = recibidos[idx] || 0;
                            const cons = consolidados[idx] || 0;
                            if (cons > 0) {
                                const ratio = (rec / cons).toFixed(1);
                                return `\nRatio: ${ratio} alertas → 1 mensaje`;
                            }
                            return '';
                        }
                    }
                },
                datalabels: { display: false }
            },
            scales: {
                x: { stacked: false },
                y: { beginAtZero: true, ticks: { precision: 0 } }
            }
        }
    });
}

const SESSION_COLORS = [
    '#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', 
    '#ec4899', '#14b8a6', '#f97316', '#6366f1', '#84cc16',
    '#06b6d4', '#e11d48', '#a855f7', '#22c55e', '#eab308'
];

async function loadSessionsMonthly(year) {
    const section = document.getElementById('sessionsMonthlySection');
    if (!section) return;
    
    try {
        const response = await fetch(`${API_URL}/api/analytics/sessions-monthly?year=${year}`);
        const data = await response.json();
        
        if (!data.success || !data.data || data.data.length === 0) {
            section.classList.add('hidden');
            return;
        }
        
        section.classList.remove('hidden');
        
        const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
        
        // Extraer meses y sesiones únicas
        const mesesSet = new Set();
        const sessionsSet = new Set();
        data.data.forEach(row => {
            mesesSet.add(row.mes);
            sessionsSet.add(row.session);
        });
        
        const meses = [...mesesSet].sort();
        const sessions = [...sessionsSet].sort();
        
        // Agrupar datos: { session: { mes: enviados } }
        const sessionData = {};
        data.data.forEach(row => {
            if (!sessionData[row.session]) sessionData[row.session] = {};
            sessionData[row.session][row.mes] = row.enviados;
        });
        
        const labels = meses.map(m => {
            const idx = parseInt(m.split('-')[1]) - 1;
            return monthNames[idx];
        });
        
        const datasets = sessions.map((session, i) => ({
            label: session,
            data: meses.map(m => sessionData[session]?.[m] || 0),
            backgroundColor: SESSION_COLORS[i % SESSION_COLORS.length],
            borderColor: SESSION_COLORS[i % SESSION_COLORS.length],
            borderWidth: 1
        }));
        
        const ctx = document.getElementById('sessionsMonthlyChart');
        if (!ctx) return;
        
        if (analyticsSessionsMonthlyChart) analyticsSessionsMonthlyChart.destroy();
        
        analyticsSessionsMonthlyChart = new Chart(ctx.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: { mode: 'index', intersect: false },
                    datalabels: { display: false }
                },
                scales: {
                    x: { stacked: false },
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    } catch (error) {
        console.error('Error cargando sessions monthly:', error);
        section.classList.add('hidden');
    }
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
        const period = document.getElementById('analyticsPeriod').value;
        
        let labels, enviados, errores, recibidos, consolidados;
        let chartType = 'bar'; // Por defecto barras
        
        // Si es semana, expandir a todos los días de la semana
        if (period === 'week') {
            const weekPicker = document.getElementById('analyticsWeekPicker').value;
            if (weekPicker) {
                const { start, end } = getWeekDates(weekPicker);
                const daysMap = {};
                
                timeline.forEach(item => {
                    const periodoKey = item.periodo ? item.periodo.split('T')[0] : item.periodo;
                    daysMap[periodoKey] = {
                        enviados: Number(item.enviados || 0),
                        errores: Number(item.errores || 0),
                        recibidos: Number(item.recibidos || 0),
                        consolidados: Number(item.consolidados || 0)
                    };
                });
                
                labels = [];
                enviados = [];
                errores = [];
                recibidos = [];
                consolidados = [];
                
                const currentDay = new Date(start);
                while (currentDay <= end) {
                    const dateStr = currentDay.toISOString().split('T')[0];
                    const dayName = currentDay.toLocaleDateString('es-CO', { weekday: 'short', day: 'numeric', month: 'short' });
                    labels.push(dayName);
                    
                    const dayData = daysMap[dateStr] || { enviados: 0, errores: 0, recibidos: 0, consolidados: 0 };
                    enviados.push(dayData.enviados);
                    errores.push(dayData.errores);
                    recibidos.push(dayData.recibidos);
                    consolidados.push(dayData.consolidados);
                    
                    currentDay.setDate(currentDay.getDate() + 1);
                }
            } else {
                labels = timeline.map(x => {
                    const dateStr = x.periodo ? x.periodo.split('T')[0] : x.periodo;
                    return dateStr;
                });
                enviados = timeline.map(x => Number(x.enviados || 0));
                errores = timeline.map(x => Number(x.errores || 0));
                recibidos = timeline.map(x => Number(x.recibidos || 0));
                consolidados = timeline.map(x => Number(x.consolidados || 0));
            }
        } else if (period === 'year') {
            // Para periodo año, agrupar por mes
            const monthNames = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
            const monthsMap = {};
            
            timeline.forEach(item => {
                if (!item.periodo) return;
                const dateStr = item.periodo.split('T')[0];
                const monthKey = dateStr.substring(0, 7);
                if (!monthsMap[monthKey]) {
                    monthsMap[monthKey] = { enviados: 0, errores: 0, recibidos: 0, consolidados: 0, msgs_en_consolidados: 0 };
                }
                monthsMap[monthKey].enviados += Number(item.enviados || 0);
                monthsMap[monthKey].errores += Number(item.errores || 0);
                monthsMap[monthKey].recibidos += Number(item.recibidos || 0);
                monthsMap[monthKey].consolidados += Number(item.consolidados || 0);
                monthsMap[monthKey].msgs_en_consolidados += Number(item.msgs_en_consolidados || 0);
            });
            
            const sortedMonths = Object.keys(monthsMap).sort();
            labels = sortedMonths.map(m => {
                const monthIdx = parseInt(m.split('-')[1]) - 1;
                return monthNames[monthIdx] + ' ' + m.split('-')[0];
            });
            enviados = sortedMonths.map(m => monthsMap[m].enviados);
            errores = sortedMonths.map(m => monthsMap[m].errores);
            recibidos = sortedMonths.map(m => monthsMap[m].recibidos);
            consolidados = sortedMonths.map(m => monthsMap[m].consolidados);
            var totalesMes = sortedMonths.map(m => {
                const d = monthsMap[m];
                return d.recibidos + d.enviados;
            });
            var msgsConsolidados = sortedMonths.map(m => monthsMap[m].msgs_en_consolidados);
        } else {
            labels = timeline.map(x => {
                if (!x.periodo) return '';
                const dateStr = x.periodo.split('T')[0];
                const date = new Date(dateStr + 'T12:00:00');
                if (period === 'day') {
                    return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
                }
                return dateStr;
            });
            enviados = timeline.map(x => Number(x.enviados || 0));
            errores = timeline.map(x => Number(x.errores || 0));
            recibidos = timeline.map(x => Number(x.recibidos || 0));
            consolidados = timeline.map(x => Number(x.consolidados || 0));
        }
        
        // Calcular totales para todos los periodos
        var totalesMes = recibidos.map((r, i) => r + (enviados[i] || 0));
        
        const timelineCtx = document.getElementById('analyticsTimelineChart');
        if (timelineCtx) {
            buildAnalyticsTimelineChart(timelineCtx.getContext('2d'), labels, recibidos, enviados, errores, chartType, totalesMes);
        }
        
        // Gráfica de consolidación (solo en periodo año)
        const consolidationSection = document.getElementById('consolidationChartSection');
        const sessionsSection = document.getElementById('sessionsMonthlySection');
        if (period === 'year') {
            if (consolidationSection) {
                consolidationSection.classList.remove('hidden');
                buildConsolidationChart(labels, recibidos, consolidados, typeof msgsConsolidados !== 'undefined' ? msgsConsolidados : null);
            }
            const yearPicker = document.getElementById('analyticsYearPicker');
            const year = yearPicker ? yearPicker.value : new Date().getFullYear();
            loadSessionsMonthly(year);
        } else {
            if (consolidationSection) consolidationSection.classList.add('hidden');
            if (sessionsSection) sessionsSection.classList.add('hidden');
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

// Auto-refresh ligero: solo KPIs, gráficas y estado del sistema (sin tabla pesada)
async function refreshAnalyticsOnly() {
    try {
        const [data, health] = await Promise.all([fetchAnalyticsData(), fetchAnalyticsHealth()]);
        if (!data) return;
        updateAnalyticsKPIs(data.timeline || []);
        updateAnalyticsFooter(data.db_stats || {});
        updateAnalyticsSystemStatus(health);
    } catch (e) {
        console.error('Error en auto-refresh analytics:', e);
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

async function exportSentMessagesExcel() {
    const btn = document.getElementById('btnExportSentExcel') || document.getElementById('btnExportExcel');
    const originalContent = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Exportando...';
    }

    try {
        const { startDate, endDate } = getAnalyticsDateRange();
        const sessionFilter = document.getElementById('analyticsSessionFilter')?.value || '';

        // Sin limit ni offset → devuelve todo el período (hasta 50000)
        const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
        if (sessionFilter) params.append('session', sessionFilter);

        const statusFilter = document.getElementById('sentMessagesStatusFilter')?.value || 'sent';
        params.append('status_filter', statusFilter);

        const res = await fetch(`${API_URL}/api/analytics/export-sent?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error al obtener datos');

        const messages = data.messages || [];
        if (messages.length === 0) {
            alert('No hay mensajes para el período y filtros seleccionados.');
            return;
        }

        const rows = messages.map(msg => {
            // pg retorna TIMESTAMP WITHOUT TIMEZONE como UTC — usar timeZone:'UTC' para ver el valor real Colombia
            const date = new Date(msg.timestamp);
            return {
                'Fecha/Hora': date.toLocaleString('es-CO', { timeZone: 'UTC' }),
                'Estado': msg.status === 'received' ? 'Recibido' : 'Enviado',
                'Número Enviado': msg.phone_number || '',
                'Mensaje': msg.message_preview || '',
                'Caracteres': msg.char_count != null ? Number(msg.char_count) : 0,
                'Sesión': msg.session || ''
            };
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);

        ws['!cols'] = [
            { wch: 22 },
            { wch: 12 },
            { wch: 20 },
            { wch: 70 },
            { wch: 12 },
            { wch: 22 }
        ];

        XLSX.utils.book_append_sheet(wb, ws, 'Mensajes');

        const fileName = `mensajes_enviados_${startDate}_${endDate}${sessionFilter ? '_' + sessionFilter : ''}.xlsx`;
        XLSX.writeFile(wb, fileName);

    } catch (error) {
        console.error('Error al exportar Excel:', error);
        alert('Error al exportar: ' + (error.message || 'Error desconocido'));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}

// ======================== TABLA MENSAJES ENVIADOS DEL PERÍODO ========================

async function loadSentMessagesTable(offset = 0) {
    const tbody = document.getElementById('sentMessagesTableBody');
    const countEl = document.getElementById('sentMessagesCount');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-gray-400">Cargando mensajes...</td></tr>';
    if (countEl) countEl.textContent = '';

    try {
        const { startDate, endDate } = getAnalyticsDateRange();
        const sessionFilter = document.getElementById('analyticsSessionFilter')?.value || '';
        const pageSize = parseInt(document.getElementById('sentMessagesPageSize')?.value || '100');

        const params = new URLSearchParams({
            start_date: startDate,
            end_date: endDate,
            limit: pageSize,
            offset
        });
        if (sessionFilter) params.append('session', sessionFilter);
        const statusFilter = document.getElementById('sentMessagesStatusFilter')?.value || 'sent';
        params.append('status_filter', statusFilter);

        const res = await fetch(`${API_URL}/api/analytics/export-sent?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error al obtener datos');

        const messages = data.messages || [];
        const total = data.total || 0;

        if (countEl) countEl.textContent = total > 0 ? `${total.toLocaleString()} mensajes` : '0 mensajes';

        if (messages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="py-6 text-center text-gray-400">No hay mensajes para este período y filtro</td></tr>';
            renderSentMessagesPagination(0, pageSize, offset);
            return;
        }

        tbody.innerHTML = messages.map((msg, i) => {
            // pg retorna TIMESTAMP WITHOUT TIMEZONE como UTC — usar timeZone:'UTC' para mostrar
            // el valor real almacenado en Colombia local time
            const date = new Date(msg.timestamp);
            const dateStr = date.toLocaleDateString('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' });
            const timeStr = date.toLocaleTimeString('es-CO', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const rowBg = i % 2 === 0 ? '' : 'bg-gray-50';
            const chars = msg.char_count != null ? Number(msg.char_count) : '';
            const isReceived = msg.status === 'received';
            const statusBadge = isReceived
                ? '<span class="px-1.5 py-0.5 rounded text-xs bg-blue-100 text-blue-700">↩ Rcb</span>'
                : '<span class="px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700">↗ Env</span>';
            const rowHover = isReceived ? 'hover:bg-blue-50' : 'hover:bg-emerald-50';
            return `
                <tr class="${rowBg} ${rowHover}">
                    <td class="py-2 pr-3 text-gray-400 text-xs">${offset + i + 1}</td>
                    <td class="py-2 pr-3 whitespace-nowrap">
                        <div class="text-gray-800 text-xs font-medium">${dateStr}</div>
                        <div class="text-gray-500 text-xs">${timeStr}</div>
                    </td>
                    <td class="py-2 pr-3 font-mono text-xs text-blue-700">${escapeHtml(msg.phone_number || '')}</td>
                    <td class="py-2 pr-3 text-gray-700 text-xs max-w-xs truncate" title="${escapeHtml(msg.message_preview || '')}">${escapeHtml(msg.message_preview || '—')}</td>
                    <td class="py-2 pr-3 text-right text-gray-600 text-xs">${chars !== '' ? chars.toLocaleString() : '—'}</td>
                    <td class="py-2 pr-3 text-xs text-purple-700 font-medium">${escapeHtml(msg.session || '')}</td>
                    <td class="py-2 pr-3">${statusBadge}</td>
                </tr>
            `;
        }).join('');

        renderSentMessagesPagination(total, pageSize, offset);

    } catch (error) {
        console.error('Error cargando tabla mensajes enviados:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderSentMessagesPagination(total, limit, offset) {
    const infoEl = document.getElementById('sentMessagesPaginationInfo');
    const btnsEl = document.getElementById('sentMessagesPaginationBtns');
    if (!infoEl || !btnsEl) return;

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const from = total === 0 ? 0 : offset + 1;
    const to = Math.min(offset + limit, total);

    infoEl.textContent = total > 0 ? `Mostrando ${from.toLocaleString()}–${to.toLocaleString()} de ${total.toLocaleString()} mensajes` : '';

    if (totalPages <= 1) {
        btnsEl.innerHTML = '';
        return;
    }

    const maxBtns = 7;
    let start = Math.max(1, currentPage - Math.floor(maxBtns / 2));
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start + 1 < maxBtns) start = Math.max(1, end - maxBtns + 1);

    let html = '';
    if (currentPage > 1) {
        html += `<button onclick="loadSentMessagesTable(${(currentPage - 2) * limit})" class="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200">‹ Ant</button>`;
    }
    for (let p = start; p <= end; p++) {
        const active = p === currentPage ? 'bg-emerald-600 text-white' : 'bg-gray-100 hover:bg-gray-200';
        html += `<button onclick="loadSentMessagesTable(${(p - 1) * limit})" class="px-2 py-1 rounded text-xs ${active}">${p}</button>`;
    }
    if (currentPage < totalPages) {
        html += `<button onclick="loadSentMessagesTable(${currentPage * limit})" class="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200">Sig ›</button>`;
    }

    btnsEl.innerHTML = html;
}


// ======================== TABLA MENSAJES RECIBIDOS DEL PERÍODO ========================

async function loadReceivedMessagesTable(offset = 0) {
    const tbody = document.getElementById('receivedMessagesTableBody');
    const countEl = document.getElementById('receivedMessagesCount');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-gray-400">Cargando mensajes...</td></tr>';
    if (countEl) countEl.textContent = '';

    try {
        const { startDate, endDate } = getAnalyticsDateRange();
        const sessionFilter = document.getElementById('analyticsSessionFilter')?.value || '';
        const pageSize = parseInt(document.getElementById('receivedMessagesPageSize')?.value || '100');

        const params = new URLSearchParams({
            start_date: startDate,
            end_date: endDate,
            limit: pageSize,
            offset,
            status_filter: 'received'
        });
        if (sessionFilter) params.append('session', sessionFilter);

        const res = await fetch(`${API_URL}/api/analytics/export-sent?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error al obtener datos');

        const messages = data.messages || [];
        const total = data.total || 0;

        if (countEl) countEl.textContent = total > 0 ? `${total.toLocaleString()} mensajes` : '0 mensajes';

        if (messages.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="py-6 text-center text-gray-400">No hay mensajes recibidos para este período</td></tr>';
            renderReceivedMessagesPagination(0, pageSize, offset);
            return;
        }

        tbody.innerHTML = messages.map((msg, i) => {
            const date = new Date(msg.timestamp);
            const dateStr = date.toLocaleDateString('es-CO', { timeZone: 'UTC', day: '2-digit', month: '2-digit', year: '2-digit' });
            const timeStr = date.toLocaleTimeString('es-CO', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit' });
            const rowBg = i % 2 === 0 ? '' : 'bg-gray-50';
            const chars = msg.char_count != null ? Number(msg.char_count) : '';
            return `
                <tr class="${rowBg} hover:bg-blue-50">
                    <td class="py-2 pr-3 text-gray-400 text-xs">${offset + i + 1}</td>
                    <td class="py-2 pr-3 whitespace-nowrap">
                        <div class="text-gray-800 text-xs font-medium">${dateStr}</div>
                        <div class="text-gray-500 text-xs">${timeStr}</div>
                    </td>
                    <td class="py-2 pr-3 font-mono text-xs text-blue-700">${escapeHtml(msg.phone_number || '')}</td>
                    <td class="py-2 pr-3 text-gray-700 text-xs max-w-xs truncate" title="${escapeHtml(msg.message_preview || '')}">${escapeHtml(msg.message_preview || '—')}</td>
                    <td class="py-2 pr-3 text-right text-gray-600 text-xs">${chars !== '' ? chars.toLocaleString() : '—'}</td>
                    <td class="py-2 pr-3 text-xs text-purple-700 font-medium">${escapeHtml(msg.session || '')}</td>
                </tr>
            `;
        }).join('');

        renderReceivedMessagesPagination(total, pageSize, offset);

    } catch (error) {
        console.error('Error cargando tabla mensajes recibidos:', error);
        tbody.innerHTML = `<tr><td colspan="6" class="py-6 text-center text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderReceivedMessagesPagination(total, limit, offset) {
    const infoEl = document.getElementById('receivedMessagesPaginationInfo');
    const btnsEl = document.getElementById('receivedMessagesPaginationBtns');
    if (!infoEl || !btnsEl) return;

    const totalPages = Math.ceil(total / limit);
    const currentPage = Math.floor(offset / limit) + 1;
    const from = total === 0 ? 0 : offset + 1;
    const to = Math.min(offset + limit, total);

    infoEl.textContent = total > 0 ? `Mostrando ${from.toLocaleString()}–${to.toLocaleString()} de ${total.toLocaleString()} mensajes` : '';

    if (totalPages <= 1) {
        btnsEl.innerHTML = '';
        return;
    }

    const maxBtns = 7;
    let start = Math.max(1, currentPage - Math.floor(maxBtns / 2));
    let end = Math.min(totalPages, start + maxBtns - 1);
    if (end - start + 1 < maxBtns) start = Math.max(1, end - maxBtns + 1);

    let html = '';
    if (currentPage > 1) {
        html += `<button onclick="loadReceivedMessagesTable(${(currentPage - 2) * limit})" class="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200">‹ Ant</button>`;
    }
    for (let p = start; p <= end; p++) {
        const active = p === currentPage ? 'bg-blue-600 text-white' : 'bg-gray-100 hover:bg-gray-200';
        html += `<button onclick="loadReceivedMessagesTable(${(p - 1) * limit})" class="px-2 py-1 rounded text-xs ${active}">${p}</button>`;
    }
    if (currentPage < totalPages) {
        html += `<button onclick="loadReceivedMessagesTable(${currentPage * limit})" class="px-2 py-1 rounded text-xs bg-gray-100 hover:bg-gray-200">Sig ›</button>`;
    }

    btnsEl.innerHTML = html;
}

async function exportReceivedMessagesExcel() {
    const btn = document.getElementById('btnExportReceivedExcel');
    const originalContent = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '⏳ Exportando...';
    }

    try {
        const { startDate, endDate } = getAnalyticsDateRange();
        const sessionFilter = document.getElementById('analyticsSessionFilter')?.value || '';

        const params = new URLSearchParams({ start_date: startDate, end_date: endDate, status_filter: 'received' });
        if (sessionFilter) params.append('session', sessionFilter);

        const res = await fetch(`${API_URL}/api/analytics/export-sent?${params}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        const data = await res.json();
        if (!data.success) throw new Error(data.error || 'Error al obtener datos');

        const messages = data.messages || [];
        if (messages.length === 0) {
            alert('No hay mensajes recibidos para el período seleccionado.');
            return;
        }

        const rows = messages.map(msg => {
            const date = new Date(msg.timestamp);
            return {
                'Fecha/Hora': date.toLocaleString('es-CO', { timeZone: 'UTC' }),
                'De (Número)': msg.phone_number || '',
                'Mensaje': msg.message_preview || '',
                'Caracteres': msg.char_count != null ? Number(msg.char_count) : 0,
                'Sesión': msg.session || ''
            };
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.json_to_sheet(rows);
        ws['!cols'] = [{ wch: 22 }, { wch: 20 }, { wch: 70 }, { wch: 12 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, ws, 'Mensajes Recibidos');

        const fileName = `mensajes_recibidos_${startDate}_${endDate}${sessionFilter ? '_' + sessionFilter : ''}.xlsx`;
        XLSX.writeFile(wb, fileName);

    } catch (error) {
        console.error('Error al exportar Excel recibidos:', error);
        alert('Error al exportar: ' + (error.message || 'Error desconocido'));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalContent;
        }
    }
}



