const express = require('express');
const router = express.Router();
const operational = require('../lib/session/gpswox-operational');
const {
    formatPlate,
    isValidPlateFormat,
    findDeviceByPlate
} = require('../lib/session/gpswox-api');

router.get('/sites', async (req, res) => {
    try {
        res.json({ success: true, sites: await operational.listSites() });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/sites', async (req, res) => {
    try {
        const site = await operational.createSite(req.body);
        res.json({ success: true, site });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/sites/:id', async (req, res) => {
    try {
        const site = await operational.updateSite(req.params.id, req.body);
        res.json({ success: true, site });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/sites/:id', async (req, res) => {
    try {
        const site = await operational.updateSite(req.params.id, { active: false });
        if (!site) return res.status(404).json({ success: false, error: 'Sede no encontrada' });
        res.json({ success: true, site });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/statuses', async (req, res) => {
    try {
        res.json({ success: true, statuses: await operational.listStatuses(true) });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/vehicles', async (req, res) => {
    try {
        const result = await operational.listVehicles({
            siteId: req.query.siteId || null,
            statusId: req.query.statusId || null,
            onlyNonOperational: req.query.onlyNonOperational === 'true',
            search: req.query.search || null,
            paginate: req.query.paginate === 'true',
            page: req.query.page,
            limit: req.query.limit
        });
        if (req.query.paginate === 'true') {
            res.json({ success: true, vehicles: result.rows, pagination: result.pagination });
            return;
        }
        res.json({ success: true, vehicles: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/vehicles', async (req, res) => {
    try {
        const plate = formatPlate(req.body.plate || '');
        if (!isValidPlateFormat(plate)) {
            return res.status(400).json({
                success: false,
                error: 'Formato de placa invalido. Ejemplo: ABC123 o ABC-123'
            });
        }

        const device = await findDeviceByPlate(plate);
        if (!device) {
            return res.status(404).json({
                success: false,
                error: `La placa ${plate} no existe en plataformagps`
            });
        }

        const vehicle = await operational.upsertVehicle({
            plate,
            deviceId: device.id,
            siteId: req.body.siteId,
            statusId: req.body.statusId,
            observation: req.body.observation || null,
            changedByPhone: req.body.changedByPhone || 'dashboard',
            source: 'dashboard'
        });
        res.json({ success: true, vehicle });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/vehicles/:id', async (req, res) => {
    try {
        const vehicle = await operational.updateVehicle(req.params.id, req.body);
        if (!vehicle) return res.status(404).json({ success: false, error: 'Vehiculo no encontrado' });
        res.json({ success: true, vehicle });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/vehicles/:id', async (req, res) => {
    try {
        const vehicle = await operational.deactivateVehicle(req.params.id);
        if (!vehicle) return res.status(404).json({ success: false, error: 'Vehiculo no encontrado' });
        res.json({ success: true, vehicle });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/document-expirations', async (req, res) => {
    try {
        const result = await operational.listDocumentExpirations({
            ...req.query,
            paginate: req.query.paginate === 'true'
        });
        if (req.query.paginate === 'true') {
            res.json({ success: true, documents: result.rows, pagination: result.pagination });
            return;
        }
        res.json({ success: true, documents: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/document-expirations', async (req, res) => {
    try {
        const document = await operational.upsertDocumentExpiration(req.body);
        res.json({ success: true, document });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.put('/document-expirations/:id', async (req, res) => {
    try {
        const document = await operational.updateDocumentExpiration(req.params.id, req.body);
        if (!document) return res.status(404).json({ success: false, error: 'Vencimiento no encontrado' });
        res.json({ success: true, document });
    } catch (error) {
        res.status(400).json({ success: false, error: error.message });
    }
});

router.delete('/document-expirations/:id', async (req, res) => {
    try {
        const document = await operational.deleteDocumentExpiration(req.params.id);
        if (!document) return res.status(404).json({ success: false, error: 'Vencimiento no encontrado' });
        res.json({ success: true, document });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/responsibles', async (req, res) => {
    try {
        const responsible = await operational.upsertResponsible(req.body);
        res.json({ success: true, responsible });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.put('/responsibles/:id', async (req, res) => {
    try {
        const responsible = await operational.upsertResponsible({ ...req.body, id: req.params.id });
        if (!responsible) return res.status(404).json({ success: false, error: 'Responsable no encontrado' });
        res.json({ success: true, responsible });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/responsibles/:id', async (req, res) => {
    try {
        const responsible = await operational.deactivateResponsible(req.params.id);
        if (!responsible) return res.status(404).json({ success: false, error: 'Responsable no encontrado' });
        res.json({ success: true, responsible });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/report', async (req, res) => {
    try {
        const result = await operational.getReport({
            ...req.query,
            paginate: req.query.paginate === 'true'
        });
        if (req.query.paginate === 'true') {
            res.json({ success: true, report: result.rows, pagination: result.pagination });
            return;
        }
        res.json({ success: true, report: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/report/:id', async (req, res) => {
    try {
        const entry = await operational.deleteHistoryEntry(req.params.id);
        if (!entry) return res.status(404).json({ success: false, error: 'Registro de historial no encontrado' });
        res.json({ success: true, entry });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.get('/followups', async (req, res) => {
    try {
        const result = await operational.getFollowupReport({
            ...req.query,
            paginate: req.query.paginate === 'true'
        });
        if (req.query.paginate === 'true') {
            res.json({ success: true, followups: result.rows, pagination: result.pagination });
            return;
        }
        res.json({ success: true, followups: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.delete('/followups/:id', async (req, res) => {
    try {
        const followup = await operational.deleteFollowup(req.params.id);
        if (!followup) return res.status(404).json({ success: false, error: 'Seguimiento no encontrado' });
        res.json({ success: true, followup });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

router.post('/send-daily', async (req, res) => {
    try {
        const sessionManager = require('../sessionManager-baileys');
        const sent = await operational.sendDailyPrompts(sessionManager, { sendType: 'manual' });
        res.json({ success: true, sent });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
