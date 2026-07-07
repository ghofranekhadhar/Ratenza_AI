const express = require('express');
const router = express.Router();
const chatbotController = require('../controllers/chatbotController');

// Déclaration des endpoints API du Chatbot pour le Dashboard Commerçant
router.get('/blocks', chatbotController.getBlockedClients);
router.get('/conversation/:email', chatbotController.getConversation);
router.post('/unblock', chatbotController.unblockClient);

module.exports = router;
