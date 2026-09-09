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

## Git

Repo con remoto en GitHub: `https://github.com/guiogonza/whatsapp.git`,
rama `main`. Antes de `git push`, hacer `git fetch` — es común que haya
commits remotos hechos desde otra máquina/sesión que no están en local.
