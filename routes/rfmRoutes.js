const express  = require('express');
const router   = express.Router();
const {
    getRFMData,
    getClientTransactions,
    recalculateRFM,
    sendCampaignEmail,
    getClientCampaignHistory,
    sendGroupCampaign,
    triggerSmartAutomation
} = require('../controllers/rfmController');

// GET  /api/data                  → Liste de tous les clients RFM
router.get('/data', getRFMData);

// GET  /api/transactions/:id   → Historique des achats d'un client
router.get('/transactions/:id', getClientTransactions);

// POST /api/recalculate           → Relancer le pipeline Python RFM
router.post('/recalculate', recalculateRFM);

// POST /api/campaigns/send        → Envoyer un e-mail de campagne marketing
router.post('/campaigns/send', sendCampaignEmail);

// GET  /api/campaigns/history/:email → Historique des campagnes envoyées à un client
router.get('/campaigns/history/:email', getClientCampaignHistory);

// POST /api/campaigns/send-group  → Envoyer un e-mail à tout un groupe
router.post('/campaigns/send-group', sendGroupCampaign);

// POST /api/campaigns/trigger-automation → Déclencher l'IA d'automatisation
router.post('/campaigns/trigger-automation', triggerSmartAutomation);

module.exports = router;
