DOC_FOLLOWUP_SECTION = '''
            <section class="bg-white border rounded-lg p-4">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="font-semibold">Seguimiento documentos 9 a. m.</h2>
                    <div class="flex flex-wrap items-center gap-2">
                        <input id="docFollowupDateFilter" type="date" class="border rounded-lg px-3 py-2 text-sm" onchange="setDocFollowupDateFilter(this.value)">
                        <button id="docFollowupAllBtn" onclick="loadAllDocumentFollowups()" class="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 text-sm">Todos</button>
                        <button onclick="loadDocumentFollowups()" class="bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 text-sm">Actualizar</button>
                    </div>
                </div>
                <div class="overflow-x-auto border rounded-lg">
                    <table class="w-full border-collapse">
                        <thead>
                            <tr class="bg-gray-50">
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Fecha</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Tipo</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Sede</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Responsable</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Telefono</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Docs alertados</th>
                                <th class="px-3 py-2 text-left text-xs font-medium text-gray-700 border-b">Ejecucion (GMT-5)</th>
                                <th class="px-3 py-2 text-center text-xs font-medium text-gray-700 border-b">Acciones</th>
                            </tr>
                        </thead>
                        <tbody id="documentFollowupsTable">
                            <tr><td colspan="8" class="text-center py-6 text-gray-500">Cargando...</td></tr>
                        </tbody>
                    </table>
                </div>
            </section>'''

# ── operatividad.html ────────────────────────────────────────────────
with open('/root/whatsapp-api/public/operatividad.html', 'r') as f:
    html = f.read()

# Quitar la seccion del panel-main
old_section = '''
            <section class="bg-white border rounded-lg p-4">
                <div class="flex items-center justify-between mb-3">
                    <h2 class="font-semibold">Seguimiento documentos 9 a. m.</h2>'''
new_before_close = ''
# Encontrar inicio y fin de la seccion en panel-main
start = html.find('\n            <section class="bg-white border rounded-lg p-4">\n                <div class="flex items-center justify-between mb-3">\n                    <h2 class="font-semibold">Seguimiento documentos 9 a. m.</h2>')
end_marker = '            </section>\n            </div>\n\n            <div id="operational-panel-documents"'
end = html.find(end_marker, start)
if start != -1 and end != -1:
    html = html[:start] + '\n            </div>\n\n            <div id="operational-panel-documents"' + html[end + len(end_marker):]

# Agregar al final del panel-documents (antes de su cierre)
old_panel_end = '                </section>\n            </div>\n        </main>'
new_panel_end = '                </section>' + DOC_FOLLOWUP_SECTION + '\n            </div>\n        </main>'
html = html.replace(old_panel_end, new_panel_end, 1)

with open('/root/whatsapp-api/public/operatividad.html', 'w') as f:
    f.write(html)
print('operatividad.html OK')

# ── index.html ───────────────────────────────────────────────────────
with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

old_idx_end = '                                </tbody>\n                            </table>\n                        </div>\n                    </div>\n                </div>\n            </section>\n\n            <!-- ========================'
new_idx_end = ('                                </tbody>\n                            </table>\n                        </div>\n                    </div>\n                </div>'
               + DOC_FOLLOWUP_SECTION.replace('            <section', '\n                <section').replace('            </section>', '\n                </section>')
               + '\n            </section>\n\n            <!-- ========================')
html = html.replace(old_idx_end, new_idx_end, 1)

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
print('index.html OK')

# ── app.js ───────────────────────────────────────────────────────────
with open('/root/whatsapp-api/public/js/app.js', 'r') as f:
    js = f.read()

# 1. Agregar variable docFollowupDateFilter
js = js.replace(
    "let followupDateFilter = new Date().toISOString().slice(0, 10);",
    "let followupDateFilter = new Date().toISOString().slice(0, 10);\nlet docFollowupDateFilter = new Date().toISOString().slice(0, 10);",
    1
)

# 2. Agregar docFollowups al paging
js = js.replace(
    "    documents: { page: 1, limit: 10 }\n};",
    "    documents: { page: 1, limit: 10 },\n    docFollowups: { page: 1, limit: 10 }\n};",
    1
)

# 3. Actualizar loadOperational para llamar loadDocumentFollowups
js = js.replace(
    "        loadOperationalFollowups(),\n        loadDocumentExpirations()\n    ]);",
    "        loadOperationalFollowups(),\n        loadDocumentFollowups(),\n        loadDocumentExpirations()\n    ]);",
    1
)

# 4. Agregar funciones despues de sendOperationalDaily
NEW_FUNCS = '''
async function sendDocumentDaily() {
    if (!confirm('Enviar ahora el seguimiento de documentos y cambios de aceite a los responsables?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/send-document-daily`, { method: 'POST' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error enviando seguimiento documentos');
        showToast(`Seguimiento documentos enviado a ${(data.sent || []).length} responsables`, 'success');
        await loadDocumentFollowups();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}

function setDocFollowupDateFilter(value) {
    docFollowupDateFilter = value || new Date().toISOString().slice(0, 10);
    operationalPaging.docFollowups.page = 1;
    const input = document.getElementById('docFollowupDateFilter');
    if (input) input.value = docFollowupDateFilter === 'all' ? '' : docFollowupDateFilter;
    const allBtn = document.getElementById('docFollowupAllBtn');
    if (allBtn) {
        allBtn.className = docFollowupDateFilter === 'all'
            ? 'bg-teal-600 text-white px-3 py-2 rounded-lg hover:bg-teal-700 text-sm'
            : 'bg-gray-200 text-gray-700 px-3 py-2 rounded-lg hover:bg-gray-300 text-sm';
        allBtn.textContent = docFollowupDateFilter === 'all' ? 'Todos activos' : 'Todos';
    }
    loadDocumentFollowups();
}

function loadAllDocumentFollowups() {
    setDocFollowupDateFilter('all');
}

async function loadDocumentFollowups() {
    const tbody = document.getElementById('documentFollowupsTable');
    if (!tbody) return;
    try {
        const paging = operationalPaging.docFollowups;
        const params = new URLSearchParams({ paginate: 'true', page: paging.page, limit: paging.limit });
        if (docFollowupDateFilter && docFollowupDateFilter !== 'all') params.set('date', docFollowupDateFilter);
        const response = await fetch(`${API_URL}/api/operational/document-followups?${params}`);
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error cargando seguimientos documentos');
        const rows = data.followups || [];
        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="text-center py-6 text-gray-500">Sin seguimientos de documentos enviados</td></tr>';
            renderPagination('docFollowups', data.pagination, loadDocumentFollowups);
            return;
        }
        tbody.innerHTML = rows.map(row => {
            const typeBadge = row.send_type === 'manual' ? 'bg-blue-100 text-blue-800' : 'bg-slate-100 text-slate-800';
            const typeLabel = row.send_type === 'manual' ? 'Manual' : 'Automatico';
            return `<tr class="hover:bg-gray-50 border-b">
                <td class="px-3 py-2 text-xs">${escapeHtml(row.followup_date_co || '')}</td>
                <td class="px-3 py-2 text-xs"><span class="${typeBadge} px-2 py-1 rounded">${typeLabel}</span></td>
                <td class="px-3 py-2 text-xs">${escapeHtml((row.site_name || '').toUpperCase())}</td>
                <td class="px-3 py-2 text-xs font-medium">${escapeHtml(row.responsible_name || '')}</td>
                <td class="px-3 py-2 text-xs">${escapeHtml(row.phone_number || '')}</td>
                <td class="px-3 py-2 text-xs">${row.doc_count || 0}</td>
                <td class="px-3 py-2 text-xs text-gray-600">${escapeHtml(row.sent_at_co || '')}</td>
                <td class="px-3 py-2 text-xs text-center">
                    <button onclick="deleteDocumentFollowupRow(${row.id})" class="bg-red-100 text-red-800 px-2 py-1 rounded hover:bg-red-200">Eliminar</button>
                </td>
            </tr>`;
        }).join('');
        renderPagination('docFollowups', data.pagination, loadDocumentFollowups);
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-red-500">Error: ${escapeHtml(error.message)}</td></tr>`;
    }
}

async function deleteDocumentFollowupRow(id) {
    if (!confirm('Eliminar este registro de seguimiento documentos?')) return;
    try {
        const response = await fetch(`${API_URL}/api/operational/document-followups/${id}`, { method: 'DELETE' });
        const data = await response.json();
        if (!data.success) throw new Error(data.error || 'Error eliminando');
        showToast('Eliminado', 'success');
        await loadDocumentFollowups();
    } catch (error) {
        showToast(`Error: ${error.message}`, 'error');
    }
}
'''

js = js.replace(
    "\nasync function downloadOperationalReport() {",
    NEW_FUNCS + "\nasync function downloadOperationalReport() {",
    1
)

with open('/root/whatsapp-api/public/js/app.js', 'w') as f:
    f.write(js)
print('app.js OK')
