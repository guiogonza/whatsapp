# Plantillas Meta (WhatsApp Cloud API) — estado y uso

Consultado a la API de Meta el 2026-10-31. Idioma `es_CO` salvo indicación.

## Salida de geozona / validación de manifiesto

**Usar siempre `torre_valida_salida_viaje`** (APROBADA, UTILITY).

Texto: "Hola {{1}}, te escribe la Torre de Control de COINTRA. Identificamos que el vehículo {{2}} salió de {{3}}. Por favor confirma respondiendo los 4 últimos números de tu manifiesto."

Variables: {{1}} nombre del conductor, {{2}} placa, {{3}} geozona de la que salió.

Cuándo usarla: el vehículo sale de una geozona (cargue, puerto, etc.) con un viaje asignado y hay que pedir al conductor los 4 últimos números del manifiesto.
Respuesta del conductor: se confirma con `torre_manifiesto_confirmado_v2` o `torre_manifiesto_no_coincide_v2`.

### Plantillas reenviadas a revisión (2026-10-31), sin uso
Rechazadas por `INCORRECT_CATEGORY` y reenviadas con placa y viaje en curso (3 variables).
Hacen lo mismo que `torre_valida_salida_viaje`; no usarlas aunque queden aprobadas.
- `torre_salida_geozona`
- `torre_confirma_salida`
- `confirma_manifiesto_salida`

Si quedan PENDING/REJECTED o sobran, se pueden borrar en WhatsApp Manager.
