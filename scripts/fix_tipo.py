TIPO_TD = (
    '<td class="px-3 py-2 text-xs">'
    '${(() => { const cb = row.created_by || \'\'; '
    'if (cb === \'excel_import\') return \'<span class="bg-blue-100 text-blue-800 px-2 py-1 rounded">Excel</span>\'; '
    'if (cb === \'dashboard\') return \'<span class="bg-gray-100 text-gray-700 px-2 py-1 rounded">Manual</span>\'; '
    'if (cb === \'bot\' || cb === \'whatsapp\') return \'<span class="bg-green-100 text-green-800 px-2 py-1 rounded">Bot</span>\'; '
    'return escapeHtml(cb) || \'-\'; })()}'
    '</td>'
)

# ── app.js ───────────────────────────────────────────────────────────
with open('/root/whatsapp-api/public/js/app.js', 'r') as f:
    js = f.read()

old_obs_td = '                    <td class="px-3 py-2 text-xs">${escapeHtml(row.observation || \'\')}</td>\n                    <td class="px-3 py-2 text-xs text-center whitespace-nowrap">\n                        <button onclick="editDocumentExpiration'
new_obs_td = '                    <td class="px-3 py-2 text-xs">${escapeHtml(row.observation || \'\')}</td>\n                    ' + TIPO_TD + '\n                    <td class="px-3 py-2 text-xs text-center whitespace-nowrap">\n                        <button onclick="editDocumentExpiration'

js = js.replace(old_obs_td, new_obs_td, 1)

# Fix colspan 10 -> 11 for documents error row (the one after applyOperationalTableSort documentExpirationsTable)
js = js.replace(
    "applyOperationalTableSort('documentExpirationsTable');\n        renderPagination('documents', data.pagination, loadDocumentExpirations);\n    } catch (error) {\n        tbody.innerHTML = `<tr><td colspan=\"10\"",
    "applyOperationalTableSort('documentExpirationsTable');\n        renderPagination('documents', data.pagination, loadDocumentExpirations);\n    } catch (error) {\n        tbody.innerHTML = `<tr><td colspan=\"11\"",
    1
)

with open('/root/whatsapp-api/public/js/app.js', 'w') as f:
    f.write(js)
print('app.js OK')

# ── index.html ───────────────────────────────────────────────────────
with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

old_th = ('<th class="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b">Observacion</th>\n'
          '                                    <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 border-b">Acciones</th>\n'
          '                                </tr>\n'
          '                            </thead>\n'
          '                            <tbody id="documentExpirationsTable">\n'
          '                                <tr><td colspan="10"')
new_th = ('<th class="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b">Observacion</th>\n'
          '                                    <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b">Tipo</th>\n'
          '                                    <th class="px-3 py-2 text-center text-xs font-medium text-gray-500 border-b">Acciones</th>\n'
          '                                </tr>\n'
          '                            </thead>\n'
          '                            <tbody id="documentExpirationsTable">\n'
          '                                <tr><td colspan="11"')

if old_th in html:
    html = html.replace(old_th, new_th, 1)
    print('index.html th found and replaced')
else:
    # Try alternative format
    alt_old = 'Observacion</th>'
    idx = html.find('documentExpirationsTable')
    th_start = html.rfind(alt_old, 0, idx)
    if th_start != -1:
        insert_pos = html.find('</th>', th_start) + 5
        html = html[:insert_pos] + '\n                                    <th class="px-3 py-2 text-left text-xs font-medium text-gray-500 border-b">Tipo</th>' + html[insert_pos:]
        html = html.replace('<tr><td colspan="10" class="text-center py-6 text-gray-500">Cargando...</td></tr>\n                            </tbody>\n                        </table>\n                    </div>\n                    </div>\n                </div>\n            </section>\n\n            <!-- ========================', 
                            '<tr><td colspan="11" class="text-center py-6 text-gray-500">Cargando...</td></tr>\n                            </tbody>\n                        </table>\n                    </div>\n                    </div>\n                </div>\n            </section>\n\n            <!-- ========================', 1)
        print('index.html alt replacement done')
    else:
        print('index.html: could not find pattern')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
