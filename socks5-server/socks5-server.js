/**
 * Servidor SOCKS5 simple para Windows
 * Se ejecuta como servicio y permite que el VPS use esta conexión de internet
 */

const net = require('net');

const PORT = 1080;
const HOST = '0.0.0.0';

// Estados de la conexión SOCKS5
const SOCKS_VERSION = 0x05;
const AUTH_NONE = 0x00;
const CMD_CONNECT = 0x01;
const ADDR_TYPE_IPV4 = 0x01;
const ADDR_TYPE_DOMAIN = 0x03;
const ADDR_TYPE_IPV6 = 0x04;

const server = net.createServer((client) => {
    let authenticated = false;
    let targetHost = null;
    let targetPort = null;

    client.once('data', (data) => {
        // Handshake inicial
        if (data[0] !== SOCKS_VERSION) {
            client.end();
            return;
        }

        // Responder con autenticación sin credenciales
        client.write(Buffer.from([SOCKS_VERSION, AUTH_NONE]));
        authenticated = true;

        client.once('data', (request) => {
            if (request[0] !== SOCKS_VERSION || request[1] !== CMD_CONNECT) {
                client.write(Buffer.from([SOCKS_VERSION, 0x07, 0x00, ADDR_TYPE_IPV4, 0, 0, 0, 0, 0, 0]));
                client.end();
                return;
            }

            const addrType = request[3];
            let offset = 4;

            try {
                if (addrType === ADDR_TYPE_IPV4) {
                    targetHost = `${request[4]}.${request[5]}.${request[6]}.${request[7]}`;
                    offset = 8;
                } else if (addrType === ADDR_TYPE_DOMAIN) {
                    const domainLength = request[4];
                    targetHost = request.slice(5, 5 + domainLength).toString();
                    offset = 5 + domainLength;
                } else if (addrType === ADDR_TYPE_IPV6) {
                    const ipv6Parts = [];
                    for (let i = 0; i < 8; i++) {
                        ipv6Parts.push(request.readUInt16BE(4 + i * 2).toString(16));
                    }
                    targetHost = ipv6Parts.join(':');
                    offset = 20;
                } else {
                    throw new Error('Tipo de dirección no soportado');
                }

                targetPort = request.readUInt16BE(offset);

                // Conectar al destino
                const target = net.createConnection({ host: targetHost, port: targetPort }, () => {
                    // Respuesta de éxito
                    const response = Buffer.alloc(10);
                    response[0] = SOCKS_VERSION;
                    response[1] = 0x00; // Éxito
                    response[2] = 0x00;
                    response[3] = ADDR_TYPE_IPV4;
                    response.writeUInt16BE(targetPort, 8);
                    client.write(response);

                    // Proxy bidireccional
                    client.pipe(target);
                    target.pipe(client);
                });

                target.on('error', (err) => {
                    const response = Buffer.from([SOCKS_VERSION, 0x05, 0x00, ADDR_TYPE_IPV4, 0, 0, 0, 0, 0, 0]);
                    client.write(response);
                    client.end();
                });

                client.on('error', () => target.destroy());
                target.on('close', () => client.destroy());
                client.on('close', () => target.destroy());

            } catch (err) {
                const response = Buffer.from([SOCKS_VERSION, 0x01, 0x00, ADDR_TYPE_IPV4, 0, 0, 0, 0, 0, 0]);
                client.write(response);
                client.end();
            }
        });
    });

    client.on('error', () => {});
});

server.listen(PORT, HOST, () => {
    console.log(`✅ Servidor SOCKS5 iniciado en ${HOST}:${PORT}`);
    console.log(`📅 ${new Date().toLocaleString('es-CO')}`);
    console.log('');
    console.log('Este servidor permite que el VPS use tu conexión de internet.');
    console.log('Mientras esté corriendo, el tráfico saldrá con IP de Colombia.');
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ El puerto ${PORT} ya está en uso`);
    } else {
        console.error('❌ Error del servidor:', err.message);
    }
    process.exit(1);
});

// Manejar cierre limpio
process.on('SIGINT', () => {
    console.log('\n⏹️ Deteniendo servidor SOCKS5...');
    server.close();
    process.exit(0);
});

process.on('SIGTERM', () => {
    server.close();
    process.exit(0);
});
