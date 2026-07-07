const { spawn } = require('child_process');
const path       = require('path');
const { ObjectId } = require('mongodb');
const connectDB  = require('../config/db');
const { sendEmail } = require('../utils/emailService');

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
    const { id }       = req.params;
    const commerceId   = req.query.commerce_id || COMMERCE_ID;

    try {
        const db = await connectDB();

        // Construire un filtre robuste : on essaie id (string) ET ObjectId si valide
        const orFilter = [{ client_id: id }];
        if (ObjectId.isValid(id)) {
            orFilter.push({ client_id: new ObjectId(id) });
        }

        let transactions = await db.collection('transactions')
            .find({ $or: orFilter, commerce_id: commerceId })
            .sort({ date_transaction: -1 })
            .toArray();

        // Fallback : si rien trouvé, chercher par email via la collection clients
        if (transactions.length === 0) {
            const clientDoc = await db.collection('clients').findOne({ email: id, commerce_id: commerceId })
                || await db.collection('clients').findOne({ email: id });
            if (clientDoc) {
                const cId = clientDoc._id.toString();
                const orFilter2 = [{ client_id: cId }];
                if (ObjectId.isValid(cId)) {
                    orFilter2.push({ client_id: new ObjectId(cId) });
                }
                transactions = await db.collection('transactions')
                    .find({ $or: orFilter2, commerce_id: commerceId })
                    .sort({ date_transaction: -1 })
                    .toArray();
            }
        }

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
    let responseSent = false;

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
        if (responseSent) return;
        responseSent = true;

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
        if (responseSent) return;
        responseSent = true;

        console.error('❌ Impossible de lancer Python :', err.message);
        return res.status(500).json({ error: `Impossible de lancer Python : ${err.message}` });
    });
};

// ============================================================
// POST /api/campaigns/send
// Envoie ou simule un e-mail de campagne marketing et le persiste
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

        // Envoi réel ou simulation via le service emailService
        const result = await sendEmail({
            to: email,
            subject,
            text: body
        });

        const campaignDoc = {
            commerce_id : commerceId,
            client_email: email,
            client_nom  : nom || email,
            segment     : segment || 'unknown',
            subject,
            body,
            sent_at     : new Date().toISOString(),
            status      : result.status // 'sent' ou 'simulated'
        };

        // Persistance dans MongoDB
        await db.collection('campagnes_envoyees').insertOne(campaignDoc);

        const msg = result.status === 'sent'
            ? `E-mail de campagne envoyé avec succès à ${email}.`
            : `E-mail de campagne simulé et enregistré pour ${email}.`;

        return res.json({
            status : 'success',
            message: msg
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

        // Utiliser Promise.all pour l'envoi parallèle
        const sendPromises = clients.map(async (client) => {
            const finalSubject = subject.replace(/{nom}/g, client.nom || client.email);
            const finalBody = body.replace(/{nom}/g, client.nom || client.email);

            let status = 'simulated_batch';
            try {
                const emailResult = await sendEmail({
                    to: client.email,
                    subject: finalSubject,
                    text: finalBody
                });
                status = emailResult.status === 'sent' ? 'sent_batch' : 'simulated_batch';
            } catch (err) {
                console.error(`❌ Échec de l'envoi d'e-mail groupé à ${client.email} :`, err.message);
                status = 'failed_batch';
            }

            campaignsToInsert.push({
                commerce_id: commerceId,
                client_email: client.email,
                client_nom: client.nom || client.email,
                segment: client.segment || 'group',
                subject: finalSubject,
                body: finalBody,
                sent_at: sentAt,
                status: status
            });
        });

        await Promise.all(sendPromises);

        if (campaignsToInsert.length > 0) {
            await db.collection('campagnes_envoyees').insertMany(campaignsToInsert);
        }

        const sentCount = campaignsToInsert.filter(c => c.status === 'sent_batch').length;
        const msg = sentCount > 0 
            ? `${sentCount} e-mails groupés envoyés avec succès (et ${campaignsToInsert.length - sentCount} simulés/échoués).`
            : `${campaignsToInsert.length} e-mails groupés simulés avec succès !`;

        return res.json({
            status: 'success',
            message: msg
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
// Fonction interne d'automatisation intelligente réutilisable par le planificateur de tâches
const runSmartAutomationInternal = async (commerceId) => {
    const db = await connectDB();
    
    // 1. Récupérer tous les clients de ce commerce
    const clients = await db.collection('analyses_ia')
        .find({ commerce_id: commerceId })
        .toArray();

    if (!clients || clients.length === 0) {
        return { status: 'info', message: 'Aucun client à analyser.', stats: {} };
    }

    const sentAt = new Date().toISOString();
    const campaignsToInsert = [];
    const stats = { ambassador_invite: 0, birthday_gift: 0, vip_danger: 0, vip: 0, regular: 0, at_risk: 0, lost: 0, skipped_cooldown: 0 };

    // 2. Récupérer les campagnes envoyées ces 30 derniers jours pour le cooldown anti-spam
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentCampaigns = await db.collection('campagnes_envoyees')
        .find({
            commerce_id: commerceId,
            sent_at: { $gte: thirtyDaysAgo.toISOString() }
        })
        .toArray();

    // Map email -> date du dernier envoi
    const lastSentMap = {};
    recentCampaigns.forEach(c => {
        const email = c.client_email;
        if (email) {
            const sentDate = new Date(c.sent_at);
            if (!lastSentMap[email] || sentDate > lastSentMap[email]) {
                lastSentMap[email] = sentDate;
            }
        }
    });

    // 3. Récupérer les cadeaux d'anniversaire envoyés ces 300 derniers jours (anti-doublon d'anniversaire)
    const threeHundredDaysAgo = new Date();
    threeHundredDaysAgo.setDate(threeHundredDaysAgo.getDate() - 300);
    const recentBirthdays = await db.collection('campagnes_envoyees')
        .find({
            commerce_id: commerceId,
            category: 'birthday_gift',
            sent_at: { $gte: threeHundredDaysAgo.toISOString() }
        })
        .toArray();

    const birthdaySentEmails = new Set(recentBirthdays.map(c => c.client_email).filter(Boolean));

    // Récupérer les invitations ambassadeur déjà envoyées (anti-doublon à vie)
    const recentAmbassadorInvites = await db.collection('campagnes_envoyees')
        .find({ commerce_id: commerceId, category: 'ambassador_invite' })
        .toArray();
    const ambassadorInvitedEmails = new Set(recentAmbassadorInvites.map(c => c.client_email).filter(Boolean));

    // Calcul de la date de demain pour l'anniversaire à J-1
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowDay = tomorrow.getUTCDate();
    const tomorrowMonth = tomorrow.getUTCMonth();

    const promises = clients.map(async (client) => {
        const clientEmail = client.email || client.client_db_id;
        if (!clientEmail) return;

        const nomClient = client.nom || clientEmail || 'Client';
        const churnScore = client.churn_score || 0;
        const churnRiskLabel = client.churn_risk_label || 'Faible';
        
        // --- REGLE 1 : ANNIVERSAIRE (J-1) ---
        let isBirthdayTomorrow = false;
        if (client.date_naissance) {
            const birthDate = new Date(client.date_naissance);
            if (birthDate.getUTCDate() === tomorrowDay && birthDate.getUTCMonth() === tomorrowMonth) {
                isBirthdayTomorrow = true;
            }
        }

        let campaignToSend = null;

        // --- REGLE 0 : AMBASSADEUR (Score Influence >= 80 & jamais invité) ---
        const scoreInfluence = client.influence_score !== undefined
            ? client.influence_score
            : Math.round(((client.score_global_sa || 0) * 0.7 + (1.0 - (client.churn_score || 0)) * 0.3) * 100);

        if (scoreInfluence >= 80 && !ambassadorInvitedEmails.has(clientEmail)) {
            const refCode = client.referral_code || `REF-${(nomClient).toUpperCase().replace(/\s+/g, '-').substring(0, 10)}-PARRAIN`;
            const finalSubject = `${nomClient}, l'IA Retenza vous a sélectionné(e) comme Ambassadeur officiel ! 👑`;
            const finalBody = `Bonjour ${nomClient},\n\nNous sommes ravis de vous compter parmi nos meilleurs clients et nous souhaitons vous en remercier d'une façon toute particulière.\n\nGrâce à votre fidélité exceptionnelle, l'IA de Retenza vous a sélectionné(e) comme l'un de nos Ambassadeurs officiels !\n\n🎯 Votre code de parrainage exclusif : ${refCode}\n\nComment ça marche ?\n1. Partagez ce code à vos amis et votre entourage.\n2. Pour chaque ami qui vient acheter chez nous avec votre code, vous gagnez des récompenses :\n   - 1er parrainage → -10% sur votre prochain achat (code: PARRAIN10)\n   - 3 parrainages  → -20% sur votre prochain achat (code: PARRAIN20)\n   - 5 parrainages  → Statut VIP + avantages exclusifs (code: VIPAMBASSADEUR)\n\nMerci pour votre confiance et votre fidélité.\n\nL'équipe Retenza 💛`;

            campaignToSend = {
                subject: finalSubject,
                body: finalBody,
                category: 'ambassador_invite'
            };
            stats.ambassador_invite++;
            console.log(`🤖 [AUTO IA] 👑 AMBASSADEUR détecté : Invitation parrainage envoyée à ${nomClient} (${clientEmail}) — Score: ${scoreInfluence}%`);
        }

        if (campaignToSend) {
            // Envoi immédiat pour l'invitation ambassadeur (court-circuit du cooldown)
            let status = 'simulated_auto';
            try {
                const emailResult = await sendEmail({ to: clientEmail, subject: campaignToSend.subject, text: campaignToSend.body });
                status = emailResult.status === 'sent' ? 'sent_auto' : 'simulated_auto';
            } catch (err) {
                console.error(`❌ Échec invitation ambassadeur à ${clientEmail} :`, err.message);
                status = 'failed_auto';
            }
            campaignsToInsert.push({
                commerce_id: commerceId, client_email: clientEmail, client_nom: nomClient,
                segment: client.segment_gmm || 'vip', churn_score: churnScore,
                churn_risk_label: churnRiskLabel, subject: campaignToSend.subject,
                body: campaignToSend.body, sent_at: sentAt, status, category: 'ambassador_invite',
                influence_score: scoreInfluence, referral_code: client.referral_code || ''
            });
            return; // Ne pas envoyer d'autre email ce cycle à cet ambassadeur
        }

        // --- REGLE 1 : ANNIVERSAIRE (J-1) ---
        if (isBirthdayTomorrow) {
            // Vérifier si déjà fêté cette année
            if (!birthdaySentEmails.has(clientEmail)) {
                const finalSubject = `🎂 Joyeux Anniversaire, ${nomClient} ! Un cadeau spécial pour vous 🎁`;
                const finalBody = `Bonjour ${nomClient},\n\nToute l'équipe de Retenza vous souhaite un merveilleux anniversaire !\n\nPour célébrer ce jour spécial et vous remercier de votre fidélité, voici une réduction exceptionnelle de 20% sur votre prochain achat avec le code : CADEAU20.\n\nProfitez-en bien !\n\nL'équipe Retenza`;
                
                campaignToSend = {
                    subject: finalSubject,
                    body: finalBody,
                    category: 'birthday_gift'
                };
                stats.birthday_gift++;
                console.log(`🤖 [AUTO IA] Anniversaire fêté à J-1 pour ${nomClient} (${clientEmail})`);
            } else {
                console.log(`🤖 [AUTO IA] Anniversaire déjà fêté récemment pour ${nomClient} (${clientEmail}) - Ignoré`);
            }
        } else {
            // --- REGLE 2 : COOLDOWN ANTI-SPAM (30 jours) POUR LES AUTRES NOTIFICATIONS ---
            if (lastSentMap[clientEmail]) {
                stats.skipped_cooldown++;
                return;
            }

            // --- REGLE 3 : DÉCISIONS IA COMBINÉES (GMM + XGBOOST CHURN) ---
            let probs = client.probabilities_gmm;
            if (Array.isArray(probs)) probs = probs[0] || probs;
            
            if (!probs || typeof probs !== 'object') return; // Passer si pas de GMM

            const pVip  = probs['vip'] || 0;
            const pRisk = (probs['at_risk'] || 0) + (probs['lost'] || 0);
            const pLost = probs['lost'] || 0;

            // Score Churn XGBoost (0.0 → 1.0) — complément décisionnel du GMM
            const isHighChurn    = churnScore >= 0.55;   // Risque Moyen → Critique
            const isCriticalChurn = churnScore >= 0.75;  // Risque Critique uniquement

            let finalSubject = '';
            let finalBody    = '';
            let category     = '';

            // Règle 1 : VIP + Churn Critique → Rétention urgente prioritaire
            if (pVip > 0.5 && isCriticalChurn) {
                finalSubject = `${nomClient}, nous ne voulons pas vous perdre ! Offre VIP exclusive 🚨`;
                finalBody    = `Bonjour ${nomClient},\n\nNous avons remarqué que vous vous faisiez rare, et cela nous préoccupe sincèrement.\n\nEn tant que client VIP, vous méritez une attention toute particulière. Voici une remise exceptionnelle de 35% sur votre prochain achat : VIPSAVE35.\n\nNous espérons vous revoir très bientôt !\n\nL'équipe Retenza`;
                category     = 'vip_danger';
            }
            // Règle 2 : VIP + Churn Élevé/Moyen → Offre de fidélisation VIP
            else if (pVip > 0.25 && pRisk > 0.25) {
                finalSubject = `Une offre exceptionnelle pour vous retenir, ${nomClient}`;
                finalBody    = `Bonjour ${nomClient},\n\nVous êtes l'un de nos clients les plus précieux, mais nous avons remarqué que vous vous faisiez rare !\n\nPour vous remercier de votre fidélité historique, voici une remise exceptionnelle de 30% : VIPRETOUR30.\n\nÀ très vite !`;
                category     = 'vip_danger';
            }
            // Règle 3 : VIP pur + Churn Faible → Message fidélisation premium
            else if (pVip > 0.6) {
                finalSubject = `Merci pour votre fidélité incroyable, ${nomClient} !`;
                finalBody    = `Bonjour ${nomClient},\n\nEn tant que client VIP majeur, nous vous offrons un accès en avant-première à nos nouvelles collections. Merci pour votre confiance absolue !\n\nL'équipe Retenza`;
                category     = 'vip';
            }
            // Règle 4 : Perdu + Churn Critique → Reconquête urgente
            else if (pLost > 0.5 && isCriticalChurn) {
                finalSubject = `${nomClient}, une dernière offre pour votre retour 💔`;
                finalBody    = `Bonjour ${nomClient},\n\nCela fait longtemps que nous ne vous avons pas vu ! Nous avons préparé une offre spéciale de reconquête rien que pour vous : 30% de remise avec le code RETOUR30.\n\nCette offre est valable 7 jours. Ne la manquez pas !`;
                category     = 'lost';
            }
            // Règle 5 : Perdu standard
            else if (pLost > 0.5) {
                finalSubject = `Une offre spéciale pour votre retour, ${nomClient}`;
                finalBody    = `Bonjour ${nomClient},\n\nNous espérons que tout va bien ! Pour marquer votre retour parmi nous, bénéficiez d'une remise de 25% avec le code : RETOUR25.`;
                category     = 'lost';
            }
            // Règle 6 : À risque + Churn Élevé → Action préventive renforcée
            else if (pRisk > 0.4 && isHighChurn) {
                finalSubject = `${nomClient}, nous pensons à vous — une offre exclusive vous attend`;
                finalBody    = `Bonjour ${nomClient},\n\nNotre équipe a détecté que vous n'avez pas commandé depuis un moment. Pour vous remercier de votre confiance, voici une remise de 20% sur votre prochain achat : REACTIVATION20.\n\nNous comptons sur votre retour !`;
                category     = 'at_risk';
            }
            // Règle 7 : À risque standard → Sondage + petite remise
            else if (pRisk > 0.4) {
                finalSubject = `Votre avis compte pour nous, ${nomClient}`;
                finalBody    = `Bonjour ${nomClient},\n\nAuriez-vous 2 minutes pour nous donner votre avis ? En retour, recevez un bon de réduction de 10%.`;
                category     = 'at_risk';
            }
            // Règle 8 : Régulier + Churn Moyen → Encouragement proactif
            else if (isHighChurn) {
                finalSubject = `Nos meilleures offres vous attendent, ${nomClient} !`;
                finalBody    = `Bonjour ${nomClient},\n\nNe laissez pas passer nos nouvelles promotions ! Profitez de 15% de réduction sur votre prochain achat avec le code : PROMO15.\n\nOffre valable cette semaine seulement.`;
                category     = 'regular';
            }
            // Règle 9 : Régulier fidèle → Newsletter et nouveautés
            else {
                finalSubject = `Nos nouveautés vous attendent, ${nomClient} !`;
                finalBody    = `Bonjour ${nomClient},\n\nDe nouveaux produits viennent d'arriver ! Venez découvrir notre sélection qui pourrait vous plaire.`;
                category     = 'regular';
            }

            stats[category]++;
            campaignToSend = {
                subject: finalSubject,
                body: finalBody,
                category: category
            };
        }

        if (campaignToSend) {
            let status = 'simulated_auto';
            try {
                const emailResult = await sendEmail({
                    to: clientEmail,
                    subject: campaignToSend.subject,
                    text: campaignToSend.body
                });
                status = emailResult.status === 'sent' ? 'sent_auto' : 'simulated_auto';
            } catch (err) {
                console.error(`❌ Échec de l'envoi d'e-mail automatique IA à ${clientEmail} :`, err.message);
                status = 'failed_auto';
            }

            campaignsToInsert.push({
                commerce_id: commerceId,
                client_email: clientEmail,
                client_nom: nomClient,
                segment: client.segment_gmm || 'unknown',
                churn_score: churnScore,
                churn_risk_label: churnRiskLabel,
                subject: campaignToSend.subject,
                body: campaignToSend.body,
                sent_at: sentAt,
                status: status,
                category: campaignToSend.category
            });

            console.log(`🤖 [AUTO IA] Décision: ${campaignToSend.category.toUpperCase()} | GMM: ${client.segment_gmm} | Churn: ${churnRiskLabel} (${(churnScore*100).toFixed(0)}%) | Statut: ${status} → ${nomClient}`);
        }
    });

    await Promise.all(promises);

    // 5. Sauvegarder massivement
    if (campaignsToInsert.length > 0) {
        await db.collection('campagnes_envoyees').insertMany(campaignsToInsert);
    }

    return {
        status: 'success',
        message: `Automatisation IA terminée. ${campaignsToInsert.length} e-mails générés sur-mesure !`,
        stats
    };
};

const triggerSmartAutomation = async (req, res) => {
    const commerceId = req.body.commerce_id || COMMERCE_ID;

    try {
        const result = await runSmartAutomationInternal(commerceId);
        return res.json(result);
    } catch (err) {
        console.error('❌ triggerSmartAutomation error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/commerces
// Retourne la liste de tous les commerce_id disponibles dans la base.
// ============================================================
const getCommerces = async (req, res) => {
    try {
        const db = await connectDB();
        
        // Récupérer tous les commerce_id distincts depuis la collection clients
        const commerceIds = await db.collection('clients').distinct('commerce_id');
        
        const commerceLabels = {
            'commerce_local': 'Boutique Tunis (Local)',
            'commerce_local_1': 'Boutique Tunis (Local 1)',
            'commerce_local_2': 'Boutique Sousse (Local 2)'
        };

        const commerces = commerceIds.map(id => {
            let label = commerceLabels[id];
            if (!label) {
                label = 'Boutique ' + id.replace('commerce_', '').replace('_', ' ').replace(/\b\w/g, char => char.toUpperCase());
            }
            return { id, label };
        });
        
        return res.json(commerces);
    } catch (err) {
        console.error('❌ getCommerces error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// Comparateur Global de Boutiques
// ============================================================
const getGlobalComparison = async (req, res) => {
    try {
        const db = await connectDB();

        // Noms lisibles des commerces
        const commerceLabels = {
            'commerce_local': 'Tunis (Local)',
            'commerce_local_1': 'Tunis',
            'commerce_local_2': 'Sousse'
        };

        // Agrégation complète par commerce_id depuis analyses_ia
        const stats = await db.collection('analyses_ia').aggregate([
            {
                $group: {
                    _id: '$commerce_id',
                    nb_clients:       { $sum: 1 },
                    ca_total:         { $sum: '$monetary_total' },
                    panier_moyen:     { $avg: '$monetary' },
                    churn_moyen:      { $avg: '$churn_score' },
                    recence_moyenne:  { $avg: '$recency' },
                    freq_moyenne:     { $avg: '$frequency' },
                    score_sa_moyen:   { $avg: '$score_global_sa' },
                    vip_count:      { $sum: { $cond: [{ $eq: ['$segment_gmm', 'vip'] },      1, 0] } },
                    regular_count:  { $sum: { $cond: [{ $eq: ['$segment_gmm', 'regular'] },  1, 0] } },
                    at_risk_count:  { $sum: { $cond: [{ $eq: ['$segment_gmm', 'at_risk'] },  1, 0] } },
                    lost_count:     { $sum: { $cond: [{ $eq: ['$segment_gmm', 'lost'] },     1, 0] } },
                    // Churn critique = churn_score >= 0.75
                    critical_churn_count: { $sum: { $cond: [{ $gte: ['$churn_score', 0.75] }, 1, 0] } },
                    // Ambassadeurs = influence_score >= 80
                    ambassador_count: { $sum: { $cond: [{ $gte: ['$influence_score', 80] }, 1, 0] } }
                }
            },
            { $sort: { ca_total: -1 } }
        ]).toArray();

        // Enrichir avec les noms lisibles
        const result = stats.map(s => {
            let label = commerceLabels[s._id];
            if (!label) {
                // Nettoyage générique de l'ID (ex: commerce_local_3 -> Local 3, commerce_sf -> Sf)
                label = s._id.replace('commerce_', '').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
            }
            return {
                ...s,
                label,
                churn_moyen_pct:    Math.round(s.churn_moyen * 1000) / 10,
                score_sa_moyen_pct: Math.round(s.score_sa_moyen * 1000) / 10,
                ca_total:           Math.round(s.ca_total * 100) / 100,
                panier_moyen:       Math.round(s.panier_moyen * 100) / 100,
                recence_moyenne:    Math.round(s.recence_moyenne * 10) / 10,
                freq_moyenne:       Math.round(s.freq_moyenne * 10) / 10
            };
        });

        return res.json({ status: 'success', data: result });
    } catch (err) {
        console.error('❌ getGlobalComparison error :', err.message);
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
    triggerSmartAutomation,
    runSmartAutomationInternal,
    getCommerces,
    getGlobalComparison
};
