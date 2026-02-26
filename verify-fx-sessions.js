/**
 * Script de verificación de sesiones FX
 * Verifica que las sesiones FX estén configuradas y conectadas correctamente
 */

const config = require('./config');

console.log('🔍 VERIFICACIÓN DE SESIONES FX\n');
console.log('='.repeat(60));

// 1. Verificar configuración
console.log('\n📋 PASO 1: Verificar configuración de sesiones FX');
console.log('-'.repeat(60));

const fxSessionNames = process.env.FX_SESSION_NAMES 
    ? process.env.FX_SESSION_NAMES.split(',').map(s => s.trim()).filter(s => s)
    : (config.FX_SESSION_NAMES || ['fx01']);

if (fxSessionNames.length === 0) {
    console.log('❌ No hay sesiones FX configuradas');
    console.log('');
    console.log('💡 Solución:');
    console.log('   1. En tu archivo .env o config.js, agrega:');
    console.log('      FX_SESSION_NAMES=fx01,fx02,fx03');
    console.log('   2. O en config.js:');
    console.log('      FX_SESSION_NAMES: [\'fx01\', \'fx02\', \'fx03\']');
    process.exit(1);
} else {
    console.log(`✅ Sesiones FX configuradas: ${fxSessionNames.join(', ')}`);
    console.log(`   Total: ${fxSessionNames.length} sesión(es)`);
}

// 2. Verificar servidor corriendo
console.log('\n📡 PASO 2: Verificar servidor WhatsApp');
console.log('-'.repeat(60));

const http = require('http');
const port = config.PORT || 3000;

const checkServer = () => {
    return new Promise((resolve, reject) => {
        const req = http.get(`http://localhost:${port}/health`, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                if (res.statusCode === 200) {
                    resolve(JSON.parse(data));
                } else {
                    reject(new Error(`Status: ${res.statusCode}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(3000, () => {
            req.destroy();
            reject(new Error('Timeout'));
        });
    });
};

checkServer()
    .then(health => {
        console.log('✅ Servidor WhatsApp está corriendo');
        console.log(`   Uptime: ${Math.floor(health.uptime / 1000)} segundos`);
        console.log(`   Puerto: ${port}`);
        
        // 3. Verificar sesiones activas
        return new Promise((resolve, reject) => {
            const req = http.get(`http://localhost:${port}/sessions`, (res) => {
                let data = '';
                res.on('data', chunk => data += chunk);
                res.on('end', () => {
                    if (res.statusCode === 200) {
                        resolve(JSON.parse(data));
                    } else {
                        reject(new Error(`Status: ${res.statusCode}`));
                    }
                });
            });
            req.on('error', reject);
            req.setTimeout(3000, () => {
                req.destroy();
                reject(new Error('Timeout'));
            });
        });
    })
    .then(response => {
        console.log('\n📱 PASO 3: Verificar sesiones FX activas');
        console.log('-'.repeat(60));
        
        const sessions = response.sessions || [];
        const fxSessions = sessions.filter(s => fxSessionNames.includes(s.name));
        
        if (fxSessions.length === 0) {
            console.log('⚠️  No se encontraron sesiones FX activas');
            console.log('');
            console.log('💡 Solución:');
            console.log('   1. Crear sesiones FX:');
            fxSessionNames.forEach(name => {
                console.log(`      POST http://localhost:${port}/sessions`);
                console.log(`      { "sessionName": "${name}" }`);
            });
            console.log('   2. Escanear código QR de cada sesión');
        } else {
            console.log(`✅ Encontradas ${fxSessions.length} sesión(es) FX:\n`);
            
            fxSessions.forEach(session => {
                const stateEmoji = session.state === 'ACTIVE' ? '✅' : 
                                 session.state === 'SCAN_QR' ? '📱' : 
                                 session.state === 'CONNECTING' ? '🔄' : '❌';
                
                console.log(`   ${stateEmoji} ${session.name}`);
                console.log(`      Estado: ${session.state}`);
                
                if (session.phoneNumber) {
                    console.log(`      Teléfono: ${session.phoneNumber}`);
                }
                
                if (session.state === 'SCAN_QR') {
                    console.log(`      ⚠️  Pendiente: Escanear QR code`);
                } else if (session.state !== 'ACTIVE') {
                    console.log(`      ⚠️  No está activa`);
                }
                
                console.log('');
            });
            
            // Verificar si todas están activas
            const activeFxSessions = fxSessions.filter(s => s.state === 'ACTIVE');
            
            if (activeFxSessions.length === 0) {
                console.log('⚠️  Ninguna sesión FX está activa');
                console.log('   Todas las sesiones deben estar en estado ACTIVE para funcionar');
            } else if (activeFxSessions.length < fxSessions.length) {
                console.log(`⚠️  Solo ${activeFxSessions.length}/${fxSessions.length} sesiones FX activas`);
                console.log('   Recomendado: Todas las sesiones activas para redundancia');
            } else {
                console.log(`✅ Todas las sesiones FX (${activeFxSessions.length}) están ACTIVAS`);
            }
        }
        
        // 4. Resumen final
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN');
        console.log('='.repeat(60));
        
        const activeFX = fxSessions.filter(s => s.state === 'ACTIVE').length;
        const totalFX = fxSessionNames.length;
        
        if (activeFX === 0) {
            console.log('');
            console.log('❌ SISTEMA NO LISTO');
            console.log('   No hay sesiones FX activas');
            console.log('');
            console.log('📝 Pasos siguientes:');
            console.log('   1. Crear sesiones FX si no existen');
            console.log('   2. Escanear QR code de cada sesión');
            console.log('   3. Volver a ejecutar este script');
        } else if (activeFX < totalFX) {
            console.log('');
            console.log('⚠️  SISTEMA PARCIALMENTE LISTO');
            console.log(`   ${activeFX}/${totalFX} sesiones FX activas`);
            console.log('');
            console.log('✅ El sistema funcionará, pero:');
            console.log('   - Menor redundancia');
            console.log('   - Mayor carga en sesiones activas');
            console.log('');
            console.log('💡 Recomendación: Activar todas las sesiones FX');
        } else {
            console.log('');
            console.log('✅ SISTEMA COMPLETAMENTE LISTO');
            console.log(`   ${activeFX}/${totalFX} sesiones FX activas y funcionando`);
            console.log('');
            console.log('🚀 Puedes empezar a enviar mensajes FX:');
            console.log('   1. Envía mensaje a cualquier sesión con formato:');
            console.log('      "Para: +5549999999999');
            console.log('       [tu mensaje aquí]"');
            console.log('   2. El sistema usará sesión FX para reenviar');
            console.log('   3. Verifica logs para ver qué sesión FX se usó');
        }
        
        console.log('');
    })
    .catch(error => {
        console.log('❌ Servidor WhatsApp NO está corriendo');
        console.log(`   Error: ${error.message}`);
        console.log('');
        console.log('💡 Solución:');
        console.log(`   1. Iniciar servidor: node server-baileys-new.js`);
        console.log('   2. Esperar a que inicie completamente');
        console.log('   3. Volver a ejecutar este script');
        process.exit(1);
    });
