with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

# Bloque a eliminar (está fuera de operational-panel-documents)
old_block = """
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

                </section>"""

if old_block in html:
    html = html.replace(old_block, '', 1)
    print('Bloque eliminado OK')
else:
    print('BLOQUE NO ENCONTRADO - buscando variantes...')
    idx = html.find('Seguimiento documentos 9 a. m.')
    print(f'  Encontrado en index: {idx}, contexto: {repr(html[idx-50:idx+100])}')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
