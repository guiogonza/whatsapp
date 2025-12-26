/**
 * Rutas de API para envío de mensajes
 */

const express = require('express');
const router = express.Router();
const multer = require('multer');
const config = require('../config');
const sessionManager = require('../sessionManager');
const { formatPhoneNumber, getFileType, capitalize, sleep } = require('../utils');

const { sessions, MessageMedia } = sessionManager;

// Configuración de multer
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.MAX_FILE_SIZE },
    fileFilter: (req, file, cb) => {
        if (config.ALLOWED_MIMES.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`), false);
        }
    }
});

// Enviar mensaje con rotación automática de sesiones
router.post('/send-auto', async (req, res) => {
    const { phoneNumber, message } = req.body;

    if (!phoneNumber || !message) {
        return res.status(400).json({
            error: 'Se requiere phoneNumber y message'
        });
    }

    try {
        const result = await sessionManager.sendMessageWithRotation(phoneNumber, message);
        
        if (!result.success) {
            return res.status(500).json({
                error: result.error?.message || 'Error enviando mensaje'
            });
        }

        console.log(`✅ Mensaje enviado via ${result.sessionUsed} a ${phoneNumber}`);

        res.json({
            success: true,
            message: `Mensaje enviado exitosamente a ${phoneNumber}`,
            sessionUsed: result.sessionUsed,
            timestamp: new Date().toISOString(),
            messageId: result.messageResult.id.id,
            rotationInfo: sessionManager.getRotationInfo()
        });

    } catch (error) {
        console.error(`Error enviando mensaje: ${error.message}`);
        res.status(500).json({ error: `Error enviando mensaje: ${error.message}` });
    }
});

// Enviar mensaje individual (sesión específica)
router.post('/send-message', async (req, res) => {
    const { sessionName, phoneNumber, message } = req.body;

    if (!sessionName || !phoneNumber || !message) {
        return res.status(400).json({
            error: 'Se requiere sessionName, phoneNumber y message'
        });
    }

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (session.state !== config.SESSION_STATES.READY) {
        return res.status(400).json({
            error: `Sesión no está lista. Estado: ${session.state}`,
            currentState: session.state
        });
    }

    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return res.status(400).json({
            error: 'Número de teléfono inválido (10-15 dígitos)'
        });
    }

    try {
        let isRegistered = false;
        try {
            isRegistered = await session.client.isRegisteredUser(formattedNumber);
        } catch (regError) {
            if (regError.message?.includes('WidFactory')) {
                isRegistered = true;
            } else {
                throw regError;
            }
        }
        
        if (!isRegistered) {
            return res.status(400).json({
                error: `El número ${phoneNumber} no está registrado en WhatsApp`
            });
        }

        const result = await sessionManager.sendMessageWithRetry(session, formattedNumber, message, 3);
        
        if (!result.success) {
            throw result.error || new Error('Error desconocido');
        }

        // Registrar mensaje
        if (!session.messages) session.messages = [];
        session.messages.push({
            timestamp: new Date(),
            to: formattedNumber,
            message: message,
            direction: 'OUT',
            messageId: result.messageResult.id.id,
            status: 'sent'
        });

        session.lastActivity = new Date();

        if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
            session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
        }

        console.log(`Mensaje enviado desde ${sessionName} a ${phoneNumber}`);

        res.json({
            success: true,
            message: `Mensaje enviado exitosamente a ${phoneNumber}`,
            timestamp: new Date().toISOString(),
            messageId: result.messageResult.id.id
        });

    } catch (error) {
        console.error(`Error enviando mensaje: ${error.message}`);

        const errorMsg = error.message || String(error);
        if (errorMsg.includes('WidFactory') || errorMsg.includes('Evaluation failed')) {
            session.needsReconnect = true;
            return res.status(503).json({
                error: `Sesión ${sessionName} necesita reconectarse`,
                code: 'SESSION_NEEDS_RECONNECT',
                retryAfter: 10
            });
        }
        
        res.status(500).json({ error: `Error enviando mensaje: ${error.message}` });
    }
});

// Enviar archivo/imagen
router.post('/send-file', upload.single('file'), async (req, res) => {
    const { sessionName, phoneNumber, caption } = req.body;
    const file = req.file;

    if (!sessionName || !phoneNumber) {
        return res.status(400).json({ error: 'Se requiere sessionName y phoneNumber' });
    }

    if (!file) {
        return res.status(400).json({ error: 'Se requiere un archivo' });
    }

    if (!sessions[sessionName]) {
        return res.status(404).json({ error: `Sesión ${sessionName} no encontrada` });
    }

    const session = sessions[sessionName];

    if (session.state !== config.SESSION_STATES.READY) {
        return res.status(400).json({
            error: `Sesión no está lista. Estado: ${session.state}`
        });
    }

    const formattedNumber = formatPhoneNumber(phoneNumber);
    if (!formattedNumber) {
        return res.status(400).json({ error: 'Número de teléfono inválido' });
    }

    try {
        let isRegistered = false;
        try {
            isRegistered = await session.client.isRegisteredUser(formattedNumber);
        } catch (regError) {
            if (regError.message?.includes('WidFactory')) {
                isRegistered = true;
            } else {
                throw regError;
            }
        }

        if (!isRegistered) {
            return res.status(400).json({
                error: `El número ${phoneNumber} no está registrado en WhatsApp`
            });
        }

        const media = new MessageMedia(
            file.mimetype,
            file.buffer.toString('base64'),
            file.originalname
        );

        const fileType = getFileType(file.mimetype);

        console.log(`${sessionName}: Enviando ${fileType} (${file.originalname}) a ${phoneNumber}`);

        const sendOptions = {};
        if (caption?.trim()) {
            sendOptions.caption = caption.trim();
        }

        let messageResult = null;
        let lastError = null;
        
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const skipStoreCheck = attempt > 1;
                const isReady = await sessionManager.isClientTrulyReady(session, skipStoreCheck);
                
                if (!isReady && attempt === 1) {
                    await sessionManager.waitForClientReady(session, 10000, true);
                }
                
                messageResult = await session.client.sendMessage(formattedNumber, media, sendOptions);
                break;
                
            } catch (error) {
                lastError = error;
                console.log(`${sessionName}: Error intento ${attempt}/3: ${error.message}`);
                if (attempt < 3) await sleep(3000 * attempt);
            }
        }

        if (!messageResult) {
            throw lastError || new Error('Error al enviar archivo después de 3 intentos');
        }

        if (!session.messages) session.messages = [];
        session.messages.push({
            timestamp: new Date(),
            to: formattedNumber,
            type: 'file',
            fileName: file.originalname,
            fileSize: file.size,
            mimeType: file.mimetype,
            caption: caption || null,
            direction: 'OUT',
            messageId: messageResult.id.id,
            status: 'sent'
        });

        session.lastActivity = new Date();

        if (session.messages.length > config.MAX_MESSAGE_HISTORY) {
            session.messages = session.messages.slice(-config.MAX_MESSAGE_HISTORY);
        }

        res.json({
            success: true,
            message: `${capitalize(fileType)} enviado exitosamente a ${phoneNumber}`,
            timestamp: new Date().toISOString(),
            messageId: messageResult.id.id,
            fileInfo: {
                name: file.originalname,
                size: file.size,
                type: file.mimetype
            }
        });

    } catch (error) {
        console.error(`Error enviando archivo: ${error.message}`);

        if (error.message?.includes('WidFactory')) {
            session.needsReconnect = true;
            return res.status(503).json({
                error: `Sesión necesita reconectarse`,
                code: 'SESSION_NEEDS_RECONNECT',
                retryAfter: 10
            });
        }

        res.status(500).json({ error: `Error enviando archivo: ${error.message}` });
    }
});

// Envío masivo con rotación automática
router.post('/send-bulk-auto', async (req, res) => {
    const { contacts, message, delay = 3000 } = req.body;

    if (!contacts || !message) {
        return res.status(400).json({ error: 'Se requiere contacts y message' });
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts debe ser un array no vacío' });
    }

    if (contacts.length > config.MAX_BULK_CONTACTS) {
        return res.status(400).json({ error: `Máximo ${config.MAX_BULK_CONTACTS} contactos` });
    }

    const activeSessions = sessionManager.getActiveSessions();
    if (activeSessions.length === 0) {
        return res.status(400).json({ error: 'No hay sesiones activas' });
    }

    const results = { sent: 0, failed: 0, errors: [], sessionBreakdown: {} };

    try {
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            
            // Obtener sesión actual (rotación automática cada N minutos)
            const session = sessionManager.getCurrentSession();
            
            if (!session) {
                results.failed++;
                results.errors.push(`Sin sesión activa para ${contact}`);
                continue;
            }

            const formattedNumber = formatPhoneNumber(contact);
            if (!formattedNumber) {
                results.failed++;
                results.errors.push(`Número inválido: ${contact}`);
                continue;
            }

            try {
                let isRegistered = false;
                try {
                    isRegistered = await session.client.isRegisteredUser(formattedNumber);
                } catch (regError) {
                    if (regError.message?.includes('WidFactory')) {
                        isRegistered = true;
                    } else {
                        throw regError;
                    }
                }
                
                if (!isRegistered) {
                    results.failed++;
                    results.errors.push(`No registrado: ${contact}`);
                    continue;
                }

                const sendResult = await sessionManager.sendMessageWithRetry(session, formattedNumber, message, 2);
                
                if (sendResult.success) {
                    results.sent++;
                    results.sessionBreakdown[session.name] = (results.sessionBreakdown[session.name] || 0) + 1;
                    console.log(`📤 [${session.name}] ${i+1}/${contacts.length} → ${contact}`);
                } else {
                    results.failed++;
                    results.errors.push(`Error en ${contact}: ${sendResult.error?.message || 'Unknown'}`);
                }

                if (i < contacts.length - 1 && delay > 0) {
                    await sleep(delay);
                }

            } catch (error) {
                results.failed++;
                results.errors.push(`Error en ${contact}: ${error.message}`);
            }
        }

        res.json({
            success: results.sent > 0,
            results,
            message: `Envío masivo: ${results.sent} enviados, ${results.failed} fallidos`,
            rotationInfo: sessionManager.getRotationInfo()
        });

    } catch (error) {
        res.status(500).json({
            error: `Error en envío masivo: ${error.message}`,
            results
        });
    }
});

// Envío masivo (sesión específica) - Mantener compatibilidad
router.post('/send-bulk', async (req, res) => {
    const { sessionName, contacts, message, delay = 3000 } = req.body;

    if (!sessionName || !contacts || !message) {
        return res.status(400).json({ error: 'Se requiere sessionName, contacts y message' });
    }

    if (!Array.isArray(contacts) || contacts.length === 0) {
        return res.status(400).json({ error: 'contacts debe ser un array no vacío' });
    }

    if (contacts.length > config.MAX_BULK_CONTACTS) {
        return res.status(400).json({ error: `Máximo ${config.MAX_BULK_CONTACTS} contactos` });
    }

    if (!sessions[sessionName] || sessions[sessionName].state !== config.SESSION_STATES.READY) {
        return res.status(400).json({ error: `Sesión ${sessionName} no está lista` });
    }

    const session = sessions[sessionName];
    const results = { sent: 0, failed: 0, errors: [], needsReconnect: false };

    try {
        for (let i = 0; i < contacts.length; i++) {
            const contact = contacts[i];
            const formattedNumber = formatPhoneNumber(contact);

            if (!formattedNumber) {
                results.failed++;
                results.errors.push(`Número inválido: ${contact}`);
                continue;
            }

            try {
                let isRegistered = false;
                try {
                    isRegistered = await session.client.isRegisteredUser(formattedNumber);
                } catch (regError) {
                    if (regError.message?.includes('WidFactory')) {
                        isRegistered = true;
                    } else {
                        throw regError;
                    }
                }
                
                if (!isRegistered) {
                    results.failed++;
                    results.errors.push(`No registrado: ${contact}`);
                    continue;
                }

                const sendResult = await sessionManager.sendMessageWithRetry(session, formattedNumber, message, 2);
                
                if (sendResult.success) {
                    results.sent++;
                    console.log(`Mensaje masivo ${i+1}/${contacts.length} enviado a ${contact}`);
                } else {
                    results.failed++;
                    results.errors.push(`Error en ${contact}: ${sendResult.error?.message || 'Unknown'}`);
                    
                    if (sendResult.error?.message?.includes('WidFactory')) {
                        results.needsReconnect = true;
                    }
                }

                if (i < contacts.length - 1 && delay > 0) {
                    await sleep(delay);
                }

            } catch (error) {
                results.failed++;
                results.errors.push(`Error en ${contact}: ${error.message}`);
                
                if (error.message?.includes('WidFactory')) {
                    results.needsReconnect = true;
                }
            }
        }

        session.lastActivity = new Date();

        const response = {
            success: results.sent > 0,
            results,
            message: `Envío masivo: ${results.sent} enviados, ${results.failed} fallidos`
        };
        
        if (results.needsReconnect) {
            response.warning = 'Algunos mensajes fallaron. Considere reiniciar la sesión.';
        }

        res.json(response);

    } catch (error) {
        res.status(500).json({
            error: `Error en envío masivo: ${error.message}`,
            results
        });
    }
});

module.exports = router;
