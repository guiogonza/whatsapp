with open('/root/whatsapp-api/public/js/app.js', 'r') as f:
    js = f.read()

# Fix plate → search parameter
js = js.replace("params.set('plate', vehiclePlateFilter)", "params.set('search', vehiclePlateFilter)", 1)
print('Fix plate→search OK' if "params.set('search', vehiclePlateFilter)" in js else 'ERROR')

# Add reportPlateFilter variable if not exists
if 'reportPlateFilter' not in js:
    js = js.replace(
        "let reportDateFilter = new Date().toISOString().slice(0, 10);",
        "let reportDateFilter = new Date().toISOString().slice(0, 10);\nlet reportPlateFilter = '';"
    )
    print('reportPlateFilter variable OK')

# Add reportPlateFilter to loadOperationalReport params
old_report = """        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit,
            date: reportDateFilter
        });
        const response = await fetch(`${API_URL}/api/operational/report?${params}`);"""
new_report = """        const params = new URLSearchParams({
            paginate: 'true',
            page: paging.page,
            limit: paging.limit,
            date: reportDateFilter
        });
        if (reportPlateFilter) params.set('plate', reportPlateFilter);
        const response = await fetch(`${API_URL}/api/operational/report?${params}`);"""
if old_report in js:
    js = js.replace(old_report, new_report, 1)
    print('reportPlateFilter param OK')
else:
    print('ERROR: report params not found')

# Add setReportPlateFilter function after setReportDateFilter
old_fn_end = """    operationalPaging.report.page = 1;
    loadOperationalReport();
}"""
new_fn_end = """    operationalPaging.report.page = 1;
    loadOperationalReport();
}

function setReportPlateFilter(value) {
    reportPlateFilter = (value || '').trim().toUpperCase();
    operationalPaging.report.page = 1;
    loadOperationalReport();
}"""
# Only add if not already there
if 'setReportPlateFilter' not in js:
    # Find the last occurrence of the pattern (the setReportDateFilter function end)
    idx = js.rfind(old_fn_end)
    if idx != -1:
        js = js[:idx] + new_fn_end + js[idx+len(old_fn_end):]
        print('setReportPlateFilter function OK')
    else:
        print('ERROR: could not find insertion point for setReportPlateFilter')
else:
    print('setReportPlateFilter already exists')

with open('/root/whatsapp-api/public/js/app.js', 'w') as f:
    f.write(js)
print('app.js saved')

# Fix index.html: add plate filter to historial header
with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

old_hist = """                                <div class="flex items-center gap-2">
                                    <input id="reportDateFilterInput" type="date" class="border rounded-lg px-2 py-1 text-xs" onchange="setReportDateFilter(this.value)">
                                    <button onclick="setReportDateFilter('all')" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs">Todos</button>
                                </div>"""
new_hist = """                                <div class="flex items-center gap-2 flex-wrap">
                                    <input id="reportDateFilterInput" type="date" class="border rounded-lg px-2 py-1 text-xs" onchange="setReportDateFilter(this.value)">
                                    <input id="reportPlateFilterInput" type="text" placeholder="Placa..." class="border rounded-lg px-2 py-1 text-xs w-24" oninput="setReportPlateFilter(this.value)">
                                    <button onclick="setReportDateFilter('all')" class="bg-gray-200 text-gray-700 px-2 py-1 rounded text-xs">Todos</button>
                                </div>"""
if old_hist in html:
    html = html.replace(old_hist, new_hist, 1)
    print('index.html historial plate filter OK')
else:
    print('ERROR: historial header not found in index.html')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
print('index.html saved')
