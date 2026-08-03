# 📋 Bot de Encuesta de Riesgo Psicosocial

Módulo que permite diligenciar por WhatsApp (Cloud API, con botones/listas) la encuesta del
proyecto **Riesgo Psicosocial**. El estado real de la encuesta (consentimiento, respuestas,
resultados) vive en el backend de ese proyecto — este módulo solo conversa con el usuario y
llama a esa API.

## Restricción importante de Meta

Un negocio **no puede iniciar** una conversación con texto libre ni con botones/listas: la
primera vez hay que enviar un **template pre-aprobado por Meta**. Recién cuando el usuario
responde algo se abre una ventana de 24h en la que sí se pueden enviar mensajes interactivos
libremente.

Por eso el flujo es:

1. El backend de Riesgo Psicosocial llama a `POST /api/encuesta-bot/enviar` cuando el admin
   habilita una encuesta con teléfono registrado.
2. Este módulo envía el template configurado en `ENCUESTA_PSICOSOCIAL_TEMPLATE_NAME` (mientras
   no exista uno propio aprobado, usar `hello_world`/`en_US`, el de prueba de Meta).
3. Cuando el empleado responde cualquier cosa, se abre la ventana de 24h y el bot manda el
   mensaje de consentimiento con botones (Acepto / No acepto).
4. Luego las preguntas de filtro (gates) con botones Sí/No, y cada ítem de la encuesta como
   lista de 5 opciones (Nunca…Siempre).
5. Al terminar, llama a `/completar` en el backend y avisa al usuario.

**Pendiente:** crear y aprobar en Meta Business Manager un template propio (ej.
`encuesta_invitacion`) con el texto de invitación a la encuesta, y actualizar
`ENCUESTA_PSICOSOCIAL_TEMPLATE_NAME`/`ENCUESTA_PSICOSOCIAL_TEMPLATE_LANGUAGE` en `.env`.

**Pendiente:** la Ficha de Datos Generales (16 campos sociodemográficos) no está incluida en
este bot todavía — hoy solo se completa desde el link web.

## Configuración

```bash
# .env
ENCUESTA_PSICOSOCIAL_API_URL=https://tu-backend-riesgo-psicosocial/api
ENCUESTA_PSICOSOCIAL_TEMPLATE_NAME=hello_world
ENCUESTA_PSICOSOCIAL_TEMPLATE_LANGUAGE=en_US
```

## Archivos

```
lib/session/encuesta-bot/
├── templates.js       # Construcción de mensajes interactivos (botones/listas)
├── backendClient.js   # Cliente HTTP hacia la API de Riesgo Psicosocial
├── sesiones.js        # Mapeo teléfono -> token de encuesta activa (Postgres)
└── flow.js            # Máquina de estados: qué preguntar a continuación

server-baileys.js      # POST /api/encuesta-bot/enviar (trigger)
lib/session/webhook.js # Enruta respuestas interactivas entrantes al flow
```

## Endpoints

```bash
# Disparar la invitación (llamado por el backend de Riesgo Psicosocial)
POST /api/encuesta-bot/enviar
{ "telefono": "573001234567", "token": "uuid-de-la-asignacion" }
```

## Aislamiento de otros módulos

`webhook.js` solo delega un mensaje entrante a este bot si el teléfono tiene una sesión activa
en `encuesta_bot_sesiones` (creada al disparar la invitación). Si no la tiene, el mensaje sigue
disponible para los demás manejadores (GPSwox, FX, auto-respuesta) sin interferencia.
