/**
 * Rutas de información del sistema
 */

const express = require('express');
const router = express.Router();
const sessionController = require('../controllers/sessionController');

// Información de adaptadores
router.get('/adapters', sessionController.getAdaptersInfo);

// Estado del proxy
router.get('/proxy', sessionController.getProxyStatus);

// IP pública del servidor
router.get('/ip', async (req, res) => {
    try {
        const https = require('https');
        const { checkProxyAvailable } = require('../lib/session/proxy');
        const PROXY_URL = process.env.ALL_PROXY || process.env.SOCKS_PROXY || null;
        let publicIP = 'No disponible';
        let usingProxy = false;

        if (PROXY_URL && await checkProxyAvailable(PROXY_URL)) {
            const { SocksProxyAgent } = require('socks-proxy-agent');
            const agent = new SocksProxyAgent(PROXY_URL);
            usingProxy = true;
            
            publicIP = await new Promise((resolve, reject) => {
                https.get('https://api.ipify.org', { agent }, (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data.trim()));
                }).on('error', reject);
            });
        } else {
            publicIP = await new Promise((resolve, reject) => {
                https.get('https://api.ipify.org', (res) => {
                    let data = '';
                    res.on('data', chunk => data += chunk);
                    res.on('end', () => resolve(data.trim()));
                }).on('error', reject);
            });
        }

        res.json({ success: true, ip: publicIP, usingProxy });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
