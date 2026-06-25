const API_URL = window.location.protocol === 'file:' ? 'http://164.68.118.86:3010' : window.location.origin;

let operationalSites = [];
let operationalStatuses = [];
let editingOperationalResponsibleId = null;
let editingDocumentExpirationId = null;
let followupDateFilter = new Date().toISOString().slice(0, 10);
const operationalPaging = {
    vehicles: { page: 1, limit: 10 },
    report: { page: 1, limit: 10 },
    followups: { page: 1, limit: 10 },
    documents: { page: 1, limit: 10 }
};
const operationalSortState = {};
const operationalSortableTables = {
    operationalVehiclesTable: [
        { type: 'text' },
        { type: 'text' },
        { type: 'text' },
        { type: 'text' },
        null
    ],
    operationalReportTable: [
        { type: 'datetime' },
        { type: 'text' },
        { type: 'text' },
        { type: 'text' },
        null
    ],
    operationalFollowupsTable: [
        { type: 'date' },
        { type: 'text' },
        { type: 'text' },
        { type: 'text' },
        { type: 'text' },
        { type: 'text' },
        { type: 'fraction' },
        { type: 'datetime' },
        { type: 'datetime' },
        null
    ],
    documentExpirationsTable: [
        { type: 'text' },
        { type: 'text' },
        { type: 'date' },
        { type: 'number' },
        { type: 'date' },
        { type: 'number' },
        { type: 'number' },
        { type: 'text' },
        null
    ]
};

const documentTypeLabels = {
    soat: 'SOAT',
    tecnomecanica: 'Tecnomecanica',
    poliza: 'Poliza',
    extintor: 'Extintor',
    cambio_aceite: 'Cambio aceite'
};

document.addEventListener('DOMContentLoaded', () => {
    const followupDateInput = document.getElementById('followupDateFilter');
    if (followupDateInput) followupDateInput.value = followupDateFilter;
    setupOperationalTableSorting();
    loadOperational();
});

function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    if (!container) {
        alert(message);
        return;
    }

    const colors = {
        success: 'bg-green-600',
        error: 'bg-red-600',
        warning: 'bg-yellow-600',
        info: 'bg-gray-800'
    };

    const toast = document.createElement('div');
    toast.className = `${colors[type] || colors.info} text-white px-4 py-3 rounded-lg shadow text-sm max-w-sm`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 4500);
}

function setFollowupDateFilter(value) {
    followupDateFilter = value || new Date().toISOString().slice(0, 10);
    operationalPaging.followups.page = 1;
    const input = document.getElementById('followupDateFilter');
    if (input) input.value = followupDateFilter === 'all' ? '' : followupDateFilter;
    updateFollowupFilterUI();
    loadOperationalFollowups();
}

function loadAllOperationalFollowups() {
    setFollowupDateFilter('all');
}

function updateFollowupFilterUI() {
    const allBtn = document.getElementById('followupAllBtn');
    if (!allBtn) return;
    if (followupDateFilter === 'all') {
        allBtn.className = 'bg-purple-600 text-white px-3 py-2 rounded-lg hover:bg-purple-700 text-sm';
        allBtn.textContent = 'Todos activos';
    } else {
        allBtn.className = 'bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 text-sm';
        allBtn.textContent = 'Todos';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text == null ? '' : String(text);
    return div.innerHTML;
}

function normalizeSortText(value) {
    return String(value || '')
        .trim()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function parseOperationalDate(value) {
    const text = String(value || '').trim();
    if (!text || text === '-') return 0;

    const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (match) {
        const [, day, month, year, hour = '0', minute = '0', second = '0'] = match;
        return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
    }

    const timestamp = Date.parse(text);
    return Number.isNaN(timestamp) ? 0 : timestamp;
}

function getOperationalSortValue(row, columnIndex, type) {
    const text = row.cells[columnIndex]?.innerText || '';
    if (type === 'number') {
        const value = Number(text.replace(/[^\d.-]/g, ''));
        return Number.isNaN(value) ? -Infinity : value;
    }
    if (type === 'fraction') {
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (!match) return 0;
        return Number(match[1]) + (Number(match[2]) / 100000);
    }
    if (type === 'date' || type === 'datetime') return parseOperationalDate(text);
    return normalizeSortText(text);
}

function compareOperationalValues(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

function updateOperationalSortIndicators(tbodyId, columnIndex, direction) {
    const tbody = document.getElementById(tbodyId);
    const table = tbody?.closest('table');
    if (!table) return;

    table.querySelectorAll('thead th .sort-indicator').forEach(indicator => {
        indicator.textContent = '';
    });

    const th = table.querySelectorAll('thead th')[columnIndex];
    const indicator = th?.querySelector('.sort-indicator');
    if (indicator) indicator.textContent = direction === 'asc' ? ' ▲' : ' ▼';
}

function applyOperationalTableSort(tbodyId) {
    const state = operationalSortState[tbodyId];
    if (!state) return;

    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;

    const sortableRows = Array.from(tbody.children)
        .filter(row => row.cells.length > state.columnIndex && !row.querySelector('td[colspan]'))
        .map(row => ({
            row,
            detailRow: row.nextElementSibling?.id?.startsWith('followup-items-') ? row.nextElementSibling : null
        }));

    if (sortableRows.length < 2) {
        updateOperationalSortIndicators(tbodyId, state.columnIndex, state.direction);
        return;
    }

    sortableRows.sort((rowA, rowB) => {
        const valueA = getOperationalSortValue(rowA.row, state.columnIndex, state.type);
        const valueB = getOperationalSortValue(rowB.row, state.columnIndex, state.type);
        const result = compareOperationalValues(valueA, valueB);
        return state.direction === 'asc' ? result : -result;
    });

    sortableRows.forEach(({ row, detailRow }) => {
        tbody.appendChild(row);
        if (detailRow) tbody.appendChild(detailRow);
    });
    updateOperationalSortIndicators(tbodyId, state.columnIndex, state.direction);
}

function sortOperationalTable(tbodyId, columnIndex, type) {
    const previous = operationalSortState[tbodyId];
    const direction = previous?.columnIndex === columnIndex && previous.direction === 'asc' ? 'desc' : 'asc';
    operationalSortState[tbodyId] = { columnIndex, direction, type };
    applyOperationalTableSort(tbodyId);
}

function setupOperationalTableSorting() {
    Object.entries(operationalSortableTables).forEach(([tbodyId, columns]) => {
        const tbody = document.getElementById(tbodyId);
        const table = tbody?.closest('table');
        if (!table || table.dataset.sortableReady === 'true') return;

        table.querySelectorAll('thead th').forEach((th, index) => {
            const config = columns[index];
            if (!config) return;

            th.classList.add('cursor-pointer', 'select-none', 'hover:bg-gray-100');
            th.title = 'Ordenar';
            th.addEventListener('click', () => sortOperationalTable(tbodyId, index, config.type));
            if (!th.querySelector('.sort-indicator')) {
                th.insertAdjacentHTML('beforeend', '<span class="sort-indicator text-purple-600"></span>');
            }
        });

        table.dataset.sortableReady = 'true';
    });
}

async function loadOperational() {
    await Promise.all([
        loadOperationalCatalogs(),
        loadOperationalVehicles(),
        loadOperationalReport(),
        loadOperationalFollowups(),
        loadDocumentExpirations()
    ]);
}

function showOperationalTab(tab) {
    const mainPanel = document.getElementById('operational-panel-main');
    const documentsPanel = document.getElementById('operational-panel-documents');
    const mainTab = document.getElementById('operational-tab-main');
    const documentsTab = document.getElementById('operational-tab-documents');
    if (!mainPanel || !documentsPanel || !mainTab || !documentsTab) return;

    const showDocuments = tab === 'documents';
    mainPanel.classList.toggle('hidden', showDocuments);
    documentsPanel.classList.toggle('hidden', !showDocuments);
    mainTab.className = showDocuments
        ? 'px-4 py-2 text-sm font-semibold border-b-2 border-transparent text-gray-600 hover:text-purple-700'
        : 'px-4 py-2 text-sm font-semibold border-b-2 border-purple-600 text-purple-700';
    documentsTab.className = showDocuments
        ? 'px-4 py-2 text-sm font-semibold border-b-2 border-purple-600 text-purple-700'
        : 'px-4 py-2 text-sm font-semibold border-b-2 border-transparent text-gray-600 hover:text-purple-700';
    if (showDocuments) loadDocumentExpirations();
}

async function loadOperationalCatalogs() {
    try {
        const [sitesResponse, statusesResponse] = await Promise.all([
            fetch(`${API_URL}/api/operational/sites`),
            fetch(`${API_URL}/api/operational/statuses`)
        ]);
        const sitesData = await sitesResponse.json();
        const statusesData = await statusesResponse.json();
        if (!sitesData.success) throw new Error(sitesData.error || 'Error cargando sedes');
        if (!statusesData.success) throw new Error(statusesData.error || 'Error cargando estados');

        operationalSites = sitesData.sites || [];
        operationalStatuses = statusesData.statuses || [];
        renderOperationalCatalogs();
    } catch (error) {
        showToast(`Error operatividad: ${error.message}`, 'error');
    }
}

function renderOperationalCatalogs() {
    const siteOptions = operationalSites
        .filter(site => site.active)
        .map(site => `<option value="${site.id}">${escapeHtml(site.name)}</option>`)
        .join('');

    const nonOperationalStatusOptions = operationalStatuses
        .filter(status => status.active && !status.is_operational)
        .map(status => `<option value="${status.id}">${escapeHtml(status.name)}</option>`)
        .join('');

    document.getElementById('operationalSiteSelect').innerHTML = siteOptions;
    document.getElementById('responsibleSiteSelect').innerHTML = siteOptions;
    document.getElementById('operationalStatusSelect').innerHTML = nonOperationalStatusOptions;

    const list = document.getElementById('operationalSitesList');
    list.innerHTML = operationalSites.map(site => {
        const responsibles = (site.responsibles || [])
            .filter(resp => resp.active)
            .map(resp => `
                <div class="text-xs text-gray-600 flex items-center justify-between gap-2">
                    <span>${escapeHtml(resp.name)} - ${escapeHtml(resp.phone_number)}</span>
                    <span class="flex gap-2">
                        <button onclick="editOperationalResponsible(${resp.id})" class="text-blue-600 hover:underline">Editar</button>
                        <button onclick="deactivateOperationalResponsible(${resp.id})" class="text-red-600 hover:underline">Eliminar</button>
                    </span>
                </div>
            `)
            .join('');
        return `
            <div class="border rounded-lg px-3 py-2">
                <div class="flex items-center justify-between gap-2">
                    <div class="font-medium">${escapeHtml(site.name)}</div>
                    <button onclick="deactivateOperationalSite(${site.id})" class="text-xs text-red-600 hover:underline">Eliminar</button>
                </div>
                ${responsibles || '<div class="text-xs text-gray-400">Sin responsable activo</div>'}
            </div>
        `;
    }).join('');
}

async function loadOperationalVehicles() {
    const tbody = document.getElementById('operationalVehiclesTable');
    try {
        const onlyNonOperational = document.getElementById('operationalOnlyNonOperational').checked !== false;
        const paging = operationalPaging.vehicles;
        const params = new URLSearchParams({
            onlyNonOperational,
            paginate: 'true',
            page: paging.page,
            limit: paging.limit
        });
        const response = await fetch(`${API_URL}/api/operational/vehicles?${params}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error cargando vehiculos');

        const vehicles = data.vehicles || [];
        if (vehicles.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-gray-500">No hay vehiculos registrados</td></tr>';
            renderPagination('vehicles', data.pagination, loadOperationalVehicles);
            return;
        }

        tbody.innerHTML = vehicles.map(vehicle => `
            <tr class="hover:bg-gray-50 border-b">
                <td class="px-3 py-2 text-xs font-medium">${escapeHtml(vehicle.plate)}</td>
                <td class="px-3 py-2 text-xs">${escapeHtml(vehicle.site_name)}</td>
                <td class="px-3 py-2 text-xs">
                    <span class="${vehicle.is_operational ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'} px-2 py-1 rounded">${escapeHtml(vehicle.status_name)}</span>
                </td>
                <td class="px-3 py-2 text-xs text-gray-700">${escapeHtml(vehicle.last_observation || '')}</td>
                <td class="px-3 py-2 text-xs text-center whitespace-nowrap">
                    <button onclick="setOperationalVehicleOperative(${vehicle.id})" class="bg-green-100 text-green-800 px-2 py-1 rounded hover:bg-green-200">Operativo</button>
                    <button onclick="deactivateOperationalVehicle(${vehicle.id})" class="bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200 ml-1">Eliminar</button>
                </td>
            </tr>
        `).join('');
        applyOperationalTableSort('operationalVehiclesTable');
        renderPagination('vehicles', data.pagination, loadOperationalVehicles);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadOperationalReport() {
    const tbody = document.getElementById('operationalReportTable');
    try {
        const paging = operationalPaging.report;
        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit,
            date: followupDateFilter
        });
        const response = await fetch(`${API_URL}/api/operational/report?${params}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error cargando historial');

        const rows = data.report || [];
        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center py-6 text-gray-500">Sin historial</td></tr>';
            renderPagination('report', data.pagination, loadOperationalReport);
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const date = row.changed_at_co || '';
            const change = `${row.old_status || '-'} -> ${row.new_status || '-'}`;
            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="px-3 py-2 text-xs text-gray-600">${escapeHtml(date)}</td>
                    <td class="px-3 py-2 text-xs font-medium">${escapeHtml(row.plate)}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(change)}</td>
                    <td class="px-3 py-2 text-xs text-gray-700">${escapeHtml(row.observation || '')}</td>
                    <td class="px-3 py-2 text-xs text-center">
                        <button onclick="deleteOperationalHistory(${row.id})" class="bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200">Eliminar</button>
                    </td>
                </tr>
            `;
        }).join('');
        applyOperationalTableSort('operationalReportTable');
        renderPagination('report', data.pagination, loadOperationalReport);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function loadOperationalFollowups() {
    const tbody = document.getElementById('operationalFollowupsTable');
    try {
        updateFollowupFilterUI();
        const paging = operationalPaging.followups;
        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit,
            date: followupDateFilter
        });
        const response = await fetch(`${API_URL}/api/operational/followups?${params}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error cargando respuestas');

        const rows = data.followups || [];
        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="10" class="text-center py-6 text-gray-500">Sin seguimientos enviados hoy</td></tr>';
            renderPagination('followups', data.pagination, loadOperationalFollowups);
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const followupDate = row.followup_date_co || '';
            const sentAt = row.sent_at_co || '';
            const answeredAt = row.response_at_co || '-';
            const isPending = row.response_status === 'Pendiente';
            const badge = isPending
                ? 'bg-red-100 text-red-800'
                : (row.response_status === 'Cancelado' ? 'bg-gray-100 text-gray-700' : 'bg-green-100 text-green-800');
            const typeBadge = row.send_type === 'manual'
                ? 'bg-blue-100 text-blue-800'
                : 'bg-slate-100 text-slate-800';
            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="px-3 py-2 text-xs">${escapeHtml(followupDate)}</td>
                    <td class="px-3 py-2 text-xs">
                        <span class="${typeBadge} px-2 py-1 rounded">${escapeHtml(row.send_type_label || row.send_type || '')}</span>
                    </td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.site_name || '')}</td>
                    <td class="px-3 py-2 text-xs font-medium">${escapeHtml(row.responsible_name || '')}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.phone_number || '')}</td>
                    <td class="px-3 py-2 text-xs">
                        <span class="${badge} px-2 py-1 rounded">${escapeHtml(row.response_status)}</span>
                    </td>
                    <td class="px-3 py-2 text-xs">${row.answered_count || 0}/${row.vehicle_count || 0}</td>
                    <td class="px-3 py-2 text-xs text-gray-600">${escapeHtml(sentAt)}</td>
                    <td class="px-3 py-2 text-xs text-gray-600">${escapeHtml(answeredAt)}</td>
                    <td class="px-3 py-2 text-xs text-center whitespace-nowrap">
                        <button onclick="toggleFollowupItems(${row.id})" class="bg-blue-100 text-blue-800 px-2 py-1 rounded hover:bg-blue-200">Ver detalle</button>
                        <button onclick="deleteOperationalFollowup(${row.id})" class="bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200">Eliminar</button>
                    </td>
                </tr>
                <tr id="followup-items-${row.id}" class="hidden bg-slate-50">
                    <td colspan="10" class="px-3 py-3 text-xs text-gray-600">Cargando detalle...</td>
                </tr>
            `;
        }).join('');
        applyOperationalTableSort('operationalFollowupsTable');
        renderPagination('followups', data.pagination, loadOperationalFollowups);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="10" class="text-center py-6 text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function toggleFollowupItems(followupId) {
    const row = document.getElementById(`followup-items-${followupId}`);
    if (!row) return;
    if (!row.classList.contains('hidden')) {
        row.classList.add('hidden');
        return;
    }

    row.classList.remove('hidden');
    const cell = row.querySelector('td');
    try {
        const response = await fetch(`${API_URL}/api/operational/followups/${followupId}/items`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error cargando detalle');
        const items = data.items || [];
        if (items.length === 0) {
            cell.innerHTML = '<div class="text-gray-500">Este seguimiento no tiene placas asociadas.</div>';
            return;
        }

        cell.innerHTML = `
            <div class="font-semibold mb-2">Historial de respuestas del seguimiento</div>
            <div class="overflow-x-auto border rounded bg-white">
                <table class="w-full border-collapse">
                    <thead>
                        <tr class="bg-gray-50">
                            <th class="px-2 py-2 text-left border-b">#</th>
                            <th class="px-2 py-2 text-left border-b">Placa</th>
                            <th class="px-2 py-2 text-left border-b">Estado anterior</th>
                            <th class="px-2 py-2 text-left border-b">Estado actual</th>
                            <th class="px-2 py-2 text-left border-b">Respuesta</th>
                            <th class="px-2 py-2 text-left border-b">Observacion</th>
                            <th class="px-2 py-2 text-left border-b">Hora respuesta</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${items.map(item => `
                            <tr class="border-b">
                                <td class="px-2 py-2">${item.item_number}</td>
                                <td class="px-2 py-2 font-medium">${escapeHtml(item.plate || '')}</td>
                                <td class="px-2 py-2">${escapeHtml(item.previous_status_name || '-')}</td>
                                <td class="px-2 py-2">${escapeHtml(item.current_status_name || '-')}</td>
                                <td class="px-2 py-2">${escapeHtml(item.response_text || item.response_status || 'Pendiente')}</td>
                                <td class="px-2 py-2">${escapeHtml(item.observation || '')}</td>
                                <td class="px-2 py-2">${escapeHtml(item.answered_at_co || '-')}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    } catch (error) {
        cell.innerHTML = `<div class="text-red-600">Error: ${escapeHtml(error.message)}</div>`;
    }
}

async function loadDocumentExpirations() {
    const tbody = document.getElementById('documentExpirationsTable');
    if (!tbody) return;
    try {
        const paging = operationalPaging.documents;
        const search = document.getElementById('documentSearch')?.value.trim() || '';
        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit
        });
        if (search) params.set('search', search);

        const response = await fetch(`${API_URL}/api/operational/document-expirations?${params}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error cargando vencimientos');

        const rows = data.documents || [];
        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="text-center py-6 text-gray-500">Sin vencimientos registrados</td></tr>';
            renderPagination('documents', data.pagination, loadDocumentExpirations);
            return;
        }

        tbody.innerHTML = rows.map(row => {
            const days = Number(row.days_remaining);
            const daysClass = days < 0
                ? 'bg-red-100 text-red-800'
                : (days <= 30 ? 'bg-yellow-100 text-yellow-800' : 'bg-green-100 text-green-800');
            const daysText = days < 0 ? `Vencido ${Math.abs(days)} dias` : `${days} dias`;
            return `
                <tr class="hover:bg-gray-50 border-b">
                    <td class="px-3 py-2 text-xs font-medium">${escapeHtml(row.plate || '')}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(documentTypeLabels[row.document_type] || row.document_type || '')}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.expiry_date_co || '')}</td>
                    <td class="px-3 py-2 text-xs"><span class="${daysClass} px-2 py-1 rounded">${escapeHtml(daysText)}</span></td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.last_change_date_co || '')}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.last_change_km || '')}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.next_change_km || '')}</td>
                    <td class="px-3 py-2 text-xs">${escapeHtml(row.observation || '')}</td>
                    <td class="px-3 py-2 text-xs text-center whitespace-nowrap">
                        <button onclick="editDocumentExpiration(${row.id}, '${escapeHtml(row.plate || '')}', '${escapeHtml(row.document_type || '')}', '${String(row.expiry_date || '').slice(0, 10)}', '${String(row.last_change_date || '').slice(0, 10)}', '${escapeHtml(row.last_change_km || '')}', '${escapeHtml(row.next_change_km || '')}', '${escapeHtml(row.observation || '').replace(/'/g, '&#39;')}')" class="bg-blue-100 text-blue-800 px-2 py-1 rounded hover:bg-blue-200">Editar</button>
                        <button onclick="deleteDocumentExpiration(${row.id})" class="bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200 ml-1">Eliminar</button>
                    </td>
                </tr>
            `;
        }).join('');
        applyOperationalTableSort('documentExpirationsTable');
        renderPagination('documents', data.pagination, loadDocumentExpirations);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="9" class="text-center py-6 text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

function renderPagination(key, pagination, reloadFn) {
    const tableIds = {
        vehicles: 'operationalVehiclesTable',
        report: 'operationalReportTable',
        followups: 'operationalFollowupsTable',
        documents: 'documentExpirationsTable'
    };
    const tbody = document.getElementById(tableIds[key]);
    if (!tbody || !pagination) return;

    const tableWrapper = tbody.closest('.overflow-x-auto');
    if (!tableWrapper) return;

    let container = document.getElementById(`pagination-${key}`);
    if (!container) {
        container = document.createElement('div');
        container.id = `pagination-${key}`;
        container.className = 'flex flex-wrap items-center justify-between gap-2 mt-3 text-xs text-gray-600';
        tableWrapper.insertAdjacentElement('afterend', container);
    }

    const start = pagination.total === 0 ? 0 : ((pagination.page - 1) * pagination.limit) + 1;
    const end = Math.min(pagination.page * pagination.limit, pagination.total);
    container.innerHTML = `
        <div>${start}-${end} de ${pagination.total}</div>
        <div class="flex items-center gap-2">
            <select class="border rounded px-2 py-1 bg-white" data-page-size="${key}">
                ${[10, 25, 50, 100].map(size => `<option value="${size}" ${pagination.limit === size ? 'selected' : ''}>${size}</option>`).join('')}
            </select>
            <button class="border rounded px-3 py-1 bg-white disabled:opacity-50" data-page-prev="${key}" ${pagination.hasPrev ? '' : 'disabled'}>Anterior</button>
            <span>Pagina ${pagination.page} de ${pagination.totalPages}</span>
            <button class="border rounded px-3 py-1 bg-white disabled:opacity-50" data-page-next="${key}" ${pagination.hasNext ? '' : 'disabled'}>Siguiente</button>
        </div>
    `;

    container.querySelector(`[data-page-size="${key}"]`).onchange = (event) => {
        operationalPaging[key].limit = Number(event.target.value);
        operationalPaging[key].page = 1;
        reloadFn();
    };
    container.querySelector(`[data-page-prev="${key}"]`).onclick = () => {
        if (operationalPaging[key].page > 1) {
            operationalPaging[key].page -= 1;
            reloadFn();
        }
    };
    container.querySelector(`[data-page-next="${key}"]`).onclick = () => {
        if (pagination.hasNext) {
            operationalPaging[key].page += 1;
            reloadFn();
        }
    };
}

async function saveOperationalVehicle() {
    try {
        const plate = document.getElementById('operationalPlate').value.trim();
        const siteId = document.getElementById('operationalSiteSelect').value;
        const statusId = document.getElementById('operationalStatusSelect').value;
        const observation = document.getElementById('operationalObservation').value.trim();
        if (!plate || !siteId || !statusId) {
            showToast('Placa, sede y estado son requeridos', 'warning');
            return;
        }

        const response = await fetch(`${API_URL}/api/operational/vehicles`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plate, siteId, statusId, observation })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error guardando vehiculo');

        document.getElementById('operationalPlate').value = '';
        document.getElementById('operationalObservation').value = '';
        showToast('Vehiculo guardado', 'success');
        await Promise.all([loadOperationalVehicles(), loadOperationalReport()]);
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function saveOperationalSite() {
    try {
        const name = document.getElementById('operationalNewSite').value.trim();
        if (!name) {
            showToast('Nombre de sede requerido', 'warning');
            return;
        }
        const response = await fetch(`${API_URL}/api/operational/sites`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error guardando sede');
        document.getElementById('operationalNewSite').value = '';
        showToast('Sede guardada', 'success');
        await loadOperationalCatalogs();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deactivateOperationalSite(siteId) {
    if (!confirm('Eliminar esta sede? No se borran los historiales ya creados.')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/sites/${siteId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error eliminando sede');
        showToast('Sede eliminada', 'success');
        await loadOperationalCatalogs();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function saveOperationalResponsible() {
    try {
        const siteId = document.getElementById('responsibleSiteSelect').value;
        const name = document.getElementById('responsibleName').value.trim();
        const phoneNumber = document.getElementById('responsiblePhone').value.trim();
        if (!siteId || !name || !phoneNumber) {
            showToast('Sede, nombre y telefono son requeridos', 'warning');
            return;
        }
        const url = editingOperationalResponsibleId
            ? `${API_URL}/api/operational/responsibles/${editingOperationalResponsibleId}`
            : `${API_URL}/api/operational/responsibles`;
        const response = await fetch(url, {
            method: editingOperationalResponsibleId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ siteId, name, phoneNumber })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error guardando responsable');
        clearOperationalResponsibleForm();
        showToast('Responsable guardado', 'success');
        await loadOperationalCatalogs();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

function editOperationalResponsible(responsibleId) {
    for (const site of operationalSites) {
        const responsible = (site.responsibles || []).find(resp => resp.id === responsibleId);
        if (!responsible) continue;

        editingOperationalResponsibleId = responsible.id;
        document.getElementById('responsibleSiteSelect').value = site.id;
        document.getElementById('responsibleName').value = responsible.name || '';
        document.getElementById('responsiblePhone').value = responsible.phone_number || '';
        showToast('Editando responsable seleccionado', 'info');
        return;
    }
}

function clearOperationalResponsibleForm() {
    editingOperationalResponsibleId = null;
    document.getElementById('responsibleName').value = '';
    document.getElementById('responsiblePhone').value = '';
}

async function setOperationalVehicleOperative(vehicleId) {
    try {
        const operativeStatus = operationalStatuses.find(status => status.is_operational);
        if (!operativeStatus) {
            showToast('No existe estado Operativo configurado', 'error');
            return;
        }
        const observation = prompt('Observacion para marcar operativo:', 'Operativo') || 'Operativo';
        const response = await fetch(`${API_URL}/api/operational/vehicles/${vehicleId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ statusId: operativeStatus.id, observation })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error actualizando vehiculo');
        showToast('Vehiculo marcado como operativo', 'success');
        await Promise.all([loadOperationalVehicles(), loadOperationalReport()]);
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deactivateOperationalVehicle(vehicleId) {
    if (!confirm('Eliminar este vehiculo del seguimiento?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/vehicles/${vehicleId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error desactivando vehiculo');
        showToast('Vehiculo eliminado', 'success');
        await loadOperationalVehicles();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deactivateOperationalResponsible(responsibleId) {
    if (!confirm('Eliminar este responsable?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/responsibles/${responsibleId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error desactivando responsable');
        showToast('Responsable eliminado', 'success');
        await loadOperationalCatalogs();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deleteOperationalHistory(historyId) {
    if (!confirm('Eliminar este registro del historial?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/report/${historyId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error eliminando historial');
        showToast('Registro de historial eliminado', 'success');
        await loadOperationalReport();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deleteOperationalFollowup(followupId) {
    if (!confirm('Eliminar este registro de seguimiento?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/followups/${followupId}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error eliminando seguimiento');
        showToast('Seguimiento eliminado', 'success');
        await loadOperationalFollowups();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

function clearDocumentExpirationForm() {
    editingDocumentExpirationId = null;
    [
        'documentPlate',
        'documentExpiryDate',
        'documentObservation',
        'documentLastChangeDate',
        'documentLastChangeKm',
        'documentNextChangeKm'
    ].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.value = '';
    });
    const type = document.getElementById('documentType');
    if (type) type.value = 'soat';
}

function editDocumentExpiration(id, plate, documentType, expiryDate, lastChangeDate, lastChangeKm, nextChangeKm, observation) {
    editingDocumentExpirationId = id;
    document.getElementById('documentPlate').value = plate || '';
    document.getElementById('documentType').value = documentType || 'soat';
    document.getElementById('documentExpiryDate').value = expiryDate || '';
    document.getElementById('documentLastChangeDate').value = lastChangeDate || '';
    document.getElementById('documentLastChangeKm').value = lastChangeKm || '';
    document.getElementById('documentNextChangeKm').value = nextChangeKm || '';
    document.getElementById('documentObservation').value = observation || '';
    showOperationalTab('documents');
    showToast('Editando vencimiento seleccionado', 'info');
}

async function saveDocumentExpiration() {
    try {
        const plate = document.getElementById('documentPlate').value.trim();
        const documentType = document.getElementById('documentType').value;
        const expiryDate = document.getElementById('documentExpiryDate').value;
        const lastChangeDate = document.getElementById('documentLastChangeDate').value;
        const lastChangeKm = document.getElementById('documentLastChangeKm').value;
        const nextChangeKm = document.getElementById('documentNextChangeKm').value;
        const observation = document.getElementById('documentObservation').value.trim();
        if (!plate || !documentType || !expiryDate) {
            showToast('Placa, documento y fecha de vencimiento son requeridos', 'warning');
            return;
        }

        const url = editingDocumentExpirationId
            ? `${API_URL}/api/operational/document-expirations/${editingDocumentExpirationId}`
            : `${API_URL}/api/operational/document-expirations`;
        const response = await fetch(url, {
            method: editingDocumentExpirationId ? 'PUT' : 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                plate,
                documentType,
                expiryDate,
                lastChangeDate: lastChangeDate || null,
                lastChangeKm: lastChangeKm || null,
                nextChangeKm: nextChangeKm || null,
                observation
            })
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error guardando vencimiento');

        clearDocumentExpirationForm();
        showToast('Vencimiento guardado', 'success');
        await loadDocumentExpirations();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function deleteDocumentExpiration(id) {
    if (!confirm('Eliminar este vencimiento?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/document-expirations/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error eliminando vencimiento');
        showToast('Vencimiento eliminado', 'success');
        await loadDocumentExpirations();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function downloadDocumentExpirationsReport() {
    try {
        const response = await fetch(`${API_URL}/api/operational/document-expirations`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error descargando vencimientos');
        const rows = (data.documents || []).map(row => ({
            Placa: row.plate || '',
            Documento: documentTypeLabels[row.document_type] || row.document_type || '',
            Vencimiento: row.expiry_date_co || '',
            'Dias faltantes': row.days_remaining,
            'Fecha ultimo cambio aceite': row.last_change_date_co || '',
            'Km ultimo cambio aceite': row.last_change_km || '',
            'Km proximo cambio aceite': row.next_change_km || '',
            Observacion: row.observation || ''
        }));

        if (typeof XLSX !== 'undefined') {
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Vencimientos');
            XLSX.writeFile(workbook, `vencimientos-documentos-${new Date().toISOString().slice(0, 10)}.xlsx`);
            return;
        }

        const csvRows = [
            Object.keys(rows[0] || { Placa: '', Documento: '', Vencimiento: '', 'Dias faltantes': '', Observacion: '' }),
            ...rows.map(row => Object.values(row))
        ];
        const csv = csvRows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `vencimientos-documentos-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function sendOperationalDaily() {
    if (!confirm('Enviar ahora el seguimiento de operatividad a los responsables con vehiculos no operativos?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/send-daily`, { method: 'POST' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error enviando seguimiento');
        showToast(`Seguimiento enviado a ${(data.sent || []).length} responsables`, 'success');
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

async function downloadOperationalReport() {
    try {
        const [historyResponse, followupsResponse, documentsResponse] = await Promise.all([
            fetch(`${API_URL}/api/operational/report`),
            fetch(`${API_URL}/api/operational/followups?date=all`),
            fetch(`${API_URL}/api/operational/document-expirations`)
        ]);
        const data = await historyResponse.json();
        const followupsData = await followupsResponse.json();
        const documentsData = await documentsResponse.json();
        if (!data.success) throw new Error(data.error || 'Error descargando reporte');
        if (!followupsData.success) throw new Error(followupsData.error || 'Error descargando seguimientos');
        if (!documentsData.success) throw new Error(documentsData.error || 'Error descargando vencimientos');

        const rows = (data.report || []).map(row => ({
            'Fecha GMT-5': row.changed_at_co || '',
            Sede: row.site_name || '',
            Placa: row.plate || '',
            'Estado anterior': row.old_status || '',
            'Estado nuevo': row.new_status || '',
            Observacion: row.observation || '',
            Origen: row.source || '',
            Telefono: row.changed_by_phone || ''
        }));

        const followupRows = (followupsData.followups || []).map(row => ({
            Fecha: row.followup_date_co || '',
            Tipo: row.send_type_label || row.send_type || '',
            Sede: row.site_name || '',
            Responsable: row.responsible_name || '',
            Telefono: row.phone_number || '',
            Respuesta: row.response_status || '',
            Vehiculos: `${row.answered_count || 0}/${row.vehicle_count || 0}`,
            'Ejecucion GMT-5': row.sent_at_co || '',
            'Hora respuesta GMT-5': row.response_at_co || ''
        }));

        const documentRows = (documentsData.documents || []).map(row => ({
            Placa: row.plate || '',
            Documento: documentTypeLabels[row.document_type] || row.document_type || '',
            Vencimiento: row.expiry_date_co || '',
            'Dias faltantes': row.days_remaining,
            'Fecha ultimo cambio aceite': row.last_change_date_co || '',
            'Km ultimo cambio aceite': row.last_change_km || '',
            'Km proximo cambio aceite': row.next_change_km || '',
            Observacion: row.observation || ''
        }));

        if (typeof XLSX !== 'undefined') {
            const worksheet = XLSX.utils.json_to_sheet(rows);
            const followupWorksheet = XLSX.utils.json_to_sheet(followupRows);
            const workbook = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(workbook, worksheet, 'Historial');
            XLSX.utils.book_append_sheet(workbook, followupWorksheet, 'Seguimientos');
            XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(documentRows), 'Vencimientos');
            XLSX.writeFile(workbook, `reporte-operatividad-${new Date().toISOString().slice(0, 10)}.xlsx`);
            return;
        }

        const csvRows = [
            Object.keys(rows[0] || { 'Fecha GMT-5': '', Sede: '', Placa: '', 'Estado anterior': '', 'Estado nuevo': '', Observacion: '', Origen: '', Telefono: '' }),
            ...rows.map(row => Object.values(row))
        ];
        const csv = csvRows.map(row => row.map(value => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `reporte-operatividad-${new Date().toISOString().slice(0, 10)}.csv`;
        link.click();
        URL.revokeObjectURL(link.href);
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}
