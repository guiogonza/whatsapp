/**
 * Tests de integración para las rutas de FX
 */

const request = require('supertest');

// Nota: Estos tests requieren que el servidor esté corriendo
// Para ejecutarlos, primero iniciar: npm start
// Luego en otra terminal: npm test

describe('FX API Routes - Integration Tests', () => {
    const baseURL = 'http://localhost:3010';
    const API_KEY = process.env.API_KEY || '';

    describe('GET /api/fx/types', () => {
        test('should return notification types', async () => {
            const response = await request(baseURL)
                .get('/api/fx/types')
                .set('x-api-key', API_KEY);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.types).toBeDefined();
            expect(Array.isArray(response.body.types)).toBe(true);
        });
    });

    describe('GET /api/fx/stats', () => {
        test('should return FX statistics', async () => {
            const response = await request(baseURL)
                .get('/api/fx/stats')
                .set('x-api-key', API_KEY);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.totalSent).toBeDefined();
        });
    });

    describe('POST /api/fx/subscribe', () => {
        test('should subscribe user to account', async () => {
            const response = await request(baseURL)
                .post('/api/fx/subscribe')
                .set('x-api-key', API_KEY)
                .send({
                    phoneNumber: '573123456789',
                    accountNumber: '12345678'
                });

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
        });

        test('should reject invalid request', async () => {
            const response = await request(baseURL)
                .post('/api/fx/subscribe')
                .set('x-api-key', API_KEY)
                .send({
                    phoneNumber: '573123456789'
                    // missing accountNumber
                });

            expect(response.status).toBe(400);
            expect(response.body.success).toBe(false);
        });
    });

    describe('GET /api/fx/subscribers', () => {
        test('should list all subscribers', async () => {
            const response = await request(baseURL)
                .get('/api/fx/subscribers')
                .set('x-api-key', API_KEY);

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(Array.isArray(response.body.subscribers)).toBe(true);
        });
    });
});
