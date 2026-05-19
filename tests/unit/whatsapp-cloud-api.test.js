/**
 * Tests unitarios para parseo/formateo de alertas GPSWOX
 */

const cloudApi = require('../../lib/session/whatsapp-cloud-api');

describe('WhatsApp Cloud API - GPS Alert Parsing', () => {
    test('should parse decorated multiline alert template', () => {
        const message = `🚨 Alerta de Rastreamos - GPS

🚗 Vehículo: TEST001
⚠️ Evento: Ignición apagada
📍 Ubicación: Bogotá, Colombia
🕐 Hora: 24-03-2026 15:00:00 hrs`;

        const parsed = cloudApi.parseAlertMessage(message);

        expect(parsed).toEqual({
            empresa: 'Rastreamos',
            vehiculo: 'TEST001',
            evento: 'Ignición apagada',
            ubicacion: 'Bogotá, Colombia',
            hora: '24-03-2026 15:00:00'
        });
    });

    test('should parse flat GPSWOX alert and normalize it', () => {
        const message = 'Rastreamos Vehiculo: TEST001 Evento: Ignición apagada Ubicacion: Bogotá, Colombia Time: 24-03-2026 15:00:00';

        const parsed = cloudApi.parseAlertMessage(message);

        expect(parsed).toEqual({
            empresa: 'Rastreamos',
            vehiculo: 'TEST001',
            evento: 'Ignición apagada',
            ubicacion: 'Bogotá, Colombia',
            hora: '24-03-2026 15:00:00'
        });

        const formatted = cloudApi.formatAlertMessage(parsed);
        expect(formatted).toContain('🚨 Alerta de Rastreamos - GPS');
        expect(formatted).toContain('🚗 Vehículo: TEST001');
        expect(formatted).toContain('⚠️ Evento: Ignición apagada');
    });

    test('should reject unrelated messages', () => {
        expect(cloudApi.parseAlertMessage('hola mundo')).toBeNull();
    });
});
