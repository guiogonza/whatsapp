with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

# Extraer el bloque del seguimiento (que está fuera del panel)
seg_block = """
                        <div class="bg-white border rounded-lg p-4">
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
                        </div>"""

# Quitar el bloque de donde está (fuera del panel) y el cierre extra
old_outside = seg_block + """
                </div>

            </section>"""

new_outside = """
                    </div>

            </section>"""

if old_outside in html:
    html = html.replace(old_outside, new_outside, 1)
    print('Bloque removido de fuera del panel OK')
else:
    print('ERROR: patron de remocion no encontrado')

# Ahora insertarlo DENTRO de operational-panel-documents, antes de su cierre
old_inside = """                        </div>
                    </div>

                    </div>

            </section>"""

new_inside = """                        </div>
""" + seg_block + """
                    </div>

            </section>"""

if old_inside in html:
    html = html.replace(old_inside, new_inside, 1)
    print('Bloque insertado dentro del panel OK')
else:
    # Buscar patron alternativo: el cierre del panel de documentos
    # La tabla cierra con:  </div>\n                    </div>
    # y eso cierra operational-panel-documents
    idx_docs = html.find('id="documentExpirationsTable"')
    if idx_docs != -1:
        # Encontrar el </div> que cierra operational-panel-documents despues de la tabla
        close_area = html[idx_docs:idx_docs+500]
        print(f'Area despues de documentExpirationsTable:\n{repr(close_area)}')
    else:
        print('ERROR: no encontre documentExpirationsTable')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
