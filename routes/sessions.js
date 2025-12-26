/**
 * Rutas de API para gestión de sesiones
 */

const express = require('express');
const router = express.Router();
const qrcode = require('qrcode');
const config = require('../config');
const sessionManager = require('../sessionManager');

const { sessions } = sessionManager;

// Obtener todas las sesiones
router.get('/', async (req, res) => {
    try {
        const sessionsArray = await Promise.all(Object.values(sessions).map(async session => {
            let actualState = session.state;
            
            if (session.state === config.SESSION_STATES.READY && session.client) {
                try {
                    const state = await session.client.getState();
                    if (state !== 'CONNECTED') {
                        actualState = config.SESSION_STATES.DISCONNECTED;
                        session.state = config.SESSION_STATES.DISCONNECTED;
                    }
                } catch (error) {
                    actualState = config.SESSION_STATES.DISCONNECTED;
                    session.state = config.SESSION_STATES.DISCONNECTED;
                }
            }
            
            return {
                name: session.name,
                state: actualState,
                hasQR: !!session.qr && session.state === config.SESSION_STATES.WAITING_FOR_QR,
                messageCount: session.messages?.length || 0,
                lastActivity: session.lastActivity,
                error: session.error,
                userInfo: session.userInfo || null
            };
        }));

        res.json(sessionsArray);
    } catch (error) {
        console.error(`Error obteniendo sesiones: ${error.message}`);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// Iniciar nueva sesión
router.post('/start', async (req, res) => {
    const { sessionName } = req.body;

    const validation = sessionManager.validateSessionName(sessionName);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    if (sessions[sessionName]) {
        return res.status(400).json({ error: `La sesión ${sessionName} ya existe` });
    }

    try {
        console.log(`Creando nueva sesión: ${sessionName}`);

        sessions[sessionName] = {
            name: sessionName,
            client: null,
            qr: null,
            state: config.SESSION_STATES.STARTING,
            messages: [],
            lastActivity: new Date(),
            error: null
        };

        sessionManager.initializeClient(sessionName).catch(error => {
            console.error(`Error en inicialización de ${sessionName}: ${error.message}`);
        });

        res.json({
            success: true,
            message: `Sesión ${sessionName} iniciada. Generando código QR...`,
            sessionName
        });
    } catch (error) {
        console.error(`Error iniciando ${sessionName}: ${error.message}`);
        if (sessions[sessionName]) delete sessions[sessionName];
        res.status(500).json({ error: `Error al iniciar sesión: ${error.message}` });
    }
});

// Obtener código QR
router.get('/:sessionName/qr', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (!session.qr || session.state !== config.SESSION_STATES.WAITING_FOR_QR) {
        return res.status(404).json({
            error: 'No hay código QR disponible',
            state: session.state
        });
    }

    try {
        const qrDataURL = await qrcode.toDataURL(session.qr, { width: 256, margin: 2 });
        res.type('text/plain').send(qrDataURL);
    } catch (error) {
        res.status(500).json({ error: `Error generando QR: ${error.message}` });
    }
});

// Obtener estado de sesión
router.get('/:sessionName/status', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];
    let trulyReady = false;
    
    if (session.state === config.SESSION_STATES.READY) {
        trulyReady = await sessionManager.isClientTrulyReady(session);
    }

    res.json({
        name: sessionName,
        state: session.state,
        messageCount: session.messages?.length || 0,
        isReady: session.state === config.SESSION_STATES.READY,
        isTrulyReady: trulyReady,
        hasQR: !!session.qr && session.state === config.SESSION_STATES.WAITING_FOR_QR,
        lastActivity: session.lastActivity,
        error: session.error,
        userInfo: session.userInfo || null,
        needsReconnect: session.needsReconnect || false
    });
});

// Reconectar sesión
router.post('/:sessionName/reconnect', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];
    
    try {
        console.log(`🔄 Reconectando sesión: ${sessionName}`);
        
        if (session.client) {
            try {
                await session.client.destroy();
            } catch (destroyError) {
                console.log(`Advertencia al destruir cliente: ${destroyError.message}`);
            }
        }
        
        session.client = null;
        session.qr = null;
        session.state = config.SESSION_STATES.STARTING;
        session.error = null;
        
        res.json({
            success: true,
            message: `Sesión ${sessionName} reiniciándose...`
        });
        
        sessionManager.initializeClient(sessionName).catch(error => {
            session.state = config.SESSION_STATES.ERROR;
            session.error = error.message;
        });
        
    } catch (error) {
        session.state = config.SESSION_STATES.ERROR;
        res.status(500).json({ error: `Error reconectando: ${error.message}` });
    }
});

// Forzar estado READY
router.post('/:sessionName/force-ready', (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (session.state === config.SESSION_STATES.LOADING && session.client) {
        console.log(`Forzando READY: ${sessionName}`);
        session.state = config.SESSION_STATES.READY;
        session.qr = null;

        res.json({
            success: true,
            message: `Sesión ${sessionName} marcada como lista`,
            state: session.state
        });
    } else {
        res.status(400).json({
            error: `No se puede forzar. Estado actual: ${session.state}`
        });
    }
});

// Obtener grupos de WhatsApp
router.get('/:sessionName/groups', async (req, res) => {
    const { sessionName } = req.params;

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: 'Sesión no encontrada' });
    }

    const session = sessions[sessionName];
    if (!session.client || session.state !== config.SESSION_STATES.READY) {
        return res.status(400).json({ error: 'La sesión no está lista' });
    }

    try {
        const chats = await session.client.getChats();
        const groups = chats
            .filter(chat => chat.isGroup)
            .map(group => ({
                id: group.id._serialized,
                name: group.name,
                participants: group.participants?.length || 0
            }));

        res.json({ success: true, groups });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Eliminar sesión
router.post('/delete', async (req, res) => {
    const { sessionName } = req.body;
    const fs = require('fs').promises;
    const path = require('path');

    const validation = sessionManager.validateSessionName(sessionName);
    if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
    }

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    try {
        console.log(`Eliminando sesión: ${sessionName}`);

        if (sessions[sessionName].client) {
            try {
                await sessions[sessionName].client.destroy();
                await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (error) {
                console.warn(`Error cerrando cliente: ${error.message}`);
            }
        }

        delete sessions[sessionName];

        const sessionPath = path.join(config.SESSION_DATA_PATH, `session-${sessionName}`);
        try {
            await fs.access(sessionPath);
            await fs.rm(sessionPath, { recursive: true, force: true });
        } catch (error) {
            console.warn(`No se pudo eliminar carpeta: ${error.message}`);
        }

        res.json({
            success: true,
            message: `Sesión ${sessionName} eliminada exitosamente`
        });

    } catch (error) {
        res.status(500).json({ error: `Error eliminando sesión: ${error.message}` });
    }
});

// Información de rotación de sesiones
router.get('/rotation/info', (req, res) => {
    res.json(sessionManager.getRotationInfo());
});

// Rotar sesión manualmente
router.post('/rotation/rotate', (req, res) => {
    sessionManager.rotateSession();
    res.json({
        success: true,
        message: 'Sesión rotada manualmente',
        ...sessionManager.getRotationInfo()
    });
});

module.exports = router;
