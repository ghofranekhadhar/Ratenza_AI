/**
 * loyaltyRoutes.js
 * ----------------
 * Routes API pour le système de Points de Fidélité (Fonctionnalité 2).
 *
 * Préfixe monté dans server.js : /api/loyalty
 *
 * Routes :
 *   POST /api/loyalty/credit              → Créditer des points après achat
 *   POST /api/loyalty/redeem              → Utiliser un code de récompense (débit)
 *   GET  /api/loyalty/balance/:email      → Solde + état des paliers du client
 *   GET  /api/loyalty/history/:email      → Journal d'audit complet
 */

'use strict';

const express  = require('express');
const router   = express.Router();

const {
    creditPoints,
    redeemPoints,
    getLoyaltyBalance,
    getLoyaltyHistory
} = require('../controllers/loyaltyController');

// POST /api/loyalty/credit   → Créditer des points (après achat)
router.post('/credit', creditPoints);

// POST /api/loyalty/redeem   → Utiliser un code FID10 / FID20 / FIDVIP
router.post('/redeem', redeemPoints);

// GET  /api/loyalty/balance/:email   → Solde + paliers du client
router.get('/balance/:email', getLoyaltyBalance);

// GET  /api/loyalty/history/:email   → Journal d'audit complet
router.get('/history/:email', getLoyaltyHistory);

module.exports = router;
