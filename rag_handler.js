const axios = require('axios');
const logger = require('./logger'); // Asume que tienes un logger configurado

class RAGHandler {
    constructor(ollamaBaseUrl = process.env.OLLAMA_API_URL || 'http://127.0.0.1:11434/api/chat', 
                ollamaModel = process.env.OLLAMA_MODEL || 'llama3') {
        this.ollamaBaseUrl = ollamaBaseUrl;
        this.ollamaModel = ollamaModel;
    }

    /**
     * Genera un mensaje de bienvenida para el usuario.
     * @returns {Promise<string>} El mensaje de bienvenida generado.
     */
    async generateWelcomeMessage() {
        const welcomePrompt = `
Sistema: Genera un mensaje de bienvenida para un agricultor que acaba de conectarse al chatbot.

Instrucciones:
- Preséntate como un asistente agrónomo virtual
- El mensaje debe ser profesional pero amigable
- Menciona que puedes ayudar con consultas sobre cultivos, productos y prácticas agrícolas
- Debe ser en español

Genera el mensaje:`;

        try {
            const response = await axios.post(this.ollamaBaseUrl, {
                model: this.ollamaModel,
                messages: [{ role: 'user', content: welcomePrompt }],
                stream: false
            }, {
                timeout: 5000 // Timeout de 5 segundos
            });

            // Validar la respuesta de la API
            if (response.data && response.data.message && response.data.message.content) {
                return response.data.message.content;
            } else {
                throw new Error('Invalid response format from Ollama API');
            }
        } catch (error) {
            logger.error('Error generating welcome message:', error);

            // Mensaje de bienvenida predeterminado
            const defaultWelcomeMessage = process.env.DEFAULT_WELCOME_MESSAGE || 
                "¡Hola! Soy tu asistente agrónomo virtual. Estoy aquí para ayudarte con consultas sobre cultivos, productos agrícolas y mejores prácticas de agricultura.";
            return defaultWelcomeMessage;
        }
    }
}

module.exports = { RAGHandler };