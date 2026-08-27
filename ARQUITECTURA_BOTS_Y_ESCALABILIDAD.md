# Arquitectura de bots WhatsApp — estado actual y propuesta de escalabilidad

**Fecha:** 19 de agosto de 2026

## Bots que funcionan actualmente

| # | Bot | Qué hace | Dónde vive |
|---|-----|----------|------------|
| 1 | **GPSwox / plataformagps** | Registro de usuarios y asignación de placas, consulta de ubicación por placa | WhatsApp en `whatsapp-docker`, lógica conversacional en `hesego-operatividad` |
| 2 | **Operatividad** | Seguimiento diario de vehículos no operativos + vencimientos de documentos, recordatorios automáticos 8am/9am | `hesego-operatividad` |
| 3 | **Inspección Hesego** | Checklist de 20 ítems de inspección vehicular | `whatsapp-docker` (`lib/session/inspeccion-flow.js`) |
| 4 | **Preoperacional Hesego** | Checklist preoperacional, consume el backend en `preoperacional.logisticahesego.com` | `whatsapp-docker` (`lib/session/preop-flow.js`) |
| 5 | **FX/MT5** | Alertas de trading (posiciones, cuentas, notificaciones) reenviadas por WhatsApp desde un webhook de MetaTrader5 | `whatsapp-docker` |
| 6 | **Encuesta de Riesgo Psicosocial** | Envío de encuestas vía plantilla de Meta/WhatsApp Cloud API | `whatsapp-docker` |
| 7 | **Notificaciones GPS genéricas** | Alertas de la plataforma GPS (entradas/salidas de geocercas) vía Cloud API o sesión Baileys directa | `whatsapp-docker` |
| 8 | **Auto-respuesta IA** | Respuesta automática por IA para números específicos configurados | `whatsapp-docker` |

## ¿Es un monolito?

Sí. `whatsapp-docker` (`server-baileys.js`, ~3200 líneas) es un único servidor Express que sirve los ocho bots de arriba, todos compartiendo:
- El motor de sesiones de Baileys (`lib/session/core.js`, `messaging.js`, `rotation.js`, `queue.js`, `proxy.js`)
- Un solo Postgres compartido con tablas de todos los módulos
- Un solo proceso Node — si un módulo crashea, se cae todo

El 19 de agosto de 2026 se extrajo el primer módulo (**Operatividad**) a un proyecto independiente (`hesego-operatividad`), comunicándose con el monolito por HTTP/webhook en vez de compartir proceso. Ver `CLAUDE.md` / memoria del proyecto para el detalle de esa migración.

## ¿n8n para reemplazar esto?

**No se recomienda** como reemplazo del núcleo. n8n brilla orquestando llamadas entre servicios ya expuestos por HTTP, pero el corazón real de este sistema —la sesión de Baileys, el estado conversacional por teléfono, la lógica de reintentos/rotación de sesiones— necesita código con estado persistente en memoria y control fino sobre sockets de WebSocket. Forzar eso a un flujo visual de n8n sería forzar un pipeline de pasos sobre algo que en realidad es un servidor con estado continuo.

**Dónde sí encaja n8n** (o una herramienta similar más ligera): como capa de *orquestación externa* — recibiendo los webhooks salientes que cada bot ya expone (`/webhook/incoming`, Cloud API, webhook de MT5) para alertas, reintentos cross-sistema o reportes. No para implementar el bot en sí.

## Propuesta de mejoras, en orden de impacto/esfuerzo

1. **Monitoreo de caídas real.** Ya hay Uptime Kuma corriendo en el VPS (164.68.118.86) — agregarle un check HTTP a cada endpoint `/health` (`wpp-bot`, `hesego-operatividad`, `preop-backend`, `insp-backend`) con alerta a WhatsApp/Telegram. Hoy, si un bot crashea, nadie se entera hasta que un usuario se queja — así se descubrió el crash-loop de `fx-commands.js` durante el despliegue de hoy.

2. **Seguir separando módulos**, como se hizo con Operatividad. Cada extracción reduce el "blast radius" de un bug y permite desplegar/reiniciar un bot sin afectar a los demás. Candidatos naturales siguientes: Inspección y Preoperacional (ya tienen sus propios backends desplegados aparte, solo falta separar la parte conversacional de WhatsApp).

3. **CI mínimo antes de cada deploy.** Un `node --check` sobre los archivos modificados + un smoke test (arrancar el proceso y pegarle a `/health`) habría atrapado el módulo faltante (`fx-commands.js`) de hoy sin necesidad de un despliegue fallido en producción.

4. **Externalizar secretos.** Hay credenciales hardcodeadas en el código fuente (hash de API de GPSwox en `config.js`, usuario/clave del login de Operatividad en `server-baileys.js`) que no dependen de `.env`. Vale la pena migrarlas a variables de entorno reales y rotarlas.

5. **Un `.env.example` fiel al `.env` real.** El actual está incompleto (le faltan `DATABASE_URL`, `GPSWOX_*`, `OPERATIONAL_AUTH_SECRET`, `INSP_*`, entre otros) — dificulta levantar el proyecto desde cero o auditar qué variables existen.
