/**
 * Tests para el detector de alertas MT5
 */

const mt5Detector = require('../../lib/session/mt5-detector');

describe('MT5 Detector', () => {
    describe('isMT5Alert', () => {
        test('detecta alertas con palabra "Ticket"', () => {
            const message = 'ALERTA MT5\nTicket: #220141699';
            expect(mt5Detector.isMT5Alert(message)).toBe(true);
        });

        test('detecta alertas con "ALERTA MT5"', () => {
            const message = '🚨 ALERTA MT5 - CRITICO';
            expect(mt5Detector.isMT5Alert(message)).toBe(true);
        });

        test('detecta alertas con información de trading', () => {
            const message = 'Simbolo: EURUSD | BUY 0.01 lot';
            expect(mt5Detector.isMT5Alert(message)).toBe(true);
        });

        test('detecta alertas con profit', () => {
            const message = 'Profit: $-5.00 (-5%)';
            expect(mt5Detector.isMT5Alert(message)).toBe(true);
        });

        test('no detecta mensajes normales', () => {
            const message = 'Hola, cómo estás?';
            expect(mt5Detector.isMT5Alert(message)).toBe(false);
        });

        test('no detecta null o undefined', () => {
            expect(mt5Detector.isMT5Alert(null)).toBe(false);
            expect(mt5Detector.isMT5Alert(undefined)).toBe(false);
        });
    });

    describe('parseMT5Alert', () => {
        test('parsea alerta crítica completa', () => {
            const message = `🚨 ALERTA MT5 - CRITICO

Ticket: #220141699
Simbolo: EURUSD | BUY 0.01 lot
Apertura: 1.08549 | Actual: 1.03499
SL: NO CONFIGURADO | TP: NO CONFIGURADO
Profit: $-5.00 (-5%)
Balance: $995.00

Recomendacion: Cerrar posicion para evitar mayores perdidas.

07/04/2024 10:15:00`;

            const result = mt5Detector.parseMT5Alert(message);
            
            expect(result.alertLevel).toBe('CRITICAL');
            expect(result.ticket).toBe('220141699');
            expect(result.symbol).toBe('EURUSD');
            expect(result.type).toBe('BUY');
            expect(result.lots).toBe(0.01);
            expect(result.openPrice).toBe(1.08549);
            expect(result.currentPrice).toBe(1.03499);
            expect(result.stopLoss).toBe(null);
            expect(result.takeProfit).toBe(null);
            expect(result.profit).toBe(-5.00);
            expect(result.profitPercent).toBe(-5);
            expect(result.balance).toBe(995.00);
            expect(result.recommendation).toContain('Cerrar posicion');
            expect(result.timestamp).toBe('07/04/2024 10:15:00');
        });

        test('parsea alerta con SL/TP configurados', () => {
            const message = `⚠️ ALERTA MT5 - ADVERTENCIA

Ticket: #220141700
Simbolo: GBPUSD | SELL 0.05 lot
Apertura: 1.26500 | Actual: 1.26800
SL: 1.27000 | TP: 1.25500
Profit: $-15.00 (-3%)
Balance: $2500.00

Recomendacion: Observar la posicion, cerca del Stop Loss.

08/04/2024 14:30:00`;

            const result = mt5Detector.parseMT5Alert(message);
            
            expect(result.alertLevel).toBe('WARNING');
            expect(result.ticket).toBe('220141700');
            expect(result.symbol).toBe('GBPUSD');
            expect(result.type).toBe('SELL');
            expect(result.stopLoss).toBe(1.27000);
            expect(result.takeProfit).toBe(1.25500);
        });

        test('parsea alerta con profit positivo', () => {
            const message = `ℹ️ ALERTA MT5

Ticket: #220141701
Simbolo: USDJPY | BUY 0.02 lot
Profit: $25.00 (5%)
Balance: $5025.00

Recomendacion: Considerar tomar ganancias parciales.`;

            const result = mt5Detector.parseMT5Alert(message);
            
            expect(result.profit).toBe(25.00);
            expect(result.profitPercent).toBe(5);
            expect(result.balance).toBe(5025.00);
        });

        test('maneja mensaje sin ticket', () => {
            const message = 'Simbolo: EURUSD';
            const result = mt5Detector.parseMT5Alert(message);
            
            // Debería funcionar pero sin ticket
            expect(result).not.toBeNull();
            expect(result.symbol).toBe('EURUSD');
        });

        test('retorna null en caso de error', () => {
            const result = mt5Detector.parseMT5Alert(12345); // numero en vez de string
            expect(result).toBeNull();
        });
    });

    describe('formatMT5Alert', () => {
        test('formatea alerta completa correctamente', () => {
            const data = {
                alertLevel: 'CRITICAL',
                ticket: '220141699',
                symbol: 'EURUSD',
                type: 'BUY',
                lots: 0.01,
                openPrice: 1.08549,
                currentPrice: 1.03499,
                stopLoss: null,
                takeProfit: null,
                profit: -5.00,
                profitPercent: -5,
                balance: 995.00,
                recommendation: 'Cerrar posicion para evitar mayores perdidas.',
                timestamp: '07/04/2024 10:15:00'
            };

            const formatted = mt5Detector.formatMT5Alert(data, '');
            
            expect(formatted).toContain('🚨');
            expect(formatted).toContain('CRITICAL');
            expect(formatted).toContain('#220141699');
            expect(formatted).toContain('EURUSD');
            expect(formatted).toContain('BUY');
            expect(formatted).toContain('NO CONFIGURADO');
            expect(formatted).toContain('-$5.00');
            expect(formatted).toContain('$995.00');
            expect(formatted).toContain('Cerrar posicion');
        });

        test('usa emoji correcto según nivel', () => {
            const criticalData = { alertLevel: 'CRITICAL', ticket: '123' };
            const warningData = { alertLevel: 'WARNING', ticket: '456' };
            const infoData = { alertLevel: 'INFO', ticket: '789' };

            expect(mt5Detector.formatMT5Alert(criticalData, '')).toContain('🚨');
            expect(mt5Detector.formatMT5Alert(warningData, '')).toContain('⚠️');
            expect(mt5Detector.formatMT5Alert(infoData, '')).toContain('ℹ️');
        });

        test('usa emoji correcto según tipo de operación', () => {
            const buyData = { ticket: '123', type: 'BUY', symbol: 'EUR' };
            const sellData = { ticket: '456', type: 'SELL', symbol: 'USD' };

            expect(mt5Detector.formatMT5Alert(buyData, '')).toContain('📈');
            expect(mt5Detector.formatMT5Alert(sellData, '')).toContain('📉');
        });

        test('muestra emoji de profit correcto', () => {
            const profitData = { ticket: '123', profit: 100, profitPercent: 10 };
            const lossData = { ticket: '456', profit: -50, profitPercent: -5 };

            expect(mt5Detector.formatMT5Alert(profitData, '')).toContain('💰');
            expect(mt5Detector.formatMT5Alert(lossData, '')).toContain('📛');
        });

        test('devuelve texto original si no hay datos', () => {
            const originalText = 'Texto original de alerta';
            const formatted = mt5Detector.formatMT5Alert(null, originalText);
            expect(formatted).toBe(originalText);
        });

        test('devuelve texto original si no hay ticket', () => {
            const originalText = 'Alerta sin ticket';
            const formatted = mt5Detector.formatMT5Alert({}, originalText);
            expect(formatted).toBe(originalText);
        });
    });

    describe('processMT5Alert', () => {
        let mockSendFunction;
        let consoleLog;
        let consoleError;

        beforeEach(() => {
            mockSendFunction = jest.fn().mockResolvedValue(true);
            consoleLog = jest.spyOn(console, 'log').mockImplementation();
            consoleError = jest.spyOn(console, 'error').mockImplementation();
        });

        afterEach(() => {
            consoleLog.mockRestore();
            consoleError.mockRestore();
        });

        test('procesa alerta MT5 y retorna true si hay suscriptores', async () => {
            // Mock de fx-session
            jest.mock('../../lib/session/fx-session', () => ({
                getFXSessionNames: () => ['fx01'],
                listAllSubscribers: () => [
                    { phoneNumber: '5549999999999@s.whatsapp.net', types: ['all'] }
                ]
            }));

            const message = 'ALERTA MT5\nTicket: #123456';
            const result = await mt5Detector.processMT5Alert(
                '5511111111111@s.whatsapp.net',
                message,
                mockSendFunction
            );

            expect(result).toBe(true);
            expect(mockSendFunction).toHaveBeenCalled();
        });

        test('procesa alerta y envía de vuelta si no hay suscriptores', async () => {
            jest.mock('../../lib/session/fx-session', () => ({
                getFXSessionNames: () => ['fx01'],
                listAllSubscribers: () => []
            }));

            const message = 'ALERTA MT5\nTicket: #123456';
            const senderPhone = '5511111111111@s.whatsapp.net';
            const result = await mt5Detector.processMT5Alert(
                senderPhone,
                message,
                mockSendFunction
            );

            expect(result).toBe(true);
            expect(mockSendFunction).toHaveBeenCalledWith(
                senderPhone,
                expect.any(String)
            );
        });

        test('retorna false si no hay sesiones FX', async () => {
            jest.mock('../../lib/session/fx-session', () => ({
                getFXSessionNames: () => [],
                listAllSubscribers: () => []
            }));

            const message = 'ALERTA MT5\nTicket: #123456';
            const result = await mt5Detector.processMT5Alert(
                '5511111111111@s.whatsapp.net',
                message,
                mockSendFunction
            );

            expect(result).toBe(false);
        });

        test('maneja errores al enviar mensaje', async () => {
            const errorFunction = jest.fn().mockRejectedValue(new Error('Send failed'));

            jest.mock('../../lib/session/fx-session', () => ({
                getFXSessionNames: () => ['fx01'],
                listAllSubscribers: () => []
            }));

            const message = 'ALERTA MT5\nTicket: #123456';
            const result = await mt5Detector.processMT5Alert(
                '5511111111111@s.whatsapp.net',
                message,
                errorFunction
            );

            expect(result).toBe(false);
        });
    });
});
