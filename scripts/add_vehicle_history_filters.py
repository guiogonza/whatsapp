with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

# 1. Vehículos: agregar filtro de placa en el header
old_vehicles_header = '''                            <div class="flex items-center justify-between mb-3">
                                <h3 class="font-semibold">Vehiculos</h3>
                                <label class="text-sm flex items-center gap-2">
                                    <input id="operationalOnlyNonOperational" type="checkbox" checked onchange="loadOperationalVehicles()">
                                    Solo no operativos
                                </label>
                            </div>'''

new_vehicles_header = '''                            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <h3 class="font-semibold">Vehiculos</h3>
                                <div class="flex items-center gap-2 flex-wrap">
                                    <input id="vehiclePlateFilterInput" type="text" placeholder="Buscar placa" class="border rounded-lg px-2 py-1 text-xs w-28" oninput="setVehiclePlateFilter(this.value)">
                                    <label class="text-sm flex items-center gap-2">
                                        <input id="operationalOnlyNonOperational" type="checkbox" checked onchange="loadOperationalVehicles()">
                                        Solo no operativos
                                    </label>
                                </div>
                            </div>'''

if old_vehicles_header in html:
    html = html.replace(old_vehicles_header, new_vehicles_header, 1)
    print('Vehiculos header OK')
else:
    print('ERROR: vehiculos header no encontrado')

# 2. Historial: agregar filtro de fecha en el header
old_historial_header = '''                        <div>
                            <h3 class="font-semibold mb-3">Historial</h3>
                            <div class="overflow-x-auto border rounded-lg">'''

new_historial_header = '''                        <div>
                            <div class="flex items-center justify-between mb-3 flex-wrap gap-2">
                                <h3 class="font-semibold">Historial</h3>
                                <div class="flex items-center gap-2">
                                    <input id="reportDateFilterInput" type="date" class="border rounded-lg px-2 py-1 text-xs" onchange="setReportDateFilter(this.value)">
                                    <button onclick="setReportDateFilter('all')" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs">Todos</button>
                                </div>
                            </div>
                            <div class="overflow-x-auto border rounded-lg">'''

if old_historial_header in html:
    html = html.replace(old_historial_header, new_historial_header, 1)
    print('Historial header OK')
else:
    print('ERROR: historial header no encontrado')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
print('index.html guardado')

# ── app.js ────────────────────────────────────────────────────────────
with open('/root/whatsapp-api/public/js/app.js', 'r') as f:
    js = f.read()

# 3. Agregar variables vehiclePlateFilter y reportDateFilter
old_vars = "let followupDateFilter = new Date().toISOString().slice(0, 10);"
new_vars = """let followupDateFilter = new Date().toISOString().slice(0, 10);
let vehiclePlateFilter = '';
let reportDateFilter = new Date().toISOString().slice(0, 10);"""
if old_vars in js:
    js = js.replace(old_vars, new_vars, 1)
    print('Variables OK')
else:
    print('ERROR: variable followupDateFilter no encontrada')

# 4. Actualizar loadOperationalVehicles para usar vehiclePlateFilter
old_vehicles_params = """        const params = new URLSearchParams({
            onlyNonOperational,
            paginate: 'true',
            page: paging.page,
            limit: paging.limit
        });"""
new_vehicles_params = """        const params = new URLSearchParams({
            onlyNonOperational,
            paginate: 'true',
            page: paging.page,
            limit: paging.limit
        });
        if (vehiclePlateFilter) params.set('plate', vehiclePlateFilter);"""
if old_vehicles_params in js:
    js = js.replace(old_vehicles_params, new_vehicles_params, 1)
    print('loadOperationalVehicles params OK')
else:
    print('ERROR: params de vehiculos no encontrado')

# 5. Actualizar loadOperationalReport para usar reportDateFilter
old_report_params = """        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit,
            date: followupDateFilter
        });
        const response = await fetch(`${API_URL}/api/operational/report?${params}`);"""
new_report_params = """        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit,
            date: reportDateFilter
        });
        const response = await fetch(`${API_URL}/api/operational/report?${params}`);"""
if old_report_params in js:
    js = js.replace(old_report_params, new_report_params, 1)
    print('loadOperationalReport params OK')
else:
    print('ERROR: params de report no encontrado')

# 6. Agregar funciones setVehiclePlateFilter y setReportDateFilter
# Insertarlas junto a setFollowupDateFilter
insert_after = """    followupDateFilter = value || new Date().toISOString().slice(0, 10);"""
# Find the end of setFollowupDateFilter function to insert after it
idx = js.find(insert_after)
if idx != -1:
    # Find the closing brace of that function
    close_idx = js.find('\n}', idx)
    if close_idx != -1:
        new_fns = """

function setVehiclePlateFilter(value) {
    vehiclePlateFilter = (value || '').trim().toUpperCase();
    operationalPaging.vehicles.page = 1;
    loadOperationalVehicles();
}

function setReportDateFilter(value) {
    if (value === 'all') {
        reportDateFilter = 'all';
        const input = document.getElementById('reportDateFilterInput');
        if (input) input.value = '';
    } else {
        reportDateFilter = value || new Date().toISOString().slice(0, 10);
        const input = document.getElementById('reportDateFilterInput');
        if (input) input.value = reportDateFilter;
    }
    operationalPaging.report.page = 1;
    loadOperationalReport();
}"""
        js = js[:close_idx+2] + new_fns + js[close_idx+2:]
        print('Funciones setVehiclePlateFilter y setReportDateFilter OK')
    else:
        print('ERROR: no encontre cierre de setFollowupDateFilter')
else:
    print('ERROR: setFollowupDateFilter body no encontrado')

with open('/root/whatsapp-api/public/js/app.js', 'w') as f:
    f.write(js)
print('app.js guardado')
