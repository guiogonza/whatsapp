/**
 * Tests unitarios para el módulo FX (MetaTrader5)
 */

const fxSession = require('../../lib/session/fx-session');
const { formatNotification, NOTIFICATION_TYPES, isValidAccountNumber, isValidSymbol } = require('../../lib/session/fx-api');

describe('FX Module - Unit Tests', () => {
    beforeEach(() => {
        // Limpiar suscriptores antes de cada test
        fxSession.clearAllSubscribers();
    });

    describe('Session Identification', () => {
        test('should identify FX sessions correctly', () => {
            expect(fxSession.isFXSession('fx-session-1')).toBe(true);
            expect(fxSession.isFXSession('fx-session-2')).toBe(true);
            expect(fxSession.isFXSession('normal-session')).toBe(false);
        });

        test('should return default FX session name', () => {
            const name = fxSession.getFXSessionName();
            expect(name).toBe('fx-session-1');
        });

        test('should return all FX session names', () => {
            const names = fxSession.getFXSessionNames();
            expect(Array.isArray(names)).toBe(true);
            expect(names.length).toBeGreaterThan(0);
        });
    });

    describe('Subscription Management', () => {
        test('should subscribe user to account', () => {
            const result = fxSession.subscribe('573123456789', '12345678');
            expect(result.success).toBe(true);
            
            const subscribers = fxSession.getSubscribers('12345678');
            expect(subscribers).toContain('573123456789');
        });

        test('should unsubscribe user from account', () => {
            fxSession.subscribe('573123456789', '12345678');
            const result = fxSession.unsubscribe('573123456789', '12345678');
            
            expect(result.success).toBe(true);
            const subscribers = fxSession.getSubscribers('12345678');
            expect(subscribers).not.toContain('573123456789');
        });

        test('should get user preferences', () => {
            fxSession.subscribe('573123456789', '12345678', [NOTIFICATION_TYPES.SIGNAL]);
            const prefs = fxSession.getUserPreferences('573123456789');
            
            expect(prefs).not.toBeNull();
            expect(prefs.accounts).toContain('12345678');
            expect(prefs.types).toContain(NOTIFICATION_TYPES.SIGNAL);
        });

        test('should list all subscribers', () => {
            fxSession.subscribe('573123456789', '12345678');
            fxSession.subscribe('573987654321', '12345678');
            
            const all = fxSession.listAllSubscribers();
            expect(all.length).toBe(2);
        });
    });

    describe('Validation Functions', () => {
        test('should validate account numbers', () => {
            expect(isValidAccountNumber('123456')).toBe(true);
            expect(isValidAccountNumber('1234567890')).toBe(true);
            expect(isValidAccountNumber('12345')).toBe(false); // too short
            expect(isValidAccountNumber('12345678901')).toBe(false); // too long
            expect(isValidAccountNumber('abc123')).toBe(false); // not numeric
        });

        test('should validate forex symbols', () => {
            expect(isValidSymbol('EURUSD')).toBe(true);
            expect(isValidSymbol('GBPJPY')).toBe(true);
            expect(isValidSymbol('EURUSDm')).toBe(true); // with suffix
            expect(isValidSymbol('EUR')).toBe(false); // too short
            expect(isValidSymbol('eurusd')).toBe(false); // lowercase
        });
    });

    describe('Message Formatting', () => {
        test('should format trading signal', () => {
            const signal = {
                type: 'BUY',
                symbol: 'EURUSD',
                entry: 1.0850,
                stopLoss: 1.0800,
                takeProfit: 1.0950,
                lotSize: 0.1,
                timeframe: 'H1',
                reason: 'Breakout strategy'
            };

            const message = formatNotification(NOTIFICATION_TYPES.SIGNAL, signal);
            expect(message).toContain('SEÑAL DE TRADING');
            expect(message).toContain('BUY');
            expect(message).toContain('EURUSD');
            expect(message).toContain('1.085');
        });

        test('should format price alert', () => {
            const alert = {
                symbol: 'EURUSD',
                currentPrice: 1.0850,
                alertType: 'STOP_LOSS',
                alertPrice: 1.0800,
                position: 'BUY'
            };

            const message = formatNotification(NOTIFICATION_TYPES.ALERT, alert);
            expect(message).toContain('ALERTA DE PRECIO');
            expect(message).toContain('EURUSD');
            expect(message).toContain('STOP LOSS');
        });

        test('should format position info', () => {
            const position = {
                action: 'OPENED',
                ticket: 12345,
                type: 'BUY',
                symbol: 'EURUSD',
                volume: 0.1,
                openPrice: 1.0850
            };

            const message = formatNotification(NOTIFICATION_TYPES.POSITION, position);
            expect(message).toContain('POSICIÓN ABIERTA');
            expect(message).toContain('#12345');
            expect(message).toContain('EURUSD');
        });

        test('should format account report', () => {
            const account = {
                accountNumber: '12345678',
                balance: 10000,
                equity: 10150,
                margin: 1000,
                freeMargin: 9150,
                marginLevel: 1015,
                profit: 150,
                openPositions: 2
            };

            const message = formatNotification(NOTIFICATION_TYPES.ACCOUNT, account);
            expect(message).toContain('REPORTE DE CUENTA');
            expect(message).toContain('12345678');
            expect(message).toContain('10000');
        });
    });

    describe('Statistics', () => {
        test('should track statistics', () => {
            const stats = fxSession.getStats();
            expect(stats).toHaveProperty('totalSent');
            expect(stats).toHaveProperty('byType');
            expect(stats).toHaveProperty('byAccount');
            expect(stats).toHaveProperty('totalSubscribers');
        });

        test('should maintain notification history', () => {
            const history = fxSession.getHistory();
            expect(Array.isArray(history)).toBe(true);
        });
    });
});
