# Tests

Esta carpeta contiene las pruebas automatizadas del proyecto.

## Estructura

```
tests/
├── unit/              # Pruebas unitarias
│   ├── fx.test.js     # Tests del módulo FX
│   └── utils.test.js  # Tests de utilidades
└── integration/       # Pruebas de integración
    └── fx-api.test.js # Tests de API FX
```

## Ejecutar Tests

```bash
# Todos los tests con coverage
npm test

# Tests en modo watch (desarrollo)
npm run test:watch

# Solo tests unitarios
npm run test:unit

# Solo tests de integración
npm run test:integration
```

## Escribir Nuevos Tests

### Test Unitario
```javascript
describe('Module Name', () => {
    test('should do something', () => {
        // Arrange
        const input = 'test';
        
        // Act
        const result = someFunction(input);
        
        // Assert
        expect(result).toBe('expected');
    });
});
```

### Test de Integración
```javascript
const request = require('supertest');

describe('API Endpoint', () => {
    test('should return data', async () => {
        const response = await request(baseURL)
            .get('/api/endpoint')
            .set('x-api-key', API_KEY);
        
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
    });
});
```

## Coverage

Los reportes de cobertura se generan en `coverage/` después de ejecutar `npm test`.

Abrir `coverage/lcov-report/index.html` en el navegador para ver el reporte visual.

## Configuración

La configuración de Jest está en `package.json` bajo la clave `jest`.
