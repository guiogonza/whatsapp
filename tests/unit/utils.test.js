/**
 * Tests unitarios para las utilidades del sistema
 */

const { formatPhoneNumber, sleep } = require('../../lib/session/utils');

describe('Utils Module - Unit Tests', () => {
    describe('Phone Number Formatting', () => {
        test('should format Colombian phone number', () => {
            const formatted = formatPhoneNumber('3123456789');
            expect(formatted).toContain('57');
        });

        test('should handle phone with country code', () => {
            const formatted = formatPhoneNumber('573123456789');
            expect(formatted).toContain('57');
        });

        test('should handle phone with WhatsApp suffix', () => {
            const formatted = formatPhoneNumber('573123456789@s.whatsapp.net');
            expect(formatted).toContain('57');
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
