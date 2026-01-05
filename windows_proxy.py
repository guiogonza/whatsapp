import os
import logging
import time
from urllib.parse import urljoin, unquote_plus

import requests
from requests.adapters import HTTPAdapter
from flask import Flask, request, Response, jsonify

app = Flask(__name__)
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s: %(message)s')
logger = logging.getLogger("windows-proxy")

# Silenciar el logging informativo de Werkzeug para evitar líneas como
# "GET /?to=...&message=... HTTP/1.1 200 -" repetitivas
logging.getLogger("werkzeug").setLevel(logging.WARNING)

# Backend destino (por defecto el servicio estable en 3010)
BACKEND_URL = os.environ.get("BACKEND_URL", "http://164.68.118.86:3010")
TIMEOUT = (5, 20)  # (connect, read) segundos

session = requests.Session()
# Aumentar el pool de conexiones para evitar warnings y mejorar rendimiento bajo carga
POOL_CONNECTIONS = 50
POOL_MAXSIZE = 100
adapter = HTTPAdapter(pool_connections=POOL_CONNECTIONS, pool_maxsize=POOL_MAXSIZE, max_retries=0)
session.mount('http://', adapter)
session.mount('https://', adapter)

HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


def _clean_headers(in_headers):
    # Copia headers entrantes excluyendo los hop-by-hop y Host
    out = {}
    for k, v in in_headers.items():
        kl = k.lower()
        if kl == "host" or kl in HOP_BY_HOP_HEADERS:
            continue
        out[k] = v
    return out


def _proxy_to_backend(path=""):
    method = request.method
    target = urljoin(BACKEND_URL.rstrip("/") + "/", path)

    headers = _clean_headers(request.headers)
    params = request.args.to_dict(flat=True)

    def _sanitize(val: str) -> str:
        if val is None:
            return ""
        # Decodificar percent-encoding y normalizar saltos de línea a una marca
        s = unquote_plus(str(val))
        s = s.replace("\r\n", "\n").replace("\r", "\n").replace("\n", " ⏎ ")
        # Compactar espacios
        return " ".join(s.split())

    # Preparar resumen legible de parámetros comunes
    pretty_to = _sanitize(params.get("to")) if "to" in params else ""
    pretty_msg_full = _sanitize(params.get("message")) if "message" in params else ""
    pretty_msg = (pretty_msg_full[:200] + "…") if len(pretty_msg_full) > 200 else pretty_msg_full
    client_ip = request.headers.get("X-Forwarded-For", request.remote_addr)
    start_t = time.perf_counter()

    # Elegir cuerpo: JSON si es válido, sino raw data; manejar archivos
    json_payload = request.get_json(silent=True)
    data_payload = None if json_payload is not None else request.get_data()

    files = None
    if request.files:
        files = {}
        for name, f in request.files.items():
            files[name] = (f.filename, f.stream, f.content_type)

    # Transformación: si llega un GET con ?to= y ?message= desde Windows,
    # convertirlo en POST JSON hacia las rutas del backend para que se registren.
    try:
        def _as_bool(val, default=True):
            if val is None:
                return default
            s = str(val).strip().lower()
            return s in {"1", "true", "yes", "y"}

        if method == "GET" and (params.get("to") and params.get("message")):
            phone = params.get("to")
            msg = params.get("message")
            session_name = params.get("session") or params.get("sessionName")
            immediate = _as_bool(params.get("immediate"), True)

            if session_name:
                # Enviar desde una sesión específica
                path = "api/session/send-message"
                target = urljoin(BACKEND_URL.rstrip("/") + "/", path)
                method = "POST"
                json_payload = {
                    "sessionName": session_name,
                    "phoneNumber": phone,
                    "message": msg
                }
                data_payload = None
            else:
                # Envío normal (rotación/balanceo)
                path = "api/messages/send"
                target = urljoin(BACKEND_URL.rstrip("/") + "/", path)
                method = "POST"
                json_payload = {
                    "phoneNumber": phone,
                    "message": msg,
                    "immediate": immediate
                }
                data_payload = None

            logger.info(
                f"TRANSFORM GET -> POST path={path} to={_sanitize(phone)} immediate={immediate}"
            )
    except Exception as e:
        logger.error(f"Error preparando transformación GET->POST: {e}")

    logger.info(
        f"REQ ip={client_ip} {method} {request.path} "
        f"to={pretty_to if pretty_to else '-'} "
        f"message=\"{pretty_msg if pretty_msg else '-'}\" -> {target}"
    )
    def _do_request():
        return session.request(
            method=method,
            url=target,
            headers=headers,
            params=params,
            data=data_payload,
            json=json_payload,
            files=files,
            timeout=TIMEOUT,
            allow_redirects=False,
        )

    try:
        resp = _do_request()
        # Reintento simple para errores transitorios del backend
        if resp.status_code in (502, 503):
            time.sleep(0.5)
            resp = _do_request()
    except requests.RequestException as e:
        logger.error(f"Error al contactar backend: {e}")
        return jsonify({"ok": False, "error": str(e)}), 502

    # Preparar respuesta
    out_headers = [(k, v) for k, v in resp.headers.items() if k.lower() not in HOP_BY_HOP_HEADERS]

    # Añadir CORS básico
    out_headers.append(("Access-Control-Allow-Origin", "*"))
    out_headers.append(("Access-Control-Allow-Headers", "*"))
    out_headers.append(("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS"))

    dt_ms = (time.perf_counter() - start_t) * 1000.0
    try:
        size = len(resp.content) if resp.content is not None else 0
    except Exception:
        size = 0
    # Fallback: si no hay sesiones activas, reenviar como mensaje en cola (immediate=false)
    try:
        if resp.status_code >= 400:
            ct = resp.headers.get('content-type', '')
            payload = None
            if 'application/json' in ct:
                payload = resp.json()
            if isinstance(payload, dict):
                err = str(payload.get('error', '')).lower()
                if 'no hay sesiones activas' in err:
                    # Reconstruir datos del mensaje
                    phone = None
                    msg = None
                    sess_name = None
                    # Priorizar json_payload
                    if isinstance(json_payload, dict):
                        phone = json_payload.get('phoneNumber') or json_payload.get('to')
                        msg = json_payload.get('message')
                        sess_name = json_payload.get('sessionName') or json_payload.get('session')
                    # Si no, usar query params
                    phone = phone or params.get('phoneNumber') or params.get('to')
                    msg = msg or params.get('message')
                    sess_name = sess_name or params.get('session') or params.get('sessionName')

                    if phone and msg and not sess_name:
                        logger.warning('Fallback: reenviando a cola immediate=false por falta de sesiones activas')
                        method = 'POST'
                        path = 'api/messages/send'
                        target = urljoin(BACKEND_URL.rstrip('/') + '/', path)
                        json_payload = { 'phoneNumber': phone, 'message': msg, 'immediate': False }
                        data_payload = None
                        resp = _do_request()
                        ct = resp.headers.get('content-type', '')
                        size = len(resp.content) if resp.content is not None else 0
                        logger.info(f"FALLBACK RESP {resp.status_code} {size}B <- {target}")
    except Exception as e:
        logger.error(f"Error en fallback a cola: {e}")

    logger.info(f"RESP {resp.status_code} {size}B {dt_ms:.0f}ms <- {target}")

    return Response(resp.content, status=resp.status_code, headers=out_headers)


@app.route("/health", methods=["GET"])  # Health del proxy con chequeo opcional del backend
def health():
    lines = []
    lines.append("proxy: ok")
    lines.append(f"backend_url: {BACKEND_URL}")
    try:
        resp = session.get(urljoin(BACKEND_URL.rstrip("/") + "/", "health"), timeout=TIMEOUT)
        ct = resp.headers.get("content-type", "")
        body = resp.text
        # Limitar cuerpo para no saturar salida
        if body and len(body) > 400:
            body = body[:400] + "..."
        lines.append(f"backend_status: {resp.status_code}")
        lines.append(f"backend_ct: {ct}")
        lines.append(f"backend_body: {body if body else '-'}")
    except requests.RequestException as e:
        lines.append(f"backend_error: {str(e)}")
    return Response("\n".join(lines), mimetype="text/plain")


@app.route("/", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])  # raíz
def root_proxy():
    return _proxy_to_backend("")


@app.route("/<path:path>", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])  # passthrough
def passthrough(path):
    return _proxy_to_backend(path)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5000"))
    host = os.environ.get("HOST", "0.0.0.0")
    logger.info(f"Windows proxy escuchando en http://{host}:{port} -> {BACKEND_URL}")
    app.run(host=host, port=port, threaded=True)
