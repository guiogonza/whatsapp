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
const {
    isValidEmail,
    formatPlate,
    isValidPlateFormat,
    findUserByEmail,
    findDeviceByPlate,
    assignDeviceToUser,
    getUserDevices,
    invalidateClientsCache
} = require('./gpswox-api');

// Estados del flujo conversacional
const CONVERSATION_STATES = {
    WAITING_EMAIL: 'waiting_email',
    VALIDATING_EMAIL: 'validating_email',
    WAITING_PLATE: 'waiting_plate',
    VALIDATING_PLATE: 'validating_plate',
    ASSIGNING_DEVICE: 'assigning_device',
    COMPLETED: 'completed',
    ERROR: 'error'
};

// Almacén de conversaciones activas: { phoneNumber: { state, data } }
const activeConversations = new Map();

// Contador de mensajes por número: { phoneNumber: { count, firstMessageTime } }
const messageCounter = new Map();
const MAX_MESSAGES_PER_NUMBER = 10;
const MESSAGE_COUNTER_RESET = 24 * 60 * 60 * 1000; // Reset cada 24 horas

// Timeout para limpiar conversaciones inactivas (30 minutos)
const CONVERSATION_TIMEOUT = 30 * 60 * 1000;

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
 * Inicia una nueva conversación de registro
 * @param {string} phoneNumber - Número de teléfono del usuario
 */
function startConversation(phoneNumber) {
    console.log(`🆕 Iniciando conversación de registro con ${phoneNumber}`);
    
    activeConversations.set(phoneNumber, {
        state: CONVERSATION_STATES.WAITING_EMAIL,
        data: {
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
 * @returns {Promise<boolean>} True si se procesó el mensaje, False si no
 */
async function processGPSwoxMessage(session, sessionName, socket, senderPhone, messageText) {
    try {
        // Verificar límite de mensajes por número
        if (!checkMessageLimit(senderPhone)) {
            // Solo avisar una vez (en el mensaje 11)
            const counter = messageCounter.get(senderPhone);
            if (counter && counter.count === MAX_MESSAGES_PER_NUMBER + 1) {
                await socket.sendMessage(senderPhone, {
                    text: `⚠️ Has alcanzado el límite de *${MAX_MESSAGES_PER_NUMBER} mensajes*. Por favor, intenta nuevamente en 24 horas o contacta al administrador.`
                });
            }
            return true; // Marcar como procesado para que no siga
        }

        // Verificar si hay conversación activa
        let conversation = getConversationState(senderPhone);
        
        // Si no hay conversación activa, verificar si el mensaje es un correo para iniciar
        if (!conversation) {
            // Intentar detectar si es un correo electrónico
            if (isValidEmail(messageText.trim())) {
                startConversation(senderPhone);
                conversation = getConversationState(senderPhone);
            } else {
                // No es un correo válido y no hay conversación activa, ignorar
                return false;
            }
        }

        // Procesar según el estado actual
        switch (conversation.state) {
            case CONVERSATION_STATES.WAITING_EMAIL:
                await handleEmailInput(session, socket, senderPhone, messageText, conversation);
                break;

            case CONVERSATION_STATES.WAITING_PLATE:
                await handlePlateInput(session, socket, senderPhone, messageText, conversation);
                break;

            default:
                console.log(`⚠️ Estado desconocido: ${conversation.state}`);
                return false;
        }

        return true;

    } catch (error) {
        console.error(`❌ Error procesando mensaje GPSwox: ${error.message}`);
        
        // Enviar mensaje de error al usuario
        try {
            await socket.sendMessage(senderPhone, {
                text: `❌ Ocurrió un error procesando tu solicitud: ${error.message}\n\nPor favor, inténtalo nuevamente más tarde.`
            });
        } catch (sendError) {
            console.error(`Error enviando mensaje de error: ${sendError.message}`);
        }
        
        // Finalizar conversación en caso de error
        endConversation(senderPhone);
        return true;
    }
}

/**
 * Maneja la entrada del correo electrónico
 */
async function handleEmailInput(session, socket, senderPhone, messageText, conversation) {
    const email = messageText.trim();
    
    // Validar formato de correo
    if (!isValidEmail(email)) {
        await socket.sendMessage(senderPhone, {
            text: `❌ El correo electrónico no es válido.\n\nPor favor, envía un correo electrónico válido.\n\nEjemplo: usuario@ejemplo.com`
        });
        return;
    }

    // Actualizar estado
    updateConversation(senderPhone, {
        state: CONVERSATION_STATES.VALIDATING_EMAIL
    });

    // Enviar mensaje de validación
    await socket.sendMessage(senderPhone, {
        text: `🔍 Validando correo: *${email}*\n\nPor favor espera...`
    });

    // Buscar usuario en GPSwox
    try {
        const user = await findUserByEmail(email);
        
        if (!user) {
            await socket.sendMessage(senderPhone, {
                text: `❌ No se encontró un usuario con el correo: *${email}*\n\nVerifica que el correo esté registrado en el sistema GPS.\n\nSi el problema persiste, contacta al administrador.`
            });
            
            // Reiniciar conversación
            updateConversation(senderPhone, {
                state: CONVERSATION_STATES.WAITING_EMAIL,
                data: { ...conversation.data, email: null, user: null }
            });
            return;
        }

        // Usuario encontrado
        conversation.data.email = email;
        conversation.data.user = user;

        await socket.sendMessage(senderPhone, {
            text: `✅ ¡Usuario verificado!\n\n` +
                  `📧 Correo: *${email}*\n` +
                  `🚗 Vehículos actuales: *${user.devices_count || 0}*\n\n` +
                  `Ahora, envía la *placa del vehículo* que deseas asignar.\n\n` +
                  `Formato: ABC123 o ABC-123\n` +
                  `(El guion se agrega automáticamente)`
        });

        // Cambiar al siguiente estado
        updateConversation(senderPhone, {
            state: CONVERSATION_STATES.WAITING_PLATE,
            data: conversation.data
        });

    } catch (error) {
        console.error(`Error validando correo: ${error.message}`);
        
        await socket.sendMessage(senderPhone, {
            text: `❌ Error al validar el correo en el sistema.\n\n` +
                  `Error: ${error.message}\n\n` +
                  `Por favor, inténtalo nuevamente o contacta al administrador.`
        });
        
        endConversation(senderPhone);
    }
}

/**
 * Maneja la entrada de la placa del vehículo
 */
async function handlePlateInput(session, socket, senderPhone, messageText, conversation) {
    let plate = messageText.trim().toUpperCase();
    
    // Formatear placa (agregar guion si no lo tiene)
    const formattedPlate = formatPlate(plate);
    
    // Validar formato
    if (!isValidPlateFormat(formattedPlate)) {
        await socket.sendMessage(senderPhone, {
            text: `❌ Formato de placa inválido.\n\n` +
                  `Recibido: *${plate}*\n` +
                  `Esperado: ABC-123 (3 caracteres, guion, resto de caracteres)\n\n` +
                  `Por favor, envía la placa nuevamente.`
        });
        return;
    }

    // Si la placa fue reformateada, informar al usuario
    if (plate !== formattedPlate) {
        await socket.sendMessage(senderPhone, {
            text: `📝 Placa formateada: *${formattedPlate}*\n\n🔍 Validando...`
        });
    } else {
        await socket.sendMessage(senderPhone, {
            text: `🔍 Validando placa: *${formattedPlate}*\n\nPor favor espera...`
        });
    }

    // Actualizar estado
    updateConversation(senderPhone, {
        state: CONVERSATION_STATES.VALIDATING_PLATE
    });

    try {
        // Buscar dispositivo en GPSwox
        const device = await findDeviceByPlate(formattedPlate);
        
        if (!device) {
            await socket.sendMessage(senderPhone, {
                text: `❌ No se encontró un vehículo con la placa: *${formattedPlate}*\n\n` +
                      `Verifica que la placa esté correcta y que el vehículo esté registrado en el sistema GPS.\n\n` +
                      `Si deseas intentar con otra placa, envíala ahora.`
            });
            
            // Volver al estado de espera de placa
            updateConversation(senderPhone, {
                state: CONVERSATION_STATES.WAITING_PLATE
            });
            return;
        }

        // Dispositivo encontrado
        conversation.data.plate = formattedPlate;
        conversation.data.device = device;

        await socket.sendMessage(senderPhone, {
            text: `✅ ¡Vehículo encontrado!\n\n` +
                  `🚗 Placa: *${formattedPlate}*\n` +
                  `📡 Protocolo: ${device.protocol || 'N/A'}\n` +
                  `📍 Grupo: ${device.group_title || 'N/A'}\n\n` +
                  `🔗 Asignando al usuario *${conversation.data.email}*...`
        });

        // Cambiar estado a asignación
        updateConversation(senderPhone, {
            state: CONVERSATION_STATES.ASSIGNING_DEVICE,
            data: conversation.data
        });

        // Asignar dispositivo al usuario
        const result = await assignDeviceToUser(conversation.data.user.id, device.id);

        if (result.success) {
            // Invalidar cache de clientes porque cambió asignación
            invalidateClientsCache();

            await socket.sendMessage(senderPhone, {
                text: `✅ ¡Asignación exitosa!\n\n` +
                      `👤 Usuario: *${conversation.data.email}*\n` +
                      `🚗 Vehículo: *${formattedPlate}*\n\n` +
                      `🎉 El proceso ha finalizado correctamente.\n\n` +
                      `Si deseas asignar otro vehículo, envía el correo electrónico del usuario.`
            });

            // Marcar como completado y finalizar
            updateConversation(senderPhone, {
                state: CONVERSATION_STATES.COMPLETED
            });
            
            endConversation(senderPhone);

        } else {
            await socket.sendMessage(senderPhone, {
                text: `❌ Error al asignar el vehículo\n\n` +
                      `Error: ${result.error}\n\n` +
                      `Por favor, contacta al administrador o inténtalo nuevamente.`
            });
            
            endConversation(senderPhone);
        }

    } catch (error) {
        console.error(`Error procesando placa: ${error.message}`);
        
        await socket.sendMessage(senderPhone, {
            text: `❌ Error al procesar la placa en el sistema.\n\n` +
                  `Error: ${error.message}\n\n` +
                  `Por favor, inténtalo nuevamente o contacta al administrador.`
        });
        
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
    return sessionName === config.GPSWOX_SESSION_NAME;
}

/**
 * Verifica si el modo dedicado GPSwox está habilitado
 * @returns {boolean}
 */
function isGPSwoxDedicatedMode() {
    return config.GPSWOX_DEDICATED_MODE;
}

/**
 * Obtiene el nombre de la sesión GPSwox dedicada
 * @returns {string}
 */
function getGPSwoxSessionName() {
    return config.GPSWOX_SESSION_NAME;
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
    getGPSwoxSessionName
};
