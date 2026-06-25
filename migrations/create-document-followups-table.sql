-- Migración: Tabla para seguimiento de documentos 9 a.m.
CREATE TABLE IF NOT EXISTS operational_document_followups (
    id SERIAL PRIMARY KEY,
    followup_date DATE NOT NULL,
    site_id INT NOT NULL REFERENCES operational_sites(id),
    responsible_id INT REFERENCES operational_site_responsibles(id),
    phone_number VARCHAR(30) NOT NULL,
    message TEXT,
    send_type VARCHAR(20) DEFAULT 'automatico',
    doc_count INT DEFAULT 0,
    sent_at TIMESTAMP DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_doc_followups_date ON operational_document_followups(followup_date DESC);
CREATE INDEX IF NOT EXISTS idx_doc_followups_site ON operational_document_followups(site_id);
