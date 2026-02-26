# Script para crear sesiones FX rápidamente
# Ejecuta: node scripts/create-fx-sessions.js

const axios = require('axios');
const config = require('../config');

const API_URL = `http://localhost:${config.PORT}`;
const API_KEY = process.env.API_KEY || '';

async function createFXSessions() {
    console.log('🚀 === CREANDO SESIONES FX ===\n');

    try {
        const response = await axios.post(
            `${API_URL}/api/fx/sessions/create-all`,
            {},
            {
                headers: API_KEY ? { 'x-api-key': API_KEY } : {}
            }
        );

        if (response.data.success) {
            console.log('✅ Sesiones FX creadas exitosamente\n');
            
            response.data.results.forEach((result, index) => {
                console.log(`📱 Sesión ${index + 1}: ${result.sessionName}`);
                console.log(`   Status: ${result.success ? '✅' : '❌'}`);
                console.log(`   Mensaje: ${result.message}`);
                if (result.qr) {
                    console.log(`   QR disponible: Sí`);
                    console.log(`   URL QR: ${API_URL}/api/sessions/${result.sessionName}/qr\n`);
                } else {
                    console.log(`   QR disponible: No\n`);
                }
            });

            console.log(`\n📊 Modo dedicado: ${response.data.dedicatedMode ? 'Activado' : 'Desactivado'}`);
            console.log('\n📝 Próximos pasos:');
            console.log('1. Escanea los códigos QR en WhatsApp');
            console.log('2. Suscribe usuarios: POST /api/fx/subscribe');
            console.log('3. Envía notificaciones: POST /api/fx/notify');
        } else {
            console.error('❌ Error:', response.data.error);
        }
    } catch (error) {
        console.error('❌ Error creando sesiones:', error.message);
        if (error.response) {
            console.error('Response:', error.response.data);
        }
    }
}

// Ejecutar
createFXSessions();
