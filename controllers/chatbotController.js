const connectDB = require('../config/db');

/**
 * GET /api/chatbot/blocks
 * Récupère la liste de tous les clients bloqués.
 */
const getBlockedClients = async (req, res) => {
    const { commerce_id } = req.query;

    try {
        const db = await connectDB();
        const query = { is_blocked: true };
        
        if (commerce_id && commerce_id !== '__all__') {
            query.commerce_id = commerce_id;
        }

        const blockedList = await db.collection('chatbot_status')
            .find(query)
            .sort({ blocked_at: -1 })
            .toArray();

        return res.json({
            status: 'success',
            data: blockedList
        });
    } catch (err) {
        console.error('❌ Error getBlockedClients:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/chatbot/conversation/:email
 * Récupère l'historique complet des messages pour un client.
 */
const getConversation = async (req, res) => {
    const { email } = req.params;
    const { commerce_id } = req.query;

    if (!email) {
        return res.status(400).json({ error: 'Email requis.' });
    }

    try {
        const db = await connectDB();
        const query = { email: { $regex: new RegExp(`^${email}$`, 'i') } };
        
        if (commerce_id && commerce_id !== '__all__') {
            query.commerce_id = commerce_id;
        }

        const conv = await db.collection('chatbot_conversations').findOne(query);

        return res.json({
            status: 'success',
            data: conv ? conv.messages : []
        });
    } catch (err) {
        console.error('❌ Error getConversation:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

/**
 * POST /api/chatbot/unblock
 * Débloque un client (remet les warnings à 0 et is_blocked à false).
 */
const unblockClient = async (req, res) => {
    const { email, commerce_id } = req.body;

    if (!email || !commerce_id) {
        return res.status(400).json({ error: 'Email et commerce_id requis.' });
    }

    try {
        const db = await connectDB();
        
        const result = await db.collection('chatbot_status').updateOne(
            { 
                email: { $regex: new RegExp(`^${email}$`, 'i') }, 
                commerce_id 
            },
            {
                $set: {
                    warnings: 0,
                    is_blocked: false,
                    blocked_at: null,
                    block_reason: null
                }
            }
        );

        if (result.matchedCount === 0) {
            return res.status(404).json({ error: 'Client introuvable dans le statut chatbot.' });
        }

        return res.json({
            status: 'success',
            message: `Le client ${email} a été débloqué avec succès.`
        });
    } catch (err) {
        console.error('❌ Error unblockClient:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getBlockedClients,
    getConversation,
    unblockClient
};
