/**
 * Módulo de Sesión Especial GPSwox
 * Maneja el flujo conversacional para registro de usuarios y asignación de placas
 * 
 * Flujo:
 * 1. Usuario envía correo electrónico
 * 2. Sistema valida formato de correo
 * 3. Sistema verifica si el correo existe en GPSwox
 * 4. Sistema solicita placa del vehículo
 * 5. Sistema formatea placa (agrega guion después de 3 caracteres)
 * 6. Sistema valida si la placa existe en GPSwox
 * 7. Sistema asigna la placa al usuario
 */

const config = require('../../config');
const database = require('../../database-postgres');
const { getCountryFromIP, getSocketIP } = require('./utils');
const {
    isValidEmail,
    formatPlate,
    isValidPlateFormat,
    findUserByEmail,
    findDeviceByPlate,
    assignDeviceToUser,
    invalidateClientsCache
} = require('./gpswox-api');

// Estados del flujo conversacional
const CONVERSATION_STATES = {
    MENU: 'menu',
    OPTION_1_EMAIL: 'option_1_email',
    OPTION_1_PLATE: 'option_1_plate',
    OPTION_1_ASSIGNING: 'option_1_assigning',
    OPTION_2_PLATE: 'option_2_plate',
    OPTION_3_EMAIL: 'option_3_email',
    COMPLETED: 'completed',
    ERROR: 'error'
};

// Almacén de conversaciones activas: { phoneNumber: { state, data } }
const activeConversations = new Map();

// Contador de mensajes por número: { phoneNumber: { count, firstMessageTime } }
const messageCounter = new Map();
const MAX_MESSAGES_PER_NUMBER = 40;
const MESSAGE_COUNTER_RESET = 24 * 60 * 60 * 1000; // Reset cada 24 horas

// Timeout para limpiar conversaciones inactivas (30 minutos)
const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

// Cache de información de conexión por número (IP y país)
const connectionInfoCache = new Map();

/**
 * Obtiene información de conexión (IP y país) del remitente
 * @param {Object} socket - Socket de WhatsApp
 * @param {string} senderPhone - Número del remitente
 * @returns {Promise<{ip: string, country: string}>}
 */
async function getConnectionInfo(socket, senderPhone) {
    // Verificar cache primero (válido por 1 hora)
    const cached = connectionInfoCache.get(senderPhone);
    if (cached && (Date.now() - cached.timestamp < 3600000)) {
        return { ip: cached.ip, country: cached.country };
    }

    // Intentar obtener IP del socket
    let ip = getSocketIP(socket);
    let country = 'Desconocido';

    if (ip) {
        // Obtener país desde la IP
        country = await getCountryFromIP(ip);
    } else {
        // Si no se puede obtener la IP, marcar como desconocido
        ip = 'Desconocido';
    }

    // Guardar en cache
    connectionInfoCache.set(senderPhone, {
        ip,
        country,
        timestamp: Date.now()
    });

    return { ip, country };
}

/**
 * Limpia el número de teléfono removiendo sufijos de WhatsApp
 * @param {string} senderPhone - Número con formato WhatsApp
 * @returns {string} - Número limpio
 */
function cleanPhoneNumber(senderPhone) {
    return senderPhone.replace('@s.whatsapp.net', '').replace('@c.us', '').split(':')[0];
}

/**
 * Limpia conversaciones inactivas
 */
function cleanInactiveConversations() {
    const now = Date.now();
    for (const [phone, conversation] of activeConversations.entries()) {
        if (now - conversation.lastActivity > CONVERSATION_TIMEOUT) {
            console.log(`🧹 Limpiando conversación inactiva: ${phone}`);
            activeConversations.delete(phone);
        }
    }
    // Limpiar contadores expirados
    for (const [phone, counter] of messageCounter.entries()) {
        if (now - counter.firstMessageTime > MESSAGE_COUNTER_RESET) {
            messageCounter.delete(phone);
        }
    }
}

// Ejecutar limpieza cada 10 minutos
setInterval(cleanInactiveConversations, 10 * 60 * 1000);

/**
 * Verifica y registra un mensaje. Retorna false si excedió el límite.
 */
function checkMessageLimit(phoneNumber) {
    const now = Date.now();
    let counter = messageCounter.get(phoneNumber);

    if (!counter || (now - counter.firstMessageTime) > MESSAGE_COUNTER_RESET) {
        counter = { count: 0, firstMessageTime: now };
        messageCounter.set(phoneNumber, counter);
    }

    counter.count++;

    if (counter.count > MAX_MESSAGES_PER_NUMBER) {
        console.log(`🚫 Límite de mensajes alcanzado para ${phoneNumber}: ${counter.count}/${MAX_MESSAGES_PER_NUMBER}`);
        return false;
    }

    return true;
}

/**
 * Inicia una nueva conversación mostrando el menú
 * @param {string} phoneNumber - Número de teléfono del usuario
 */
function startConversation(phoneNumber) {
    console.log(`🆕 Iniciando conversación con ${phoneNumber}`);
    
    activeConversations.set(phoneNumber, {
        state: CONVERSATION_STATES.MENU,
        data: {
            selectedOption: null,
            user: null,
            device: null,
            email: null,
            plate: null
        },
        startTime: Date.now(),
        lastActivity: Date.now()
    });
}

/**
 * Obtiene el estado actual de una conversación
 */
function getConversationState(phoneNumber) {
    return activeConversations.get(phoneNumber);
}

/**
 * Actualiza el estado de una conversación
 */
function updateConversation(phoneNumber, updates) {
    const conversation = activeConversations.get(phoneNumber);
    if (conversation) {
        Object.assign(conversation, updates);
        conversation.lastActivity = Date.now();
    }
}

/**
 * Finaliza una conversación
 */
function endConversation(phoneNumber) {
    console.log(`✅ Finalizando conversación con ${phoneNumber}`);
    activeConversations.delete(phoneNumber);
}

/**
 * Verifica si hay una conversación activa
 */
function hasActiveConversation(phoneNumber) {
    return activeConversations.has(phoneNumber);
}

/**
 * Procesa un mensaje entrante en el flujo de registro GPSwox
 * @param {Object} session - Sesión de WhatsApp
 * @param {string} sessionName - Nombre de la sesión
 * @param {Object} socket - Socket de WhatsApp
 * @param {string} senderPhone - Número del remitente
 * @param {string} messageText - Texto del mensaje
 * @param {boolean} canStartNewConversation - Si puede iniciar nuevas conversaciones (solo sesión dedicada)
 * @returns {Promise<boolean>} True si se procesó el mensaje, False si no
 */
async function processGPSwoxMessage(session, sessionName, socket, senderPhone, messageText, canStartNewConversation = false) {
    try {
        // Obtener información de conexión (IP y país)
        const { ip, country } = await getConnectionInfo(socket, senderPhone);
        
        // Guardar mensaje entrante en BD con IP y país
        const cleanPhone = cleanPhoneNumber(senderPhone);
        await database.logGPSwoxMessage(cleanPhone, 'IN', messageText, null, null, ip, country);

        // Verificar límite de mensajes por número
        if (!checkMessageLimit(senderPhone)) {
            const counter = messageCounter.get(senderPhone);
            if (counter && counter.count === MAX_MESSAGES_PER_NUMBER + 1) {
                await socket.sendMessage(senderPhone, {
                    text: `⚠️ Has alcanzado el límite de *${MAX_MESSAGES_PER_NUMBER} mensajes*. Por favor, intenta nuevamente en 24 horas.`
                });
            }
            return true;
        }

        // Verificar si hay conversación activa
        let conversation = getConversationState(senderPhone);
        const input = messageText.trim();
        
        // Si el usuario escribe "menu" en cualquier momento, regresar al menú principal
        if (input.toLowerCase() === 'menu' || input.toLowerCase() === 'menú') {
            endConversation(senderPhone);
            startConversation(senderPhone);
            conversation = getConversationState(senderPhone);
            await showMenu(socket, senderPhone);
            return true;
        }
        
        // Si no hay conversación activa
        if (!conversation) {
            // Solo iniciar nueva conversación si está permitido (sesión dedicada GPSwox)
            if (canStartNewConversation) {
                console.log(`🆕 Iniciando nueva conversación GPSwox con ${senderPhone}`);
                startConversation(senderPhone);
                conversation = getConversationState(senderPhone);
                await showMenu(socket, senderPhone);
                return true;
            } else {
                // No está permitido iniciar conversación desde esta sesión
                console.log(`📭 No hay conversación GPSwox activa para ${senderPhone} - no procesando en sesión no dedicada`);
                return false; // Dejar que otras respuestas automáticas manejen el mensaje
            }
        }

        // Procesar según el estado actual
        switch (conversation.state) {
            case CONVERSATION_STATES.MENU:
                await handleMenuSelection(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_1_EMAIL:
                await handleOption1Email(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_1_PLATE:
                await handleOption1Plate(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_2_PLATE:
                await handleOption2Plate(socket, senderPhone, input, conversation);
                break;

            case CONVERSATION_STATES.OPTION_3_EMAIL:
                await handleOption3Email(socket, senderPhone, input, conversation);
                break;

            default:
                console.log(`⚠️ Estado desconocido: ${conversation.state}`);
                endConversation(senderPhone);
                await showMenu(socket, senderPhone);
                startConversation(senderPhone);
                return true;
        }

        return true;

    } catch (error) {
        console.error(`❌ Error procesando mensaje GPSwox: ${error.message}`);
        
        const cleanPhone = cleanPhoneNumber(senderPhone);
        const errorText = `❌ Ocurrió un error procesando tu solicitud: ${error.message}\n\nEnvía cualquier mensaje para volver al menú.`;
        
        try {
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR');
            await socket.sendMessage(senderPhone, { text: errorText });
        } catch (sendError) {
            console.error(`Error enviando mensaje de error: ${sendError.message}`);
        }
        
        endConversation(senderPhone);
        return true;
    }
}

/**
 * Muestra el menú principal
 */
async function showMenu(socket, senderPhone) {
    const menuText = `👋 *Bienvenido al sistema de registro vehiculo*\n\n` +
                     `Por favor, selecciona una opción enviando el número:\n\n` +
                     `*1* - Asignar usuario a vehículo 🚗\n` +
                     `*2* - Consultar placa y última ubicación 📍\n` +
                     `*3* - Consultar usuario 👤\n\n` +
                     `Envía el número de la opción que deseas.`;
    
    const cleanPhone = cleanPhoneNumber(senderPhone);
    await database.logGPSwoxMessage(cleanPhone, 'OUT', menuText, 'MENU');
    
    await socket.sendMessage(senderPhone, { text: menuText });
}

/**
 * Maneja la selección del menú
 */
async function handleMenuSelection(socket, senderPhone, input, conversation) {
    const option = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);

    if (option === '1') {
        conversation.data.selectedOption = 1;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_1_EMAIL });
        const responseText = `🚗 *Asignar usuario a vehículo*\n\n` +
                  `Por favor, envía el *correo electrónico* del usuario.\n\n` +
                  `Ejemplo: usuario@ejemplo.com\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_1_EMAIL');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '2') {
        conversation.data.selectedOption = 2;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_2_PLATE });
        const responseText = `📍 *Consultar placa y ubicación*\n\n` +
                  `Por favor, envía la *placa* del vehículo.\n\n` +
                  `Ejemplo: ABC123 o ABC-123\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_2_PLATE');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else if (option === '3') {
        conversation.data.selectedOption = 3;
        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_3_EMAIL });
        const responseText = `👤 *Consultar usuario*\n\n` +
                  `Por favor, envía el *correo electrónico* del usuario.\n\n` +
                  `Ejemplo: usuario@ejemplo.com\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'OPTION_3_EMAIL');
        await socket.sendMessage(senderPhone, { text: responseText });
    } else {
        const responseText = `❌ Opción no válida. Por favor, envía *1*, *2* o *3*.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', responseText, 'MENU');
        await socket.sendMessage(senderPhone, { text: responseText });
    }
}

/**
 * OPCIÓN 1: Asignar usuario a vehículo - Maneja entrada de email
 */
async function handleOption1Email(socket, senderPhone, input, conversation) {
    const email = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);
    
    // Permitir regresar al menú
    if (email === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }
    
    if (!isValidEmail(email)) {
        const errorText = `❌ El correo electrónico no es válido.\n\nPor favor, envía un correo electrónico válido.\n\nEjemplo: usuario@ejemplo.com\n\nEnvía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_1_EMAIL');
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const validatingText = `🔍 Validando correo: *${email}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', validatingText, 'OPTION_1_EMAIL');
    await socket.sendMessage(senderPhone, { text: validatingText });

    try {
        const user = await findUserByEmail(email);
        
        if (!user) {
            const notFoundText = `❌ No se encontró un usuario con el correo: *${email}*\n\nVerifica que esté registrado en el sistema.\n\nEnvía otro correo o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_1_EMAIL');
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        conversation.data.email = email;
        conversation.data.user = user;

        const successText = `✅ ¡Usuario verificado!\n\n` +
                  `📧 Correo: *${email}*\n` +
                  `👤 Nombre: ${user.email || 'N/A'}\n` +
                  `🚗 Vehículos: *${user.devices_count || 0}*\n\n` +
                  `Ahora envía la *placa del vehículo*.\n\n` +
                  `Ejemplo: IMU148 o IMU-148\n\n` +
                  `Envía *0* para regresar al menú principal.`;
        
        await database.logGPSwoxMessage(cleanPhone, 'OUT', successText, 'OPTION_1_EMAIL', conversation.data);
        await socket.sendMessage(senderPhone, { text: successText });

        updateConversation(senderPhone, { state: CONVERSATION_STATES.OPTION_1_PLATE });

    } catch (error) {
        console.error(`Error validando correo: ${error.message}`);
        const errorText = `❌ Error al validar el correo: ${error.message}\n\nIntenta de nuevo o escribe *menu*.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_1_EMAIL');
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

/**
 * OPCIÓN 1: Asignar usuario a vehículo - Maneja entrada de placa
 */
async function handleOption1Plate(socket, senderPhone, input, conversation) {
    const cleanPhone = cleanPhoneNumber(senderPhone);
    
    // Permitir regresar al menú ANTES de procesar el input
    if (input.trim() === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }
    
    const plate = input.trim().toUpperCase();
    const formattedPlate = formatPlate(plate);
    
    if (!isValidPlateFormat(formattedPlate)) {
        const errorText = `❌ Formato de placa inválido: *${plate}*\n\nEjemplo: IMU148 o IMU-148\n\nEnvía la placa nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_1_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const validatingText = `🔍 Validando placa: *${formattedPlate}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', validatingText, 'OPTION_1_PLATE', conversation.data);
    await socket.sendMessage(senderPhone, { text: validatingText });

    try {
        const device = await findDeviceByPlate(formattedPlate);
        
        if (!device) {
            const notFoundText = `❌ No se encontró vehículo con placa: *${formattedPlate}*\n\nVerifica que esté registrado.\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_1_PLATE', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        conversation.data.plate = formattedPlate;
        conversation.data.device = device;

        const foundText = `✅ ¡Vehículo encontrado!\n\n` +
                  `🚗 Placa: *${formattedPlate}*\n` +
                  `📡 Protocolo: ${device.protocol || 'N/A'}\n\n` +
                  `🔗 Asignando a *${conversation.data.email}*...`;
        
        await database.logGPSwoxMessage(cleanPhone, 'OUT', foundText, 'OPTION_1_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: foundText });

        const result = await assignDeviceToUser(conversation.data.user.id, device.id);

        if (result.success) {
            invalidateClientsCache();

            const msg = result.alreadyAssigned 
                ? `ℹ️ El usuario *${conversation.data.email}* ya tenía asignado *${formattedPlate}*.\n\n✅ Proceso finalizado.\n\nEscribe *menu* para volver.`
                : `✅ ¡Asignación exitosa!\n\n👤 Usuario: *${conversation.data.email}*\n🚗 Vehículo: *${formattedPlate}*\n\n🎉 Proceso completado.\n\nEscribe *menu* para volver.`;

            await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, 'COMPLETED', conversation.data);
            await socket.sendMessage(senderPhone, { text: msg });
            endConversation(senderPhone);
        } else {
            const errorText = `❌ Error al asignar: ${result.error}\n\nContacta al administrador o escribe *menu*.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
            await socket.sendMessage(senderPhone, { text: errorText });
            endConversation(senderPhone);
        }

    } catch (error) {
        console.error(`Error procesando placa: ${error.message}`);
        const errorText = `❌ Error: ${error.message}\n\nEscribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

/**
 * OPCIÓN 2: Consultar placa y última ubicación
 */
async function handleOption2Plate(socket, senderPhone, input, conversation) {
    const cleanPhone = cleanPhoneNumber(senderPhone);
    
    // Permitir regresar al menú ANTES de procesar el input
    if (input.trim() === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }
    
    const plate = input.trim().toUpperCase();
    const formattedPlate = formatPlate(plate);
    
    if (!isValidPlateFormat(formattedPlate)) {
        const errorText = `❌ Formato de placa inválido: *${plate}*\n\nEjemplo: IMU148\n\nEnvía la placa nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_2_PLATE', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const consultingText = `🔍 Consultando placa: *${formattedPlate}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', consultingText, 'OPTION_2_PLATE', conversation.data);
    await socket.sendMessage(senderPhone, { text: consultingText });

    try {
        const device = await findDeviceByPlate(formattedPlate);
        
        if (!device) {
            const notFoundText = `❌ No se encontró vehículo con placa: *${formattedPlate}*\n\nVerifica que esté registrado.\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_2_PLATE', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        const onlineStatus = device.online ? '🟢 En Línea' : '🔴 Desconectado';
        const speed = device.speed ? `${device.speed} km/h` : 'N/A';
        const lat = device.lat || 'N/A';
        const lng = device.lng || 'N/A';
        const lastReport = device.time || 'N/A';
        const googleMapsLink = (lat !== 'N/A' && lng !== 'N/A') 
            ? `https://www.google.com/maps?q=${lat},${lng}` 
            : null;

        let msg = `📍 *Información de vehículo*\n\n` +
                  `🚗 Placa: *${formattedPlate}*\n` +
                  `${onlineStatus}\n` +
                  `📡 Protocolo: ${device.protocol || 'N/A'}\n` +
                  `🗂️ Grupo: ${device.group_title || 'N/A'}\n` +
                  `⚡ Velocidad: ${speed}\n` +
                  `🕐 Último reporte: ${lastReport}\n\n` +
                  `📌 *Última ubicación:*\n` +
                  `Lat: ${lat}\n` +
                  `Lng: ${lng}`;

        if (googleMapsLink) {
            msg += `\n\n🗺️ Ver en mapa: ${googleMapsLink}`;
        }

        msg += `\n\nEnvía otra placa o envía *0* para regresar al menú principal.`;

        await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, 'OPTION_2_PLATE', { ...conversation.data, device });
        await socket.sendMessage(senderPhone, { text: msg });

    } catch (error) {
        console.error(`Error consultando placa: ${error.message}`);
        const errorText = `❌ Error al consultar: ${error.message}\n\nEscribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

/**
 * OPCIÓN 3: Consultar usuario
 */
async function handleOption3Email(socket, senderPhone, input, conversation) {
    const email = input.trim();
    const cleanPhone = cleanPhoneNumber(senderPhone);
    
    // Permitir regresar al menú
    if (email === '0') {
        updateConversation(senderPhone, { state: CONVERSATION_STATES.MENU });
        await showMenu(socket, senderPhone);
        return;
    }
    
    if (!isValidEmail(email)) {
        const errorText = `❌ Correo inválido.\n\nEjemplo: usuario@ejemplo.com\n\nEnvía el correo nuevamente o envía *0* para regresar al menú principal.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'OPTION_3_EMAIL', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        return;
    }

    const consultingText = `🔍 Consultando usuario: *${email}*...`;
    await database.logGPSwoxMessage(cleanPhone, 'OUT', consultingText, 'OPTION_3_EMAIL', conversation.data);
    await socket.sendMessage(senderPhone, { text: consultingText });

    try {
        const user = await findUserByEmail(email);
        
        if (!user) {
            const notFoundText = `❌ No se encontró usuario con correo: *${email}*\n\nVerifica que esté registrado.\n\nEnvía otro correo o envía *0* para regresar al menú principal.`;
            await database.logGPSwoxMessage(cleanPhone, 'OUT', notFoundText, 'OPTION_3_EMAIL', conversation.data);
            await socket.sendMessage(senderPhone, { text: notFoundText });
            return;
        }

        const msg = `✅ *Usuario encontrado*\n\n` +
                    `📧 Correo: *${email}*\n` +
                    `🚗 Vehículos asignados: ${user.devices_count || 0}\n\n` +
                    `Envía otro correo o envía *0* para regresar al menú principal.`;

        await database.logGPSwoxMessage(cleanPhone, 'OUT', msg, 'OPTION_3_EMAIL', { ...conversation.data, user });
        await socket.sendMessage(senderPhone, { text: msg });

    } catch (error) {
        console.error(`Error consultando usuario: ${error.message}`);
        const errorText = `❌ Error al consultar: ${error.message}\n\nEscribe *menu* para volver.`;
        await database.logGPSwoxMessage(cleanPhone, 'OUT', errorText, 'ERROR', conversation.data);
        await socket.sendMessage(senderPhone, { text: errorText });
        endConversation(senderPhone);
    }
}

/**
 * Obtiene estadísticas de conversaciones activas
 */
function getConversationStats() {
    const stats = {
        total: activeConversations.size,
        byState: {}
    };

    for (const conversation of activeConversations.values()) {
        const state = conversation.state;
        stats.byState[state] = (stats.byState[state] || 0) + 1;
    }

    return stats;
}

/**
 * Verifica si una sesión es la sesión dedicada GPSwox
 * @param {string} sessionName - Nombre de la sesión
 * @returns {boolean}
 */
function isGPSwoxSession(sessionName) {
    // Soportar múltiples sesiones GPSwox
    return config.GPSWOX_SESSION_NAMES.includes(sessionName);
}

/**
 * Verifica si el modo dedicado GPSwox está habilitado
 * @returns {boolean}
 */
function isGPSwoxDedicatedMode() {
    return config.GPSWOX_DEDICATED_MODE;
}

/**
 * Obtiene el nombre de la sesión GPSwox dedicada (primera de la lista)
 * @returns {string}
 */
function getGPSwoxSessionName() {
    return config.GPSWOX_SESSION_NAME;
}

/**
 * Obtiene todos los nombres de sesiones GPSwox
 * @returns {string[]}
 */
function getGPSwoxSessionNames() {
    return config.GPSWOX_SESSION_NAMES;
}

/**
 * Obtiene todas las conversaciones activas
 * @returns {Array}
 */
function getActiveConversations() {
    const conversations = [];
    for (const [phoneNumber, data] of activeConversations.entries()) {
        conversations.push({
            phoneNumber,
            state: data.state,
            data: data.data,
            lastActivity: data.lastActivity,
            timeout: data.timeout
        });
    }
    return conversations;
}

/**
 * Obtiene estadísticas de las conversaciones
 * @returns {Object}
 */
function getStats() {
    return {
        activeConversations: activeConversations.size,
        messagesTracked: messageCounter.size,
        states: getStateDistribution()
    };
}

/**
 * Obtiene la distribución de estados de las conversaciones
 * @returns {Object}
 */
function getStateDistribution() {
    const distribution = {};
    for (const [, data] of activeConversations.entries())  {
        const state = data.state;
        distribution[state] = (distribution[state] || 0) + 1;
    }
    return distribution;
}

module.exports = {
    CONVERSATION_STATES,
    processGPSwoxMessage,
    startConversation,
    endConversation,
    hasActiveConversation,
    getConversationState,
    getConversationStats,
    isGPSwoxSession,
    isGPSwoxDedicatedMode,
    getGPSwoxSessionName,
    getGPSwoxSessionNames,
    getActiveConversations,
    getStats
};
