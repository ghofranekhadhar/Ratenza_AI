const { spawn } = require('child_process');
const path       = require('path');
const connectDB  = require('../config/db');

const COMMERCE_ID   = process.env.COMMERCE_ID   || 'commerce_local_1';
const PYTHON_PATH   = process.env.PYTHON_PATH   || 'python';

// ============================================================
// GET /api/data
// Retourne tous les résultats RFM depuis la collection analyses_ia
// triés par score_global_sa décroissant.
// ============================================================
const getRFMData = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;

    try {
        const db      = await connectDB();
        const records = await db.collection('analyses_ia')
            .find({ commerce_id: commerceId })
            .sort({ score_global_sa: -1 })
            .toArray();

        // Convertir ObjectId en chaîne pour le JSON
        records.forEach(r => {
            if (r._id) r._id = r._id.toString();
        });

        return res.json(records);
    } catch (err) {
        console.error('❌ getRFMData error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/transactions/:email
// Résout le client_id depuis son email, puis renvoie ses transactions.
// ============================================================
const getClientTransactions = async (req, res) => {
    const { id }         = req.params;
    const commerceId   = req.query.commerce_id || COMMERCE_ID;

    try {
        const db = await connectDB();

        // Récupérer toutes ses transactions triées par date décroissante
        const transactions = await db.collection('transactions')
            .find({ client_id: id, commerce_id: commerceId })
            .sort({ date_transaction: -1 })
            .toArray();

        // Formater les dates ISO et les ObjectId pour le JSON
        transactions.forEach(tx => {
            if (tx._id)              tx._id = tx._id.toString();
            if (tx.date_transaction) tx.date_transaction = new Date(tx.date_transaction).toISOString();
        });

        return res.json(transactions);
    } catch (err) {
        console.error('❌ getClientTransactions error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/recalculate
// Lance le pipeline de calcul RFM Python comme sous-processus.
// ============================================================
const recalculateRFM = (req, res) => {
    const data       = req.body || {};
    const commerceId = data.commerce_id || COMMERCE_ID;
    const projectRoot = path.resolve(__dirname, '..');

    console.log(`🔄 Recalcul RFM lancé pour commerce_id=${commerceId}...`);

    const args = ['main.py', '--commerce-id', commerceId];

    const pyProcess = spawn(PYTHON_PATH, args, {
        cwd: projectRoot,
        env: { ...process.env }
    });

    let output      = '';
    let errorOutput = '';

    pyProcess.stdout.on('data', data => {
        const line = data.toString();
        output += line;
        process.stdout.write(`[Python RFM] ${line}`);
    });

    pyProcess.stderr.on('data', data => {
        const line = data.toString();
        errorOutput += line;
        process.stderr.write(`[Python ERR] ${line}`);
    });

    pyProcess.on('close', code => {
        if (code === 0) {
            console.log(`✅ Pipeline RFM terminé avec succès (code ${code})`);
            return res.json({
                status: 'success',
                message: 'Calcul RFM recalculé et sauvegardé avec succès !'
            });
        } else {
            console.error(`❌ Pipeline RFM échoué (code ${code})`);
            return res.status(500).json({
                status: 'error',
                error:  `Le processus Python a terminé avec le code ${code}`,
                detail: errorOutput.slice(-500)
            });
        }
    });

    pyProcess.on('error', err => {
        console.error('❌ Impossible de lancer Python :', err.message);
        return res.status(500).json({ error: `Impossible de lancer Python : ${err.message}` });
    });
};

// ============================================================
// POST /api/campaigns/send
// Simule l'envoi d'un e-mail de campagne marketing et le persiste
// dans la collection 'campagnes_envoyees' de MongoDB.
// ============================================================
const sendCampaignEmail = async (req, res) => {
    const { email, nom, subject, body, segment, commerce_id } = req.body || {};
    const commerceId = commerce_id || COMMERCE_ID;

    if (!email || !subject || !body) {
        return res.status(400).json({ error: 'Champs requis manquants : email, subject, body.' });
    }

    try {
        const db = await connectDB();

        const campaignDoc = {
            commerce_id : commerceId,
            client_email: email,
            client_nom  : nom || email,
            segment     : segment || 'unknown',
            subject,
            body,
            sent_at     : new Date().toISOString(),
            status      : 'simulated' // Changer en 'sent' lors du branchement SMTP réel
        };

        // Simulation de l'envoi (log console)
        console.log('');
        console.log('📧 ─────────────────────────────────────────────');
        console.log(`   CAMPAGNE MARKETING — SIMULATION D'ENVOI`);
        console.log(`   Destinataire : ${nom} <${email}>`);
        console.log(`   Segment      : ${segment}`);
        console.log(`   Sujet        : ${subject}`);
        console.log(`   Message      :\n${body}`);
        console.log('📧 ─────────────────────────────────────────────');
        console.log('');

        // Persistance dans MongoDB
        await db.collection('campagnes_envoyees').insertOne(campaignDoc);

        return res.json({
            status : 'success',
            message: `E-mail de campagne simulé et enregistré pour ${email}.`
        });
    } catch (err) {
        console.error('❌ sendCampaignEmail error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/campaigns/history/:email
// Retourne l'historique des campagnes envoyées à un client.
// ============================================================
const getClientCampaignHistory = async (req, res) => {
    const { email }    = req.params;
    const commerceId   = req.query.commerce_id || COMMERCE_ID;

    try {
        const db = await connectDB();
        const history = await db.collection('campagnes_envoyees')
            .find({ client_email: email, commerce_id: commerceId })
            .sort({ sent_at: -1 })
            .toArray();

        history.forEach(h => { if (h._id) h._id = h._id.toString(); });

        return res.json(history);
    } catch (err) {
        console.error('❌ getClientCampaignHistory error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/campaigns/send-group
// Envoie un e-mail à un groupe de clients en batch
// ============================================================
const sendGroupCampaign = async (req, res) => {
    const { clients, subject, body, commerce_id } = req.body || {};
    const commerceId = commerce_id || COMMERCE_ID;

    if (!clients || !Array.isArray(clients) || clients.length === 0 || !subject || !body) {
        return res.status(400).json({ error: 'Champs requis manquants : clients (array), subject, body.' });
    }

    try {
        const db = await connectDB();
        const sentAt = new Date().toISOString();
        const campaignsToInsert = [];

        clients.forEach(client => {
            const finalSubject = subject.replace(/{nom}/g, client.nom || client.email);
            const finalBody = body.replace(/{nom}/g, client.nom || client.email);

            campaignsToInsert.push({
                commerce_id: commerceId,
                client_email: client.email,
                client_nom: client.nom || client.email,
                segment: client.segment || 'group',
                subject: finalSubject,
                body: finalBody,
                sent_at: sentAt,
                status: 'simulated_batch'
            });
            
            console.log(`📧 [BATCH] Simulation envoi à ${client.email} - Sujet: ${finalSubject}`);
        });

        if (campaignsToInsert.length > 0) {
            await db.collection('campagnes_envoyees').insertMany(campaignsToInsert);
        }

        return res.json({
            status: 'success',
            message: `${campaignsToInsert.length} e-mails groupés simulés avec succès !`
        });
    } catch (err) {
        console.error('❌ sendGroupCampaign error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/campaigns/trigger-automation
// Automatisation IA : Analyse tous les clients et génère des e-mails hyper-personnalisés
// selon les probabilités GMM exactes de chacun.
// ============================================================
const triggerSmartAutomation = async (req, res) => {
    const commerceId = req.body.commerce_id || COMMERCE_ID;

    try {
        const db = await connectDB();
        
        // 1. Récupérer tous les clients de ce commerce
        const clients = await db.collection('analyses_ia')
            .find({ commerce_id: commerceId })
            .toArray();

        if (!clients || clients.length === 0) {
            return res.json({ status: 'info', message: 'Aucun client à analyser.' });
        }

        const sentAt = new Date().toISOString();
        const campaignsToInsert = [];
        let stats = { vip_danger: 0, vip: 0, regular: 0, at_risk: 0, lost: 0 };

        // 2. Parcourir chaque client pour appliquer l'IA de décision
        clients.forEach(client => {
            let probs = client.probabilities_gmm;
            if (Array.isArray(probs)) probs = probs[0] || probs;
            
            if (!probs || typeof probs !== 'object') return; // Passer si pas de GMM

            const pVip = probs['vip'] || 0;
            const pRisk = (probs['at_risk'] || 0) + (probs['lost'] || 0);
            const pReg = probs['regular'] || 0;
            const pLost = probs['lost'] || 0;

            const nomClient = client.client_db_id || client.email || 'Client';
            let finalSubject = '';
            let finalBody = '';
            let category = '';

            // --- REGLES D'AUTOMATISATION HYPER-PERSONNALISEE ---
            
            // Règle 1: VIP en danger imminent
            if (pVip > 0.25 && pRisk > 0.25) {
                finalSubject = `Une offre exceptionnelle pour vous retenir, ${nomClient}`;
                finalBody = `Bonjour ${nomClient},\n\nVous êtes l'un de nos clients les plus précieux, mais nous avons remarqué que vous vous faisiez rare !\n\nPour vous remercier de votre fidélité historique, voici une remise exceptionnelle de 30% : VIPRETOUR30.\n\nÀ très vite !`;
                category = 'vip_danger';
            } 
            // Règle 2: Très fort VIP pur
            else if (pVip > 0.6) {
                finalSubject = `Merci pour votre fidélité incroyable, ${nomClient} !`;
                finalBody = `Bonjour ${nomClient},\n\nEn tant que client VIP majeur, nous vous offrons un accès en avant-première à nos nouvelles collections. Merci pour votre confiance absolue !\n\nL'équipe Ratenza`;
                category = 'vip';
            }
            // Règle 3: Presque perdu
            else if (pLost > 0.5) {
                finalSubject = `Une offre spéciale pour votre retour, ${nomClient}`;
                finalBody = `Bonjour ${nomClient},\n\nNous espérons que tout va bien ! Pour marquer votre retour parmi nous, bénéficiez d'une remise de 25% avec le code : RETOUR25.`;
                category = 'lost';
            }
            // Règle 4: A risque
            else if (pRisk > 0.4) {
                finalSubject = `Votre avis compte pour nous, ${nomClient}`;
                finalBody = `Bonjour ${nomClient},\n\nAuriez-vous 2 minutes pour nous donner votre avis ? En retour, recevez un bon de réduction de 10%.`;
                category = 'at_risk';
            }
            // Règle 5: Régulier basique
            else {
                finalSubject = `Nos nouveautés vous attendent, ${nomClient} !`;
                finalBody = `Bonjour ${nomClient},\n\nDe nouveaux produits viennent d'arriver ! Venez découvrir notre sélection qui pourrait vous plaire.`;
                category = 'regular';
            }

            stats[category]++;

            campaignsToInsert.push({
                commerce_id: commerceId,
                client_email: client.email || client.client_db_id,
                client_nom: nomClient,
                segment: client.segment_gmm || 'unknown',
                subject: finalSubject,
                body: finalBody,
                sent_at: sentAt,
                status: 'simulated_auto'
            });
            
            console.log(`🤖 [AUTO IA] Décision: ${category.toUpperCase()} pour ${nomClient}`);
        });

        // 3. Sauvegarder massivement
        if (campaignsToInsert.length > 0) {
            await db.collection('campagnes_envoyees').insertMany(campaignsToInsert);
        }

        return res.json({
            status: 'success',
            message: `Automatisation IA terminée. ${campaignsToInsert.length} e-mails générés sur-mesure !`,
            stats
        });

    } catch (err) {
        console.error('❌ triggerSmartAutomation error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = { 
    getRFMData, 
    getClientTransactions, 
    recalculateRFM, 
    sendCampaignEmail, 
    getClientCampaignHistory,
    sendGroupCampaign,
    triggerSmartAutomation
};
