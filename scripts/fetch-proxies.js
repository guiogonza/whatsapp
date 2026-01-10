/**
 * Script para descargar proxies SOCKS5 de ProxyScrape
 * Uso: node scripts/fetch-proxies.js
 */

const https = require('https');
const fs = require('fs');
const net = require('net');
const path = require('path');

// Configuración
const PROXYSCRAPE_FREE_API = 'https://api.proxyscrape.com/v2/?request=displayproxies&protocol=socks5&timeout=5000&country=all&anonymity=all';
const MAX_PROXIES = 20; // Número máximo de proxies a probar
const TEST_TIMEOUT = 5000; // 5 segundos timeout

/**
 * Descarga la lista de proxies de ProxyScrape
 */
function fetchProxyList() {
    return new Promise((resolve, reject) => {
        console.log('📥 Descargando lista de proxies SOCKS5 de ProxyScrape...\n');
        
        https.get(PROXYSCRAPE_FREE_API, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                const proxies = data.trim().split('\n').filter(p => p.includes(':'));
                console.log(`📋 ${proxies.length} proxies encontrados\n`);
                resolve(proxies);
            });
        }).on('error', reject);
    });
}

/**
 * Prueba si un proxy SOCKS5 está funcionando
 */
function testProxy(proxyString) {
    return new Promise((resolve) => {
        const [host, port] = proxyString.split(':');
        const socket = new net.Socket();
        
        socket.setTimeout(TEST_TIMEOUT);
        
        socket.on('connect', () => {
            socket.destroy();
            resolve({ proxy: proxyString, working: true });
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve({ proxy: proxyString, working: false });
        });
        
        socket.on('error', () => {
            socket.destroy();
            resolve({ proxy: proxyString, working: false });
        });
        
        try {
            socket.connect(parseInt(port), host);
        } catch {
            resolve({ proxy: proxyString, working: false });
        }
    });
}

/**
 * Prueba múltiples proxies en paralelo
 */
async function testProxies(proxies, maxWorking = 10) {
    console.log(`🔍 Probando ${Math.min(proxies.length, MAX_PROXIES)} proxies...\n`);
    
    const workingProxies = [];
    const toTest = proxies.slice(0, MAX_PROXIES);
    
    // Probar en batches de 10
    for (let i = 0; i < toTest.length; i += 10) {
        const batch = toTest.slice(i, i + 10);
        const results = await Promise.all(batch.map(testProxy));
        
        for (const result of results) {
            if (result.working) {
                workingProxies.push(result.proxy);
                console.log(`  ✅ socks5://${result.proxy}`);
                
                if (workingProxies.length >= maxWorking) {
                    break;
                }
            } else {
                console.log(`  ❌ ${result.proxy}`);
            }
        }
        
        if (workingProxies.length >= maxWorking) break;
    }
    
    return workingProxies;
}

/**
 * Genera la línea para el archivo .env
 */
function generateEnvLine(proxies) {
    const formatted = proxies.map(p => `socks5://${p}`).join(',');
    return `PROXY_LIST=${formatted}`;
}

async function main() {
    try {
        console.log('╔════════════════════════════════════════════════════╗');
        console.log('║     ProxyScrape SOCKS5 Proxy Fetcher               ║');
        console.log('╚════════════════════════════════════════════════════╝\n');
        
        // Descargar lista
        const allProxies = await fetchProxyList();
        
        if (allProxies.length === 0) {
            console.log('❌ No se encontraron proxies');
            return;
        }
        
        // Probar proxies
        const workingProxies = await testProxies(allProxies, 10);
        
        console.log(`\n📊 Resultado: ${workingProxies.length} proxies funcionando\n`);
        
        if (workingProxies.length > 0) {
            const envLine = generateEnvLine(workingProxies);
            
            console.log('═══════════════════════════════════════════════════════');
            console.log('📝 Agrega esta línea a tu archivo .env:\n');
            console.log(envLine);
            console.log('\n═══════════════════════════════════════════════════════');
            
            // Guardar en archivo
            const outputPath = path.join(__dirname, '..', 'proxies-found.txt');
            fs.writeFileSync(outputPath, envLine);
            console.log(`\n💾 Guardado en: ${outputPath}`);
            
            console.log('\n⚠️  IMPORTANTE:');
            console.log('   - Los proxies gratuitos son inestables');
            console.log('   - Pueden dejar de funcionar en cualquier momento');
            console.log('   - Para producción, usa ProxyScrape Premium\n');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

main();
