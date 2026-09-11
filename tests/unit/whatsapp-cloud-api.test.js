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

    test('should capture the full multi-word address from native GPSwox alerts (regression)', () => {
        // Bug real: la ubicacion se truncaba al primer espacio ("Vía" y nada mas)
        // porque el regex usaba [^\s]+ en vez de capturar hasta "Hora:"/"Fecha:".
        const message = 'hola RASTREAR te informa una alerta en su vehiculo *CRB92F* ha presentado ' +
            '*Salio de (darien)* velocidad:  (57 kph)  en la siguiente ubicacion: ' +
            'Vía Loboguerrero - Mediacanoa, Calima, Yotoco, Centro, Valle del Cauca, RAP Pacífico, Colombia ' +
            'Hora: 11-09-2026 15:19:36. si tiene alguna duda comunicarse al 3183499539.';

        const parsed = cloudApi.parseAlertMessage(message);

        expect(parsed).toEqual({
            empresa: 'RASTREAR',
            vehiculo: 'CRB92F',
            evento: 'Salio de (darien) · 57 kph',
            ubicacion: 'Vía Loboguerrero - Mediacanoa, Calima, Yotoco, Centro, Valle del Cauca, RAP Pacífico, Colombia',
            hora: '11-09-2026 15:19:36'
        });
    });

    test('should append the speed to evento when present in native GPSwox alerts', () => {
        // La plantilla aprobada de Meta no tiene variable propia para velocidad,
        // asi que se agrega como sufijo de "evento" en vez de una linea nueva.
        const message = 'hola RASTREAR te informa una alerta en su vehiculo *CQU92F* ha presentado ' +
            '*Entro en (darien)* velocidad:  (42 kph)  en la siguiente ubicacion: ' +
            'Hotel Shalom, Vía Mediacanoa - Loboguerrero, Dagua, Sur, Valle del Cauca, RAP Pacífico, Colombia ' +
            'Hora: 11-09-2026 15:45:34. si tiene alguna duda comunicarse al 3183499539.';

        const parsed = cloudApi.parseAlertMessage(message);

        expect(parsed.evento).toBe('Entro en (darien) · 42 kph');
    });

    test('should not append anything when speed is absent', () => {
        const message = `🚨 Alerta de Rastreamos - GPS

🚗 Vehículo: TEST001
⚠️ Evento: Ignición apagada
📍 Ubicación: Bogotá, Colombia
🕐 Hora: 24-03-2026 15:00:00 hrs`;

        const parsed = cloudApi.parseAlertMessage(message);
        expect(parsed.evento).toBe('Ignición apagada');
    });
});
