-- Migración: Crear tabla fx_messages para guardar mensajes FX/MT5 reenviados
-- Fecha: 26/02/2026

-- Crear tabla fx_messages si no existe
CREATE TABLE IF NOT EXISTS fx_messages (
    id SERIAL PRIMARY KEY,
    fx_session VARCHAR(50) NOT NULL,
    source_phone VARCHAR(20),
    target_phone VARCHAR(20) NOT NULL,
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Índices para mejorar el rendimiento de consultas
CREATE INDEX IF NOT EXISTS  idx_fx_messages_timestamp ON fx_messages(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_fx_messages_session ON fx_messages(fx_session);
CREATE INDEX IF NOT EXISTS idx_fx_messages_target_phone ON fx_messages(target_phone);
CREATE INDEX IF NOT EXISTS idx_fx_messages_status ON fx_messages(status);

-- Comentarios
COMMENT ON TABLE fx_messages IS 'Tabla para guardar historial de mensajes FX/MT5 reenviados';
COMMENT ON COLUMN fx_messages.fx_session IS 'Nombre de la sesión FX que reenvió el mensaje (fx-session-1, fx-session-2, etc.)';
COMMENT ON COLUMN fx_messages.source_phone IS 'Teléfono origen del mensaje (puede ser NULL si es mensaje generado)';
COMMENT ON COLUMN fx_messages.target_phone IS 'Teléfono destino al que se reenvió';
COMMENT ON COLUMN fx_messages.message IS 'Contenido del mensaje reenviado';
COMMENT ON COLUMN fx_messages.status IS 'Estado: PENDING, FORWARDED, SENT, ERROR';
COMMENT ON COLUMN fx_messages.timestamp IS 'Fecha y hora del mensaje';

-- Verificar si existe la tabla gpswox_messaging y agregarle índices si no los tiene
DO $$
BEGIN
    IF EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'gpswox_messaging') THEN
        -- Agregar índices si no existen
        CREATE INDEX IF NOT EXISTS idx_gpswox_messaging_timestamp ON gpswox_messaging(timestamp DESC);
        CREATE INDEX IF NOT EXISTS idx_gpswox_messaging_phone ON gpswox_messaging(phone_number);
        CREATE INDEX IF NOT EXISTS idx_gpswox_messaging_state ON gpswox_messaging(conversation_state);
        
        RAISE NOTICE 'Índices agregados a tabla gpswox_messaging';
    ELSE
        RAISE NOTICE 'Tabla gpswox_messaging no existe, omitiendo índices';
    END IF;
END $$;

-- Mostrar resumen
SELECT 'fx_messages' as tabla, COUNT(*) as registros FROM fx_messages
UNION ALL
SELECT 'gpswox_messaging' as tabla, COUNT(*) as registros FROM gpswox_messaging WHERE EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'gpswox_messaging');
