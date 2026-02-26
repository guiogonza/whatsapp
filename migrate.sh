# Script de migración al servidor refactorizado
# Ejecuta: ./migrate.sh

echo "🔄 === MIGRACIÓN AL SERVIDOR REFACTORIZADO ==="
echo ""

# Backup del servidor viejo
echo "📦 1/4 - Creando backup del servidor anterior..."
if [ -f "server-baileys.js" ]; then
    cp server-baileys.js server-baileys-old.js
    echo "✅ Backup creado: server-baileys-old.js"
else
    echo "⚠️ server-baileys.js no encontrado"
fi

# Renombrar nuevo servidor
echo ""
echo "🔄 2/4 - Activando nuevo servidor..."
if [ -f "server-baileys-new.js" ]; then
    mv server-baileys-new.js server-baileys.js
    echo "✅ Nuevo servidor activado: server-baileys.js"
else
    echo "❌ server-baileys-new.js no encontrado"
    exit 1
fi

# Instalar dependencias
echo ""
echo "📦 3/4 - Instalando dependencias de testing..."
npm install --save-dev jest supertest
echo "✅ Dependencias instaladas"

# Ejecutar tests
echo ""
echo "🧪 4/4 - Ejecutando tests..."
npm test

echo ""
echo "✅ === MIGRACIÓN COMPLETADA ==="
echo ""
echo "📝 Próximos pasos:"
echo "1. Configurar variables de entorno FX en .env"
echo "2. Crear sesiones FX: POST /api/fx/sessions/create-all"
echo "3. Verificar que todo funcione: npm start"
echo ""
echo "🔙 Para revertir: mv server-baileys-old.js server-baileys.js"
