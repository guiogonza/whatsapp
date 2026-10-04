# geo.apptu.net — Alertas de geozonas "control"

Página web para administrar quién recibe por WhatsApp las alertas de geozonas cuyo nombre empieza por **"control"**, y para ver cuántos mensajes se han enviado.

- **URL:** https://geo.apptu.net
- **Servidor:** 164.68.118.86 (contenedor `wpp-bot`, puerto 3010, detrás de nginx)
- **Código:** este repositorio (`lib/alertForwarder.js`, `lib/geoAuth.js`, `public/geo.html` y las rutas en `server-baileys.js`)

## Cómo funciona

```
Plataforma GPS ──GET /?to=NUMERO&message=...──►  wpp-bot (server-baileys.js)
                 o POST /api/messages/send            │
                                                      ├─ 1. Envía la alerta al destino original (Cloud API, plantilla alerta_vehiculo)
                                                      │
                                                      └─ 2. forwardControlAlert():
                                                            · lee placa y evento del mensaje (parseAlertMessage)
                                                            · ¿la geozona empieza por "control"?  no → termina
                                                            · busca las personas asignadas a la placa
                                                            · reenvía el mismo mensaje a cada una (2 s entre envíos)
                                                            · registra cada envío (fecha, placa, persona, número, estado)
```

Ejemplo de alerta que se reenvía (geozona `control darien`):

```
🚨 Alerta de RASTREAR - GPS

🚗 Vehículo: CQU92F
⚠️ Evento: Salio de (control darien) · 49 kph
📍 Ubicación: ...
🕐 Hora: 03-10-2026 14:43:07 hrs
```

**Regla del filtro:** el nombre de la geozona va entre paréntesis dentro del evento y debe empezar por `control` (sin importar mayúsculas): `(control darien)` sí; `(darien)` o `(bodega)` no.

**Reglas del reenvío**

- Una misma alerta (placa + evento + hora) se reenvía **una sola vez** durante 10 minutos, aunque la plataforma la mande a varios destinos.
- A quien ya recibió la alerta como destino original no se le reenvía de nuevo.
- Si la placa no tiene personas asignadas, no se envía nada y queda una línea en el log del bot.
- El reenvío usa el mismo canal que el bot (`sendMessageHybrid`: Cloud API con la plantilla aprobada de Meta). Un fallo al enviar a una persona no detiene a las demás.

## La página

Tres pestañas, con login propio:

| Pestaña | Qué hace |
|---|---|
| **Placas y personas** | Alta, edición y borrado de personas por placa. Buscador. Carga masiva con Excel y plantilla descargable. |
| **Mensajes enviados** | Tabla ordenable (clic en el encabezado) con fecha y hora, placa, persona, WhatsApp, evento y estado. Incluye el envío al destino original (sin nombre). Buscador. |
| **Estadísticas** | Total, hoy, este mes y fallidos; placas y números con más envíos; mensajes por día (14 días) y por mes (12 meses). |

Las fechas se muestran en hora de Colombia (`America/Bogota`).

### Teléfonos

- El usuario escribe **solo 10 dígitos** y deben empezar por 3 (ej. `3196319531`).
- El **indicativo 57 lo maneja únicamente el servidor**: se guarda como `573196319531`, pero la API y la página siempre muestran los 10 dígitos.
- La validación se hace **siempre en el servidor** (la del navegador es solo ayuda). Un número de 12 dígitos, con `57` o con menos de 10 dígitos se rechaza. Se ignoran espacios, guiones y paréntesis.

### Carga masiva con Excel

1. Botón **Descargar plantilla** (`plantilla_placas_personas.xlsx`, con hoja de instrucciones).
2. Columnas: `Placa`, `Nombre`, `WhatsApp`. Una fila por persona; una placa puede repetirse.
3. Botón **Cargar Excel** (`.xlsx`, `.xls` o `.csv`). Se envía en lotes de 200 filas.
4. Resultado: cuántos se agregaron, cuántos repetidos se omitieron, y la lista de filas con error (con el número de fila del Excel). Las filas inválidas no se guardan; las válidas sí.

Placa válida: 5 a 8 letras o números.

## Sesión y seguridad

- Login propio (usuario y clave en el `.env`, ver abajo). Cookie `geo_session`: `HttpOnly`, `Secure`, `SameSite=Strict`.
- **Se cierra sola a los 5 minutos sin actividad** (mouse, teclado, clic, scroll o toque). El servidor además vence la sesión a los 7 minutos sin peticiones.
- Botón **Cerrar sesión**.
- Tras 5 intentos fallidos desde la misma IP, se bloquea el login 10 minutos.
- Las sesiones viven **en memoria**: al reiniciar el bot hay que iniciar sesión de nuevo.
- nginx solo expone `/` (la página), `/api/alert-vehicles*` y `/api/geo-auth*`. El resto del bot (panel, sesiones, envío de mensajes) devuelve 404 en este dominio.

## API

Todas las rutas de `/api/alert-vehicles` exigen sesión (si no, `401`).

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/geo-auth/login` | `{username, password}` → crea la sesión |
| POST | `/api/geo-auth/logout` | Cierra la sesión |
| GET | `/api/geo-auth/me` | `200` si la sesión sigue activa (y la renueva) |
| GET | `/api/alert-vehicles` | Lista de placas y personas |
| POST | `/api/alert-vehicles` | `{plate, name, whatsapp}` → crea un registro |
| PUT | `/api/alert-vehicles/:id` | Edita un registro |
| DELETE | `/api/alert-vehicles/:id` | Elimina un registro |
| POST | `/api/alert-vehicles/bulk` | `{rows: [{plate, name, whatsapp}]}` (máx. 500) → `{created, duplicates, errors:[{row, error}]}` |
| GET | `/api/alert-vehicles/log` | Registro de envíos (hasta los últimos 20.000) |

## Configuración (`.env`, no se versiona)

| Variable | Uso |
|---|---|
| `GEO_USER` | Usuario del login de geo.apptu.net |
| `GEO_PASS` | Contraseña del login de geo.apptu.net |

Para cambiar la contraseña: editar el `.env` del servidor y ejecutar `docker compose up -d --no-deps wpp-bot`.

## Datos

Carpeta `data/alert-vehicles/` (volumen montado, no se versiona, sobrevive a reinicios y reconstrucciones):

- `alert-vehicles.json` — placas y personas (con el 57 incluido).
- `sent-log.jsonl` — un registro por envío, una línea JSON cada uno.

La carpeta debe ser escribible por el usuario `node` del contenedor (uid 1000): `chown 1000:1000 data/alert-vehicles`.

## Infraestructura

- **DNS:** registro `A` `geo.apptu.net → 164.68.118.86`.
- **nginx:** `/etc/nginx/sites-available/geo.apptu.net` (copia en [`deploy/nginx/geo.apptu.net.conf`](deploy/nginx/geo.apptu.net.conf)). El puerto 80 redirige a HTTPS.
- **SSL:** Let's Encrypt, certificado `geo.apptu.net` (webroot `/var/www/html`). La renovación la hace `certbot.service`/`certbot.timer`, que ya incluye `PYTHONPATH=/usr/lib/python3/dist-packages`. Si se ejecuta `certbot` a mano falla por un `cryptography` instalado con pip en `/usr/local`; usar `PYTHONPATH=/usr/lib/python3/dist-packages certbot ...`.
- **Contenedor:** el código va dentro de la imagen; solo `public/`, `data/` y `whatsapp-sessions/` están montados. Cambios en `lib/` o `server-baileys.js` requieren reconstruir.

```bash
cd /root/whatsapp-api
docker compose build wpp-bot
docker compose up -d --no-deps wpp-bot   # reinicia el bot ~30 s
```

Los cambios en `public/geo.html` se ven con solo copiar el archivo (carpeta montada).

## Probar el reenvío

Registrar una placa con celulares de prueba en la página y simular la entrada de la alerta desde el servidor:

```bash
MSG=$(printf "🚨 Alerta de RASTREAR - GPS\n\n🚗 Vehículo: CQU92F\n⚠️ Evento: Salio de (control darien) · 49 kph\n📍 Ubicación: Yotoco, Valle del Cauca\n🕐 Hora: 03-10-2026 14:43:07 hrs")
curl -s -G "http://127.0.0.1:3010/" --data-urlencode "to=57XXXXXXXXXX" --data-urlencode "message=$MSG"
docker logs --since 30s wpp-bot | grep -E "CLOUD API|📍➡️"
```

⚠️ Esto envía WhatsApp reales a los números asignados. Cambiar `(control darien)` por `(darien)` para comprobar que **no** se reenvía.

## Limitaciones conocidas

- Si el canal es la Cloud API de Meta, fuera de la ventana de 24 h solo se pueden enviar plantillas aprobadas; por eso el reenvío usa la plantilla `alerta_vehiculo`. El estado "Enviado" significa que Meta aceptó el mensaje, no que el teléfono lo recibió.
- Las sesiones del login están en memoria (se pierden al reiniciar).
- El registro de envíos empezó a guardarse el 2026-10-04; no incluye envíos anteriores.
