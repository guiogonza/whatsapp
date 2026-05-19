/**
 * Tests unitarios para las utilidades del sistema
 */

const { formatPhoneNumber, sleep } = require('../../lib/session/utils');

describe('Utils Module - Unit Tests', () => {
    describe('Phone Number Formatting', () => {
        test('should format Colombian local mobile number with country code', () => {
            const formatted = formatPhoneNumber('3123456789');
            expect(formatted).toBe('573123456789@s.whatsapp.net');
        });

        test('should handle phone with country code', () => {
            const formatted = formatPhoneNumber('573123456789');
            expect(formatted).toBe('573123456789@s.whatsapp.net');
        });

        test('should handle phone with WhatsApp suffix', () => {
            const formatted = formatPhoneNumber('573123456789@s.whatsapp.net');
            expect(formatted).toBe('573123456789@s.whatsapp.net');
        });

        test('should normalize c.us suffix numbers', () => {
            const formatted = formatPhoneNumber('573123456789@c.us');
            expect(formatted).toBe('573123456789@s.whatsapp.net');
        });

        test('should reject empty or too-short numbers', () => {
            expect(formatPhoneNumber('')).toBeNull();
            expect(formatPhoneNumber('@s.whatsapp.net')).toBeNull();
            expect(formatPhoneNumber('57')).toBeNull();
            expect(formatPhoneNumber('1234')).toBeNull();
        });
    });

    describe('Sleep Function', () => {
        test('should delay execution', async () => {
            const start = Date.now();
            await sleep(100);
            const elapsed = Date.now() - start;
            expect(elapsed).toBeGreaterThanOrEqual(100);
        });
    });
});
