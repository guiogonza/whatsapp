with open('/root/whatsapp-api/public/index.html', 'r') as f:
    html = f.read()

# Replace all table wrapper divs in the operational section with h-72 scroll
# They all follow the pattern: class="overflow-x-auto border rounded-lg"> + table + thead > tr.bg-gray-50
# We need to add sticky thead too
import re

# Pattern: <div class="overflow-x-auto border rounded-lg">\n...<table...>\n...<thead>\n...<tr class="bg-gray-50">
old = '<div class="overflow-x-auto border rounded-lg">'
new = '<div class="overflow-auto border rounded-lg h-72">'

# Also update thead to be sticky
old_thead = '<thead>'
new_thead = '<thead class="sticky top-0 z-10">'

count_div = html.count(old)
print(f'Found {count_div} occurrences of overflow-x-auto border rounded-lg')

# Replace all
html = html.replace(old, new)
html = html.replace(old_thead, new_thead)

count_new = html.count(new)
print(f'Replaced: {count_new} divs updated')

with open('/root/whatsapp-api/public/index.html', 'w') as f:
    f.write(html)
print('index.html saved')
