with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

# Insertar la sección seguimiento justo antes del cierre del panel de documentos
old = """                            </table>
                        </div>
                    </div>
                </div>

            </section>

            <!-- ======================== SECCIÓN: MENSAJES plataformagps ======================== -->"""

new = """                            </table>
                        </div>
                    </div>

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
                        </div>
                </div>

            </section>

            <!-- ======================== SECCIÓN: MENSAJES plataformagps ======================== -->"""

if old in html:
    html = html.replace(old, new, 1)
    print('Sección seguimiento agregada dentro de operational-panel-documents OK')
else:
    print('PATRON NO ENCONTRADO')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
