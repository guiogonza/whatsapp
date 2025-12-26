/**
 * Script de prueba para enviar SMS via Hablame.co
 * 
 * Uso: node test-sms.js "TU_API_KEY" "573001234567" "Mensaje de prueba"
 */

const SMS_API_URL = 'https://www.hablame.co/api/sms/v5/send';

async function sendTestSMS(apiKey, phoneNumber, message) {
    if (!apiKey) {
        console.log('❌ Error: Se requiere API Key');
        console.log('Uso: node test-sms.js "API_KEY" "NUMERO" "MENSAJE"');
        return;
    }

    const targetNumber = phoneNumber || '573183499539';
    const testMessage = message || `Prueba SMS desde WhatsApp Bot - ${new Date().toLocaleString('es-CO')}`;

    console.log('📱 Enviando SMS de prueba...');
    console.log(`   📞 Número: ${targetNumber}`);
    console.log(`   💬 Mensaje: ${testMessage}`);
    console.log('');

    try {
        const response = await fetch(SMS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-Hablame-Key': apiKey
            },
            body: JSON.stringify({
                messages: [{ to: targetNumber, text: testMessage }],
                priority: true,
                sendDate: 'Now'
            })
        });

        const result = await response.json();
        
        console.log('📨 Respuesta de API:');
        console.log(JSON.stringify(result, null, 2));

        if (response.ok && result.statusCode === 200) {
            const msgResult = result.payLoad?.messages?.[0];
            if (msgResult?.statusId === 1) {
                console.log('\n✅ SMS ENVIADO EXITOSAMENTE');
                console.log(`   ID: ${msgResult.smsId}`);
            } else {
                console.log(`\n⚠️ Estado del mensaje: ${msgResult?.statusDescription || 'Desconocido'}`);
            }
        } else {
            console.log('\n❌ Error en la respuesta de la API');
        }

    } catch (error) {
        console.log(`\n❌ Error: ${error.message}`);
    }
}

// Obtener argumentos de línea de comandos
const [,, apiKey, phoneNumber, ...messageParts] = process.argv;
const message = messageParts.join(' ');

sendTestSMS(apiKey, phoneNumber, message);
