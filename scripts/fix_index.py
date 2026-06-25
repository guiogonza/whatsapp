with open('/root/whatsapp-api/public/index.html', 'r') as f:
    content = f.read()

old_btn = 'Enviar seguimiento ahora\n                            </button>'
new_btn = ('Enviar seguimiento ahora\n                            </button>\n'
           '                            <button onclick="sendDocumentDaily()" '
           'class="bg-teal-600 text-white px-4 py-2 rounded-lg hover:bg-teal-700 transition-colors text-sm">\n'
           '                                Enviar seguimiento docs\n'
           '                            </button>')
content = content.replace(old_btn, new_btn, 1)

old_sites = 'id="operationalSitesList" class="space-y-2 text-sm"'
new_sites = 'id="operationalSitesList" class="space-y-2 text-sm max-h-80 overflow-y-auto pr-1"'
content = content.replace(old_sites, new_sites, 1)

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(content)
print('OK')
