# AGENTS.md

Guía para agentes de IA (Claude Code, Codex, Cursor, etc.) trabajando en este
repo. Para el detalle completo de los 8 bots y la discusión de arquitectura
(monolito vs. separar módulos, n8n), ver `ARQUITECTURA_BOTS_Y_ESCALABILIDAD.md`.
Este archivo cubre lo operativo: qué es cada cosa, dónde vive, cómo desplegar.

## Qué es este proyecto

`whatsapp-docker` (`server-baileys.js`, contenedor `wpp-bot` en producción)
es el servidor Express que mantiene la(s) sesión(es) de WhatsApp (Baileys) y
sirve **8 bots**. La mayoría de la lógica conversacional vive aquí mismo,
pero dos módulos (GPSwox/plataformagps y Operatividad) fueron extraídos al
proyecto hermano `hesego-operatividad` (agosto 2026) — este repo solo
reenvía esos mensajes por webhook, no procesa su lógica en producción. Ver
`AGENTS.md` de `hesego-operatividad` (`C:\Documentos\hesego operatividad\AGENTS.md`)
para el detalle de ese servicio.

| # | Bot | Dónde vive el código en producción |
|---|-----|----|
| 1 | GPSwox/plataformagps (asignar placa, consultar ubicación) | `hesego-operatividad` (este repo solo reenvía por webhook) |
| 2 | Operatividad (vehículos no operativos, vencimientos) | `hesego-operatividad` |
| 3 | Inspección Hesego (checklist 20 ítems) | aquí: `lib/session/inspeccion-flow.js` |
| 4 | Preoperacional Hesego | aquí: `lib/session/preop-flow.js` |
| 5 | FX/MT5 (alertas de trading) | aquí: `lib/session/fx-commands.js` |
| 6 | Encuesta de Riesgo Psicosocial | aquí: endpoint `/api/encuesta-bot/enviar` |
| 7 | Notificaciones GPS genéricas | aquí: `/webhook`, `/webhook/whatsapp` |
| 8 | Auto-respuesta IA (OpenAI) | aquí: `lib/session/core.js` |

**Trampa común:** si te piden ajustar el flujo de "asignar placa a
usuario" (opción 1 del menú GPSwox), el archivo real a editar es
`lib/gpswox-session.js` en `C:\Documentos\hesego operatividad`, **no**
`lib/session/gpswox-session.js` de este repo — ese es solo un fallback que
corre únicamente si la variable `GPSWOX_WEBHOOK_URL` no está configurada en
el `.env` del servidor (en producción normal sí está configurada, apuntando
a `http://hesego-operatividad:4300`). Confirma con:
```bash
ssh -i "$SSHK" root@164.68.118.86 "grep GPSWOX_WEBHOOK_URL /root/whatsapp-api/.env"
```
Si de todos modos editas el fallback aquí, aplica el mismo cambio en ambos
archivos para que no diverjan.

**Drift conocido (oct. 2026) entre ambos archivos:** el fallback de aquí
(`lib/session/gpswox-session.js`) tiene su PROPIO selector de empresa
(distinto del menú de Rastrear descrito abajo, construido antes y nunca
portado a producción) vía `empresa-pref.js` + tabla `bot_empresa_elegida`
en la BD de **este** repo. El archivo real de producción
(`hesego-operatividad/lib/gpswox-session.js`) no usa ese mecanismo — tiene
su propio menú de Rastrear standalone (ver tabla abajo), construido
directamente ahí. No se intentó unificar los dos (nadie lo pidió
todavía) — si se toca el menú de Rastrear, el archivo real a editar es
`hesego-operatividad/lib/gpswox-session.js`, el fallback de aquí queda
weirdly adelantado en un diseño distinto que no está en uso.

## Palabras clave que activan cada bot (estado real, oct. 2026)

Todos estos triggers se evalúan en `lib/session/core.js` de **este** repo
(antes de reenviar nada a `hesego-operatividad`), excepto donde se indica
lo contrario. Case-insensitive, se compara el mensaje completo en
mayúsculas contra estas listas (configurables por variable de entorno, los
valores de abajo son los default en `config.js` si la variable no está
puesta):

| Palabra(s) | Abre | Dónde se maneja |
|---|---|---|
| `HESEGO` | Menú de administración de Hesego (asignar placa, consultar ubicación, Operatividad, lanzar Inspección/Preop desde el menú) — siempre abre/reinicia, es la palabra de entrada "desde afuera" | `hesego-operatividad/lib/gpswox-session.js` (webhook) |
| `RASTREAR` | Menú propio de Rastrear: *1* Preoperacional, *2* Consultar placa y última ubicación (misma lógica que la opción 2 de Hesego, GPSwox es genérico), *3* Consultar documentos y *4* Registrar gastos (estas dos últimas responden "próximamente, en desarrollo") — igual que HESEGO, siempre abre/reinicia desde afuera | `hesego-operatividad/lib/gpswox-session.js` (webhook) |
| `MENU`, `MENÚ` | Vuelve al tope del menú en el que ya estés (Hesego o Rastrear) — **solo si hay una conversación activa**; sin conversación (recién entraste o escribiste `SALIR`) no hace nada, se trata como palabra sin reconocer | `hesego-operatividad/lib/gpswox-session.js` (webhook) |
| `SALIR` | Termina cualquier conversación/flujo activo (Hesego, Rastrear, Preop, Inspección) y responde un mensaje neutral sin abrir ningún menú ni mencionar las palabras clave (evita invitar a probarlas todas) | `hesego-operatividad/lib/gpswox-session.js` (webhook); `preop-flow.js`/`inspeccion-flow.js` aquí reenvían "salir" ahí si hay sesión local activa |
| `RPREOP`, `PREOP RASTREAR`, `PREOPERACIONAL RASTREAR` | Acceso directo al Preoperacional de Rastrear, sin pasar por el menú (lo que la opción *1* del menú de Rastrear usa internamente vía el endpoint `/api/gpswox/session/start-preop`) | aquí: `lib/session/preop-flow.js` |
| `PREOP`, `PREOPERACIONAL` | Preoperacional de la empresa que el teléfono eligió antes (o Hesego por defecto si nunca eligió) | aquí: `lib/session/preop-flow.js` (`tenantFromTrigger` → `'auto'` → `empresa-pref.js`) |
| `PREOP HESEGO`, `PREOPERACIONAL HESEGO` | Preoperacional de Hesego explícito | aquí: `lib/session/preop-flow.js` |
| `INSPECCION`, `INSPECCIONAR`, `INSPECCIÓN` | Checklist de Inspección (20 ítems) | aquí: `lib/session/inspeccion-flow.js` |
| `fx`, `/fx`, `!fx`, `posiciones`, `balance`, `estado`, `trading`, `mt5` (+ lo que sigue, libre) | Asistente de trading (DeepSeek) | aquí: `lib/session/fx-commands.js` → reenvía a `mt5-dashboard-fxpro` |
| `CANCELAR` | Aborta el flujo de Preoperacional/Inspección en curso (se queda donde estaba, a diferencia de SALIR que termina todo) | dentro de cada flujo |
| Cualquier otra palabra, sin conversación activa, en la sesión dedicada GPSwox | Aviso de "bot de notificaciones, escribe el nombre de la empresa o la palabra de acceso" (nunca nombra las palabras) — al 3er intento fallido seguido, bloqueo de 10 min (avisa cuánto falta si escribe de nuevo) | `hesego-operatividad/lib/gpswox-session.js` (webhook) |

**`TURNO`/`TURNOS` NO está en esta tabla a propósito** — es el único trigger
que NO llega por la sesión dedicada de Baileys (GPSwox). Los conductores le
escriben al número de la **WhatsApp Cloud API** (el mismo que `turnos_co`
usa para mandar la plantilla aprobada `turno_descargue`), que entra por
`POST /webhook`/`/webhook/whatsapp` → `lib/session/webhook.js` →
`processIncomingMessage()` — nada que ver con `core.js`/Baileys. Ahí
responde con un botón real (`cta_url` vía Cloud API,
`cloudApi.sendInteractiveMessage`) en vez de texto plano con el link;
funciona sin plantilla aprobada porque el usuario ya escribió primero
(ventana de servicio de 24h). **Trampa ya cometida (oct. 2026):** se puso
primero en `core.js` junto a HESEGO/RASTREAR porque parecía "un trigger
más" — nunca se disparaba en producción porque esos mensajes jamás pasan
por Baileys. Si se toca TURNOS, el archivo real es `webhook.js`.

**Puente hesego-operatividad → whatsapp-docker para flujos que solo viven
aquí**: cuando el menú de Hesego u Rastrear necesita arrancar Inspección o
Preoperacional (que son módulos de este repo, no de hesego-operatividad),
`hesego-operatividad/lib/whatsappSender.js` llama de vuelta a un endpoint
interno de aquí (`startInspection` → `POST /api/gpswox/session/start-inspection`,
`startPreopRastrear` → `POST /api/gpswox/session/start-preop`), con el
mismo secreto compartido (`GPSWOX_WEBHOOK_SHARED_SECRET`) que usa el
webhook en la otra dirección.

**Bots que NO se activan por palabra clave** (corren por canal propio, no
por texto en WhatsApp): Notificaciones GPS genéricas (bot #7, llegan por
`/webhook`/`/webhook/whatsapp` desde GPSwox, no las escribe un humano),
Encuesta de Riesgo Psicosocial (bot #6, se dispara desde
`/api/encuesta-bot/enviar`, no por palabra del usuario), Auto-respuesta IA
(bot #8, responde a cualquier mensaje de un número en
`AI_AUTO_RESPONSE_NUMBERS` que no haya matcheado ningún trigger de arriba).

## Panel `webhook-viewer.html` (Centro de Mensajes)

`public/webhook-viewer.html` — página standalone, sin login, servida
estática (montada como volumen: `./public:/app/public` en
`docker-compose.yml`, así que **no necesita rebuild**, solo copiar el
archivo). Es la URL que se comparte para ver mensajes desde el celular:
`https://api.rastrear.com.co/webhook-viewer.html` (nginx + Certbot en el
host hacen proxy_pass de ese dominio directo a `127.0.0.1:3010`, así que
también sirve este panel — va por HTTPS, sin exponer la IP). La variante
directa `http://164.68.118.86:3010/webhook-viewer.html` también funciona
(el puerto 80 de `rastrear.com.co` sin el subdominio `api.` no la sirve,
ojo con esa diferencia).

Pestañas: **Recibidos** (`/api/webhook/messages`, tabla `webhook_messages`),
**Enviados** (`/api/monitor/messages`, tabla `messages`), **Conversación**
(busca por número y arma el hilo cronológico completo — usa
`GET /api/conversation/:phoneNumber`, que en `database-postgres.js` hace un
`UNION` entre `messages` WHERE `phone_number` y `webhook_messages` WHERE
`from_number`), y **Estadísticas** (mensajes de hoy/30 días + top 10
números, reutilizando el endpoint ya existente `/api/analytics/messages`
que alimenta también el "Analytics Dashboard" del admin en `index.html`).
Los números en cualquier lista son clickeables y abren directo su
conversación.

**Ojo de seguridad:** esta página no tiene autenticación — cualquiera con la
URL y el puerto ve contenido de mensajes reales (números, alertas GPS,
etc.). Está así a propósito por ahora (decisión del cliente), pero si algún
día se pide protegerla, lo más simple es un middleware de basic auth en
Express solo para esa ruta estática, no cambiar el resto del sitio.

## Notificaciones GPS genéricas (bot #7) — plantilla `alerta_vehiculo`

Código: `lib/session/whatsapp-cloud-api.js`. Recibe el texto nativo de
GPSwox ("hola EMPRESA te informa una alerta en su vehiculo *PLACA* ha
presentado *EVENTO* velocidad: (N kph) en la siguiente ubicacion: ... Hora:
...") vía `parseAlertMessage()`, y lo reenvía usando la plantilla de WhatsApp
Business (Meta) `alerta_vehiculo` (`es_CO`, categoría Utilidad, variables con
nombre: `empresa`, `vehiculo`, `evento`, `ubicacion`, `hora` — ver
`sendAlertTemplate()`).

**Bugs reales encontrados y corregidos (sept. 2026):**
- La ubicación llegaba truncada a la primera palabra ("Ubicación: Vía" y
  nada más) porque el regex que la extraía usaba `[^\s]+` (para en el primer
  espacio) en vez de capturar hasta el siguiente `Hora:`/`Fecha:`/`Time:`.
  Corregido en ambos branches de parseo nativo de GPSwox (con y sin
  asteriscos).
- La velocidad no se mostraba en absoluto. Como la plantilla aprobada por
  Meta **no tiene variable propia para velocidad** (agregar una requiere
  editar la plantilla en WhatsApp Manager y esperar re-aprobación de Meta,
  no algo que se pueda hacer solo con un cambio de código), se agrega como
  sufijo de la variable `evento` vía `appendVelocidad()`:
  `"Entro en (darien) · 42 kph"`.

**Pendiente (sept. 2026):** se está agregando una línea de Velocidad propia
y un botón de "Ver ubicación" (URL dinámica a
`https://www.google.com/maps/search/?api=1&query=<ubicacion>`) editando la
plantilla `alerta_vehiculo` existente en WhatsApp Manager (mismo nombre/ID
`872044595562007`, no una plantilla `_v2` nueva — se intentó ese camino
primero pero no llegó a crearse). Cuando Meta apruebe la edición, hay que
actualizar `sendAlertTemplate()` en `whatsapp-cloud-api.js` para mandar los
parámetros nuevos en el orden exacto que quede aprobado (y quitar el
workaround de `appendVelocidad` si la velocidad ya tiene su propia
variable). Verificar el estado en WhatsApp Manager → Administrar plantillas.

## Desplegar un cambio a producción

Este proyecto sí tiene script de deploy: `deploy-gpswox.ps1` (PowerShell).
Copia los archivos listados dentro del script, actualiza variables GPSwox en
el `.env` remoto si faltan, reconstruye la imagen (`docker compose build`) y
recrea el contenedor (`docker compose up -d`) — un simple `restart` NO
aplica cambios de código porque el Dockerfile hace `COPY . .` sin volumen.

```powershell
.\deploy-gpswox.ps1              # deploy completo
.\deploy-gpswox.ps1 -SkipRestart # solo copiar archivos, sin rebuild
.\deploy-gpswox.ps1 -OnlyDocs    # solo la documentación
```

Si necesitas copiar un archivo puntual sin el script completo (equivalente
en Git Bash):
```bash
SSHK="/c/Users/guiog/.ssh/id_rsa"
scp -i "$SSHK" lib/session/core.js root@164.68.118.86:/root/whatsapp-api/lib/session/
ssh -i "$SSHK" root@164.68.118.86 "cd /root/whatsapp-api && docker compose build wpp-bot && docker compose up -d wpp-bot"
```

**Ojo con el tiempo de build de `wpp-bot` específicamente:** su Dockerfile
instala Chromium y ~200 paquetes de sistema (`apt-get install`) antes de
`npm install` — la primera vez (sin cache de capas) tarda 5-8 minutos en
total. Si la conexión SSH se corta a mitad del build (pasó en la práctica:
`Connection reset by peer`), el `docker compose build` remoto se mata junto
con la sesión y el `&& docker compose up -d` nunca llega a correr — el
contenedor sigue con la imagen vieja sin ningún aviso de error visible en el
lado del cliente. Para builds largos, lanzarlo desacoplado de la sesión SSH:
```bash
ssh -i "$SSHK" root@164.68.118.86 "cd /root/whatsapp-api && rm -f /root/deploy_wpp.log && nohup bash -c 'docker compose build wpp-bot && docker compose up -d wpp-bot' > /root/deploy_wpp.log 2>&1 < /dev/null & disown; sleep 1; echo LAUNCHED"
```
y verificar el progreso con conexiones SSH nuevas y cortas (`tail
/root/deploy_wpp.log`, `docker images`, `docker inspect wpp-bot --format
'{{.Created}}'`) en vez de mantener una sola conexión larga abierta.
`hesego-operatividad` (imagen más liviana, sin Chromium) no tiene este
problema — su build tarda ~1 minuto.

## Acceso SSH a la VPS

- Servidor: `root@164.68.118.86` (Contabo, hostname `vmi291164.contaboserver.net`)
- Llave para este servidor: `C:\Users\guiog\.ssh\id_rsa_rastrear_164_68_118_86`
  (la llave genérica `C:\Users\guiog\.ssh\id_rsa` que usa `deploy-gpswox.ps1`
  también funciona aquí — este servidor acepta ambas; hay otras llaves
  `id_rsa_rastrear_*` en esa carpeta para *otros* servidores del cliente, no
  confundir)
- Directorio remoto de este proyecto: `/root/whatsapp-api` (compose project
  `whatsapp-api`, contenedor `wpp-bot`) — **no** `/root/whatsapp-docker`, que
  es una copia vieja abandonada sin efecto en producción (ver comentario en
  `deploy-gpswox.ps1`)
- El servidor aloja decenas de proyectos de este cliente además de estos
  bots (`docker ps` para verlos todos) — verificar siempre con
  `docker inspect <contenedor> --format '{{json .Config.Labels}}'` a qué
  `docker-compose.yml`/directorio pertenece un contenedor antes de asumirlo,
  sobre todo con nombres parecidos (`hesego-operatividad`,
  `hesego-preoperacional`, `hesego-inspecciones`, `logisticahesego` son
  todos proyectos distintos).

## Mapa de proyectos hermanos (local ↔ servidor)

Los backends web de Inspección/Preoperacional/Riesgo Psicosocial/FX **no**
están en este repo ni en `hesego-operatividad` — son proyectos aparte que
`whatsapp-docker`/`hesego-operatividad` consumen por HTTP o que les mandan
webhooks. Mapa confirmado con `docker inspect --format '{{json .Config.Labels}}'`
en septiembre 2026 (verificar de nuevo si algo no cuadra, el servidor tiene
decenas de proyectos y las cosas se mueven):

| Carpeta local (Windows) | Contenedor(es) | Compose project / ruta remota |
|---|---|---|
| `C:\Documentos\whatsapp docker` | `wpp-bot` | `whatsapp-api` → `/root/whatsapp-api` |
| `C:\Documentos\hesego operatividad` | `hesego-operatividad` | `hesego-operatividad` → `/root/hesego-operatividad` |
| `C:\Documentos\Hesego preoperacional\hesego-preoperacional` | `preop-backend`, `preop-frontend`, `preop-db` | `hesego-preoperacional` → `/root/hesego-preoperacional` |
| `C:\Documentos\Hesego preoperacional\hesego-inspecciones` | `insp-backend`, `insp-frontend`, `insp-db` | `hesego-inspecciones` → `/root/hesego-inspecciones` |
| `C:\Documentos\Hesego preoperacional\hesego-usuarios` | `usr-backend`, `usr-db` | portal SSO unificado (no confirmado el nombre exacto del compose project) |
| `C:\Documentos\Hesego preoperacional\hesego-landing` | `hesego-landing` (nginx) | `/root/hesego-landing` |
| `C:\Documentos\Riesgo psicosocial\app` | `psico-backend`, `psico-frontend`, `psico-db` | `riesgo-psicosocial` → `/root/riesgo-psicosocial` |
| `C:\Documentos\Fx` | `mt5-dashboard-fxpro` | `mt5-fxpro` → `/opt/mt5-fxpro` (nota: `/opt`, no `/root`, distinto a los demás) |

`hesego-preoperacional`, `hesego-inspecciones`, `hesego-landing` y
`hesego-usuarios` viven todos en el mismo repo git "paraguas"
(`C:\Documentos\Hesego preoperacional`, un solo `.git` con las 4 carpetas
como subdirectorios) — no son 4 repos separados aunque tengan 4
`docker-compose.yml` distintos en el servidor.

**Llamadas entre contenedores hermanos: usar red interna de Docker, nunca
el dominio público.** Bug real (oct. 2026): `insp-backend` avisaba a
`wpp-bot` de las fotos del vehículo llamando a `https://api.rastrear.com.co`
(el dominio público) en vez de al contenedor por su nombre — cuando el DNS
externo tuvo cortes transitorios (`EAI_AGAIN`, confirmado 2026-09-29 y
2026-10-12), la inspección se quedaba "colgada" después de las fotos, y
como la alerta a administradores usaba la misma URL rota, tampoco avisaba
del fallo. Corregido uniendo `insp-backend` a la red
`whatsapp-api_whatsapp-network` y usando `http://wpp-bot:3010` (mismo
patrón ya usado para `mt5-dashboard-fxpro` ↔ `wpp-bot`). Si se agrega otra
llamada HTTP entre proyectos hermanos que viven en el mismo servidor,
preferir siempre `docker network connect` + nombre de contenedor sobre un
dominio público, aunque exista.

## Git

Repo con remoto en GitHub: `https://github.com/guiogonza/whatsapp.git`,
rama `main`. Antes de `git push`, hacer `git fetch` — es común que haya
commits remotos hechos desde otra máquina/sesión que no están en local.
