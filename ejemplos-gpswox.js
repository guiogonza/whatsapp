/**
 * Ejemplos de uso del módulo GPSwox
 * 
 * Este archivo contiene ejemplos de cómo interactuar con el módulo GPSwox
 * tanto desde la API como desde el código directamente.
 */

// ============================================================================
// EJEMPLO 1: Uso básico desde WhatsApp
// ============================================================================

/*
Usuario envía por WhatsApp:
  1. contacto@empresa.com
  
Bot responde:
  ✅ ¡Usuario encontrado!
  📧 Correo: contacto@empresa.com
  👤 Nombre: Juan Pérez
  🆔 ID: 123
  
  Ahora, por favor envía la placa del vehículo

Usuario envía:
  2. ABC123
  
Bot responde:
  📝 Placa formateada: ABC-123
  🔍 Validando...
  ✅ ¡Vehículo encontrado!
  🚗 Placa: ABC-123
  🔗 Asignando al usuario...
  ✅ ¡Asignación exitosa!
*/

// ============================================================================
// EJEMPLO 2: Consultar conversaciones activas (API)
// ============================================================================

// GET http://localhost:3010/api/gpswox/conversations

fetch('http://localhost:3010/api/gpswox/conversations')
  .then(res => res.json())
  .then(data => {
    console.log('Conversaciones activas:', data.stats);
    /*
    {
      "total": 2,
      "byState": {
        "waiting_email": 1,
        "waiting_plate": 1
      }
    }
    */
  });

// ============================================================================
// EJEMPLO 3: Consultar estado de conversación específica (API)
// ============================================================================

// GET http://localhost:3010/api/gpswox/conversation/573001234567

fetch('http://localhost:3010/api/gpswox/conversation/573001234567')
  .then(res => res.json())
  .then(data => {
    console.log('Estado de conversación:', data);
    /*
    {
      "success": true,
      "active": true,
      "conversation": {
        "state": "waiting_plate",
        "email": "usuario@ejemplo.com",
        "plate": null,
        "startTime": 1738972800000,
        "lastActivity": 1738972850000
      }
    }
    */
  });

// ============================================================================
// EJEMPLO 4: Iniciar conversación manualmente (API)
// ============================================================================

// POST http://localhost:3010/api/gpswox/conversation/573001234567/start

fetch('http://localhost:3010/api/gpswox/conversation/573001234567/start', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  }
})
  .then(res => res.json())
  .then(data => {
    console.log('Conversación iniciada:', data);
    /*
    {
      "success": true,
      "message": "Conversación iniciada exitosamente",
      "phoneNumber": "573001234567"
    }
    */
  });

// ============================================================================
// EJEMPLO 5: Finalizar conversación (API)
// ============================================================================

// DELETE http://localhost:3010/api/gpswox/conversation/573001234567

fetch('http://localhost:3010/api/gpswox/conversation/573001234567', {
  method: 'DELETE'
})
  .then(res => res.json())
  .then(data => {
    console.log('Conversación finalizada:', data);
    /*
    {
      "success": true,
      "message": "Conversación finalizada exitosamente"
    }
    */
  });

// ============================================================================
// EJEMPLO 6: Uso directo del módulo GPSwox (desde código Node.js)
// ============================================================================

const {
  findUserByEmail,
  findDeviceByPlate,
  assignDeviceToUser,
  formatPlate
} = require('./lib/session/gpswox-api');

async function ejemploDirecto() {
  try {
    // Buscar usuario
    const user = await findUserByEmail('admin@sistemagps.com');
    console.log('Usuario encontrado:', user);
    
    // Formatear placa
    const placa = formatPlate('ABC123');
    console.log('Placa formateada:', placa); // ABC-123
    
    // Buscar dispositivo
    const device = await findDeviceByPlate(placa);
    console.log('Dispositivo encontrado:', device);
    
    // Asignar dispositivo a usuario
    const result = await assignDeviceToUser(user.id, device.id);
    console.log('Resultado de asignación:', result);
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// ============================================================================
// EJEMPLO 7: Configuración personalizada de endpoints
// ============================================================================

// Si los endpoints de GPSwox son diferentes, edita gpswox-api.js:

/*
// OPCIÓN A: Endpoint de búsqueda de usuarios
async function findUserByEmail(email) {
  const response = await gpswoxClient.get('/api/v1/users/search', {
    params: { email: email }
  });
  // ... resto del código
}

// OPCIÓN B: Endpoint de búsqueda de dispositivos
async function findDeviceByPlate(plate) {
  const response = await gpswoxClient.get('/api/v1/objects', {
    params: { plate: plate }
  });
  // ... resto del código
}

// OPCIÓN C: Endpoint de asignación
async function assignDeviceToUser(userId, deviceId) {
  const response = await gpswoxClient.post('/api/v1/devices/assign', {
    user_id: userId,
    device_id: deviceId
  });
  // ... resto del código
}
*/

// ============================================================================
// EJEMPLO 8: Manejo de errores personalizados
// ============================================================================

const gpswoxSession = require('./lib/session/gpswox-session');

async function ejemploManejoErrores() {
  const phoneNumber = '573001234567';
  
  try {
    // Verificar si ya hay conversación activa
    if (gpswoxSession.hasActiveConversation(phoneNumber)) {
      console.log('Ya hay una conversación activa');
      
      // Obtener estado actual
      const state = gpswoxSession.getConversationState(phoneNumber);
      console.log('Estado actual:', state.state);
      
      // Finalizar si es necesario
      gpswoxSession.endConversation(phoneNumber);
    }
    
    // Iniciar nueva conversación
    gpswoxSession.startConversation(phoneNumber);
    console.log('Conversación iniciada');
    
  } catch (error) {
    console.error('Error:', error.message);
  }
}

// ============================================================================
// EJEMPLO 9: Validación de formato de placa
// ============================================================================

const { formatPlate, isValidPlateFormat } = require('./lib/session/gpswox-api');

function ejemploValidacionPlaca() {
  const placas = ['ABC123', 'XYZ-789', 'DEF456GHI', 'AB12'];
  
  placas.forEach(placa => {
    const formateada = formatPlate(placa);
    const valida = isValidPlateFormat(formateada);
    
    console.log(`Original: ${placa}`);
    console.log(`Formateada: ${formateada}`);
    console.log(`Válida: ${valida}`);
    console.log('---');
  });
  
  /*
  Output:
  Original: ABC123
  Formateada: ABC-123
  Válida: true
  ---
  Original: XYZ-789
  Formateada: XYZ-789
  Válida: true
  ---
  Original: DEF456GHI
  Formateada: DEF-456GHI
  Válida: true
  ---
  Original: AB12
  Formateada: AB12
  Válida: false
  ---
  */
}

// ============================================================================
// EJEMPLO 10: Integración con webhook personalizado
// ============================================================================

/*
// En server-baileys.js, agregar webhook personalizado:

app.post('/webhook/gpswox/assignment', async (req, res) => {
  const { phoneNumber, email, plate } = req.body;
  
  try {
    // Buscar usuario
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    
    // Formatear y validar placa
    const formattedPlate = formatPlate(plate);
    if (!isValidPlateFormat(formattedPlate)) {
      return res.status(400).json({ error: 'Formato de placa inválido' });
    }
    
    // Buscar dispositivo
    const device = await findDeviceByPlate(formattedPlate);
    if (!device) {
      return res.status(404).json({ error: 'Dispositivo no encontrado' });
    }
    
    // Asignar
    const result = await assignDeviceToUser(user.id, device.id);
    
    // Enviar notificación por WhatsApp
    if (result.success) {
      await sessionManager.sendMessage(phoneNumber, 
        `✅ Vehículo ${formattedPlate} asignado exitosamente a ${user.name}`
      );
    }
    
    res.json({ success: true, result });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
*/

// ============================================================================
// EJEMPLO 11: Monitoreo de conversaciones
// ============================================================================

function monitorearConversaciones() {
  setInterval(() => {
    const stats = gpswoxSession.getConversationStats();
    
    console.log('=== Estado de Conversaciones GPSwox ===');
    console.log(`Total activas: ${stats.total}`);
    console.log('Por estado:');
    
    Object.entries(stats.byState).forEach(([state, count]) => {
      console.log(`  ${state}: ${count}`);
    });
    
    console.log('=====================================\n');
  }, 60000); // Cada minuto
}

// ============================================================================
// EJEMPLO 12: Script de prueba completo
// ============================================================================

async function scriptPruebaCompleto() {
  const correo = 'test@ejemplo.com';
  const placa = 'XYZ789';
  
  console.log('🧪 Iniciando prueba completa del módulo GPSwox\n');
  
  // 1. Validar formato de correo
  console.log('1. Validando formato de correo...');
  const { isValidEmail } = require('./lib/session/gpswox-api');
  console.log(`   Email válido: ${isValidEmail(correo)}`);
  
  // 2. Buscar usuario
  console.log('\n2. Buscando usuario en GPSwox...');
  try {
    const user = await findUserByEmail(correo);
    console.log(`   ✅ Usuario encontrado: ${user.name} (ID: ${user.id})`);
    
    // 3. Formatear placa
    console.log('\n3. Formateando placa...');
    const placaFormateada = formatPlate(placa);
    console.log(`   ${placa} → ${placaFormateada}`);
    
    // 4. Buscar dispositivo
    console.log('\n4. Buscando dispositivo...');
    const device = await findDeviceByPlate(placaFormateada);
    console.log(`   ✅ Dispositivo encontrado: ${device.plate} (ID: ${device.id})`);
    
    // 5. Asignar dispositivo
    console.log('\n5. Asignando dispositivo a usuario...');
    const result = await assignDeviceToUser(user.id, device.id);
    
    if (result.success) {
      console.log('   ✅ Asignación exitosa!');
    } else {
      console.log(`   ❌ Error: ${result.error}`);
    }
    
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }
  
  console.log('\n🏁 Prueba completada\n');
}

// Ejecutar ejemplo si se ejecuta directamente
if (require.main === module) {
  console.log('Selecciona un ejemplo para ejecutar:\n');
  console.log('node ejemplos-gpswox.js');
  console.log('\nLuego descomenta el ejemplo que quieras ejecutar');
  
  // Descomenta el ejemplo que quieras ejecutar:
  // ejemploDirecto();
  // ejemploValidacionPlaca();
  // ejemploManejoErrores();
  // monitorearConversaciones();
  // scriptPruebaCompleto();
}

module.exports = {
  ejemploDirecto,
  ejemploValidacionPlaca,
  ejemploManejoErrores,
  monitorearConversaciones,
  scriptPruebaCompleto
};
