// ======================== ANALYTICS DASHBOARD ========================

let analyticsTimelineChart = null;

let analyticsTopChart = null;

let analyticsInitialized = false;

let analyticsRefreshInterval = null;

let analyticsTopData = []; // Guardar datos para filtrado

let analyticsSelectedPhone = null; // Número seleccionado

let analyticsSelectedMessages = { total: 0, offset: 0, limit: 50 }; // Estado de paginación



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

    

    // Event listeners

    document.getElementById('analyticsPeriod').addEventListener('change', () => {

        updateAnalyticsRangeOptions();

        refreshAnalytics();

    });

    document.getElementById('analyticsRangeSelector').addEventListener('change', () => {

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



function updateAnalyticsRangeOptions() {

    const period = document.getElementById('analyticsPeriod').value;

    const rangeSel = document.getElementById('analyticsRangeSelector');

    const rangeLabel = document.getElementById('analyticsRangeLabel');

    const rangeContainer = document.getElementById('analyticsRangeContainer');

    const customDateContainer = document.getElementById('analyticsCustomDateContainer');

    const customDateContainer2 = document.getElementById('analyticsCustomDateContainer2');

    

    if (period === 'custom') {

        rangeContainer.classList.add('hidden');

        customDateContainer.classList.remove('hidden');

        customDateContainer2.classList.remove('hidden');

        updateAnalyticsPeriodInfo();

        return;

    } else {

        rangeContainer.classList.remove('hidden');

        customDateContainer.classList.add('hidden');

        customDateContainer2.classList.add('hidden');

    }

    

    rangeSel.innerHTML = '';

    

    if (period === 'day') {

        rangeLabel.textContent = 'PerÃ­odo';

        rangeSel.innerHTML = `

            <option value="today">Hoy</option>

            <option value="yesterday">Ayer</option>

            <option value="7">Ãltimos 7 dÃ­as</option>

            <option value="15">Ãltimos 15 dÃ­as</option>

            <option value="30">Ãltimos 30 dÃ­as</option>

        `;

    } else if (period === 'week') {

        rangeLabel.textContent = 'Ãltimas semanas';

        rangeSel.innerHTML = `

            <option value="1">1 semana (actual)</option>

            <option value="4">4 semanas</option>

            <option value="8">8 semanas</option>

            <option value="12">12 semanas</option>

        `;

    } else if (period === 'month') {

        rangeLabel.textContent = 'Ãltimos meses';

        rangeSel.innerHTML = `

            <option value="3">3 meses</option>

            <option value="6">6 meses</option>

            <option value="12">12 meses</option>

        `;

    }

    

    updateAnalyticsPeriodInfo();

}



function updateAnalyticsPeriodInfo() {

    const period = document.getElementById('analyticsPeriod').value;

    const range = document.getElementById('analyticsRangeSelector').value;

    const startDate = document.getElementById('analyticsStartDate').value;

    const endDate = document.getElementById('analyticsEndDate').value;

    const currentPeriodInfo = document.getElementById('analyticsCurrentPeriodInfo');

    

    if (period === 'custom') {

        currentPeriodInfo.textContent = `Del ${startDate} al ${endDate}`;

    } else if (period === 'day') {

        if (range === 'today') currentPeriodInfo.textContent = 'Solo hoy';

        else if (range === 'yesterday') currentPeriodInfo.textContent = 'Solo ayer';

        else currentPeriodInfo.textContent = `Ãltimos ${range} dÃ­as`;

    } else {

        const periodNames = { 'week': 'semanas', 'month': 'meses' };

        currentPeriodInfo.textContent = (period === 'week' && range === '1') ? 'Semana actual (DomâSÃ¡b)' : `Ãltimos ${range} ${periodNames[period]}`;

    }

}



async function fetchAnalyticsData() {

    const period = document.getElementById('analyticsPeriod').value;

    const range = document.getElementById('analyticsRangeSelector').value;

    const topN = document.getElementById('analyticsTopNChart')?.value || document.getElementById('analyticsTopN').value;

    const startDate = document.getElementById('analyticsStartDate').value;

    const endDate = document.getElementById('analyticsEndDate').value;

    const statusBadge = document.getElementById('analyticsStatusBadge');

    

    try {

        let params;

        if (period === 'custom') {

            params = new URLSearchParams({ period: 'custom', start_date: startDate, end_date: endDate, top: topN });

        } else {

            params = new URLSearchParams({ period, range, top: topN });

        }

        

        statusBadge.textContent = 'Cargandoâ¦';

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

    

    document.getElementById('analyticsCurrentSession').textContent = rotation.current_session || 'â';

    document.getElementById('analyticsSessionProgress').textContent = `${sent}/${max}`;

    

    const progressPercentage = max > 0 ? (sent / max) * 100 : 0;

    document.getElementById('analyticsProgressBar').style.width = `${Math.min(progressPercentage, 100)}%`;

    

    const sessions = health.available_sessions || [];

    document.getElementById('analyticsAvailableSessions').textContent = sessions.length > 0 ? sessions.join(', ') : 'â';

}



function updateAnalyticsFooter(db_stats) {

    document.getElementById('analyticsDbSize').textContent = db_stats?.db_size_mb ?? 'â';

    const byStatus = db_stats?.total_by_status || {};

    document.getElementById('analyticsDbByStatus').textContent = Object.entries(byStatus).map(([k, v]) => `${k}: ${v.toLocaleString()}`).join(' | ') || 'â';

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

                tooltip: { mode: 'index', intersect: false }

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

                tooltip: { callbacks: { title: (ctx) => labels[ctx[0].dataIndex] } }

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

    

    // Actualizar tÃ­tulo

    document.getElementById('analyticsDetailTitle').textContent = `- ${phone}`;

    document.getElementById('analyticsClearFilterBtn').classList.remove('hidden');

    loadAnalyticsMessagesForPhone(phone);

    

    // Filtrar tabla a solo ese nÃºmero

    const filtered = analyticsTopData.filter(r => r.phone_number === phone);

    updateAnalyticsTopTable(filtered, true);

                loadAnalyticsMessagesForPhone(analyticsSelectedPhone);

    

    // Actualizar colores del grÃ¡fico

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

    

    // Restaurar colores del grÃ¡fico

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

            <td class="py-2 pr-4 font-mono text-sm ${isSelected ? 'text-purple-700 font-bold' : ''}">${r.phone_number || 'â'}</td>

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
        body.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">Selecciona un n?mero</td></tr>';
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
            body.innerHTML = '<tr><td colspan="5" class="py-4 text-center text-gray-500">No hay mensajes para este n?mero</td></tr>';
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
                    <td class="py-2 pr-4 text-gray-600">${message || '-'} </td>
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

        const range = document.getElementById('analyticsRangeSelector').value;

        let chartType = 'line';

        if (period === 'month' || (period === 'week' && range !== '1')) {

            chartType = 'bar';

        }



        const timelineCtx = document.getElementById('analyticsTimelineChart');

        if (timelineCtx) {

            buildAnalyticsTimelineChart(timelineCtx.getContext('2d'), labels, enviados, errores, cola, chartType);

        }



        const topRows = data.top_numbers || [];

        analyticsTopData = topRows; // Guardar para filtrado

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











