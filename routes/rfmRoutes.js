const express  = require('express');
const router   = express.Router();
const {
    getRFMData,
    getClientTransactions,
    recalculateRFM,
    sendCampaignEmail,
    getClientCampaignHistory,
    sendGroupCampaign,
    triggerSmartAutomation,
    getAutomationStatus,
    getCommerces,
    getGlobalComparison,
    getReturnRate,
    getRecommendations,
    optOutRGPD,
    getCommerceSettings,
    updateCommerceSettings
} = require('../controllers/rfmController');

const {
    getReferralStats,
    getClientReferralDetail,
    declareReferral
} = require('../controllers/referralController');

// GET  /api/commerces               → Liste de tous les commerce_id disponibles
router.get('/commerces', getCommerces);

// GET  /api/referrals/stats        → Statistiques globales du parrainage
router.get('/referrals/stats', getReferralStats);

// GET  /api/referrals/client/:email → Infos parrainage & paliers d'un client
router.get('/referrals/client/:email', getClientReferralDetail);

// POST /api/referrals/declare       → Enregistrer un parrainage
router.post('/referrals/declare', declareReferral);

// GET  /api/global-comparison       → Comparaison globale de toutes les boutiques
router.get('/global-comparison', getGlobalComparison);

// GET  /api/kpis/return-rate        → Taux de retour client (Tr) d'une boutique
router.get('/kpis/return-rate', getReturnRate);

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

// POST /api/campaigns/trigger-automation → Déclencher l'IA d'automatisation (répond immédiatement)
router.post('/campaigns/trigger-automation', triggerSmartAutomation);

// GET  /api/campaigns/automation-status  → Statut de l'automatisation en cours (polling)
router.get('/campaigns/automation-status', getAutomationStatus);

// GET  /api/recommendations              → Recommandations IA rule-based pour une boutique
router.get('/recommendations', getRecommendations);

// POST /api/rgpd/opt-out                 → Désactiver le ciblage marketing pour un client (RGPD)
router.post('/rgpd/opt-out', optOutRGPD);

// GET  /api/commerces/settings           → Récupérer les paramètres d'un commerce
router.get('/commerces/settings', getCommerceSettings);

// POST /api/commerces/settings          → Enregistrer les paramètres d'un commerce
router.post('/commerces/settings', updateCommerceSettings);

module.exports = router;
