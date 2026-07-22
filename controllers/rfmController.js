const { spawn } = require('child_process');
const path       = require('path');
const crypto     = require('crypto');
const { ObjectId } = require('mongodb');
const connectDB  = require('../config/db');
const { sendEmail } = require('../utils/emailService');

const COMMERCE_ID   = process.env.COMMERCE_ID   || 'commerce_local_1';
const PYTHON_PATH   = process.env.PYTHON_PATH   || 'python';

// ============================================================
// 🧪 CONFIG MODE TEST : liste des emails autorisés en mode 5 minutes
// Modifier cette liste pour ajouter/retirer des destinataires de test.
// En mode production (7j/14j/21j/30j), ce filtre ne s'applique PAS.
// ============================================================
const TEST_MODE_EMAILS = [
    'ghofrane.khadhar@gmail.com',
    // Ajoutez un 2ème email de test ici si besoin :
    // 'autre.email@exemple.com',
];
// Seuil de détection du mode test : cooldown_days ≤ cette valeur
const TEST_MODE_THRESHOLD_DAYS = 0.01; // 0.01 jour = ~14 minutes

// ============================================================
// 📊 CACHE EN MÉMOIRE & SÉCURITÉ TRACKING
// ============================================================
const statsCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const clearStatsCache = () => {
    statsCache.clear();
};

const generateTrackingId = () => {
    return crypto.randomBytes(16).toString('hex'); // Jetons aléatoires 32 caractères non devinables
};

const generateBatchId = (prefix = 'CMP') => {
    const dateStr = new Date().toISOString().replace(/[-:T.]/g, '').slice(0, 14);
    const randHex = crypto.randomBytes(3).toString('hex');
    return `${prefix}-${dateStr}-${randHex}`;
};


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

        // Récupérer tous les soldes de points de fidélité pour ce commerce
        const loyaltyBalances = await db.collection('points_fidelite')
            .find({ commerce_id: commerceId })
            .toArray();

        // Créer une map pour accès rapide par email
        const loyaltyMap = new Map();
        loyaltyBalances.forEach(lb => {
            if (lb.client_email) {
                loyaltyMap.set(lb.client_email.toLowerCase(), lb);
            }
        });

        // Récupérer la liste des clients pour synchroniser l'état RGPD opt-out
        const clientsDocs = await db.collection('clients')
            .find({ commerce_id: commerceId })
            .toArray();
        const clientRgpdMap = new Map();
        clientsDocs.forEach(c => {
            if (c.email) {
                clientRgpdMap.set(c.email.toLowerCase(), c);
            }
        });

        // Convertir ObjectId en chaîne et attacher points_cumules + status RGPD
        records.forEach(r => {
            if (r._id) r._id = r._id.toString();
            if (r.email) {
                const loyalty = loyaltyMap.get(r.email.toLowerCase());
                r.points_cumules = loyalty ? (loyalty.points_cumules || 0) : 0;

                const clientDoc = clientRgpdMap.get(r.email.toLowerCase());
                if (clientDoc) {
                    r.rgpd_opt_out = clientDoc.rgpd_opt_out === true;
                    if (clientDoc.rgpd_opt_out_date) r.rgpd_opt_out_date = clientDoc.rgpd_opt_out_date;
                }
            } else {
                r.points_cumules = 0;
            }
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
                const customId = clientDoc.id;
                const mongoId = clientDoc._id.toString();
                
                const orFilter2 = [];
                if (customId) orFilter2.push({ client_id: customId });
                orFilter2.push({ client_id: mongoId });
                if (ObjectId.isValid(mongoId)) {
                    orFilter2.push({ client_id: new ObjectId(mongoId) });
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

        const normalizedEmail = email.toLowerCase().trim();

        // Vérification RGPD
        const client = await db.collection('clients').findOne({ email: email, commerce_id: commerceId });
        if (client && (client.rgpd_opt_out === true || client.rgpd_opt_out_marketing === true)) {
            return res.status(400).json({ error: `Le client ${email} s'est désabonné du ciblage marketing (RGPD).` });
        }

        const trackingId = generateTrackingId();
        const batchId = generateBatchId('IND');

        // Envoi réel ou simulation via le service emailService avec tracking
        const result = await sendEmail({
            to: normalizedEmail,
            subject,
            text: body,
            trackingId
        });

        const campaignDoc = {
            commerce_id       : commerceId,
            client_email      : normalizedEmail,
            client_nom        : nom || email,
            segment           : segment || 'unknown',
            subject,
            body,
            sent_at           : new Date().toISOString(),
            status            : result.status, // 'sent' ou 'simulated'
            tracking_id       : trackingId,
            campaign_batch_id : batchId,
            opened            : false,
            open_count        : 0
        };

        // Persistance dans MongoDB
        await db.collection('campagnes_envoyees').insertOne(campaignDoc);
        clearStatsCache();

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
        const query = {};
        
        if (email && email !== '__all__') {
            query.client_email = email;
        }
        
        if (commerceId && commerceId !== '__all__') {
            query.commerce_id = commerceId;
        }

        const history = await db.collection('campagnes_envoyees')
            .find(query)
            .sort({ sent_at: -1 })
            .limit(100) // limit to last 100 entries for performance
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
    const { clients, subject, body, commerce_id, filters } = req.body || {};
    const commerceId = commerce_id || COMMERCE_ID;

    if ((!clients || !Array.isArray(clients) || clients.length === 0) && !filters) {
        return res.status(400).json({ error: 'Champs requis manquants : clients (array) ou filters.' });
    }
    if (!subject || !body) {
        return res.status(400).json({ error: 'Champs requis manquants : subject, body.' });
    }

    try {
        const db = await connectDB();

        // 1. Récupérer les infos RGPD depuis la collection clients
        const clientsDb = await db.collection('clients')
            .find({
                commerce_id: commerceId,
                $or: [
                    { rgpd_opt_out: true },
                    { rgpd_opt_out_marketing: true }
                ]
            }, { projection: { email: 1 } })
            .toArray();
        const rgpdOptOutSet = new Set(
            clientsDb.map(c => c.email ? c.email.toLowerCase() : '').filter(Boolean)
        );

        // 2. Déterminer la liste de base des clients
        let rawClients = clients || [];
        if (rawClients.length === 0) {
            // Si pas de liste passée, récupérer tous les clients de la boutique
            const dbAnalyses = await db.collection('analyses_ia').find({ commerce_id: commerceId }).toArray();
            rawClients = dbAnalyses.map(c => ({
                email: c.email || c.client_db_id,
                nom: c.nom || c.email || c.client_db_id,
                segment: c.segment_gmm || 'group'
            }));
        }

        // 3. Exclure systématiquement les clients ayant désactivé le ciblage (RGPD)
        let filteredClientsList = rawClients.filter(c => c.email && !rgpdOptOutSet.has(c.email.toLowerCase()));

        // 4. Appliquer les filtres de ciblage supplémentaires s'ils sont fournis
        if (filters) {
            const { onlyBaisse, onlyAmbassadors, segment_gmm, close_to_palier } = filters;
            
            const dbAnalyses = await db.collection('analyses_ia').find({ commerce_id: commerceId }).toArray();
            const clientStatsMap = {};
            dbAnalyses.forEach(c => {
                if (c.email) clientStatsMap[c.email.toLowerCase()] = c;
            });

            let closeEmails = new Set();
            if (close_to_palier) {
                const loyaltyDocs = await db.collection('points_fidelite').find({
                    commerce_id: commerceId,
                    $or: [
                        { points_cumules: { $gte: 80, $lt: 100 } },
                        { points_cumules: { $gte: 180, $lt: 200 } }
                    ]
                }).toArray();
                closeEmails = new Set(loyaltyDocs.map(d => d.client_email.toLowerCase()));
            }

            filteredClientsList = filteredClientsList.filter(c => {
                const emailLower = c.email ? c.email.toLowerCase() : '';
                const stats = clientStatsMap[emailLower];
                if (!stats) return false;

                if (onlyBaisse && stats.baisse_frequence_detectee !== true) return false;
                if (segment_gmm && segment_gmm !== 'all' && stats.segment_gmm !== segment_gmm) return false;
                if (close_to_palier && !closeEmails.has(emailLower)) return false;

                if (onlyAmbassadors) {
                    const scoreInfluence = stats.influence_score !== undefined
                        ? stats.influence_score
                        : Math.round(((stats.score_global_sa || 0) * 0.7 + (1.0 - (stats.churn_score || 0)) * 0.3) * 100);
                    if (scoreInfluence < 80) return false;
                }
                return true;
            });
        }

        if (filteredClientsList.length === 0) {
            return res.json({
                status: 'success',
                message: "Aucun client ne correspond aux critères de filtrage ou tous se sont désabonnés (RGPD)."
            });
        }

        const sentAt = new Date().toISOString();
        const campaignsToInsert = [];
        const batchId = generateBatchId('GRP');

        // Envoi parallèle
        const sendPromises = filteredClientsList.map(async (client) => {
            const finalSubject = subject.replace(/{nom}/g, client.nom || client.email);
            const finalBody = body.replace(/{nom}/g, client.nom || client.email);
            const trackingId = generateTrackingId();
            const normalizedEmail = (client.email || '').toLowerCase().trim();

            let status = 'simulated_batch';
            try {
                const emailResult = await sendEmail({
                    to: normalizedEmail,
                    subject: finalSubject,
                    text: finalBody,
                    trackingId
                });
                status = emailResult.status === 'sent' ? 'sent_batch' : 'simulated_batch';
            } catch (err) {
                console.error(`❌ Échec de l'envoi d'e-mail groupé à ${normalizedEmail} :`, err.message);
                status = 'failed_batch';
            }

            campaignsToInsert.push({
                commerce_id: commerceId,
                client_email: normalizedEmail,
                client_nom: client.nom || client.email,
                segment: client.segment || 'group',
                subject: finalSubject,
                body: finalBody,
                sent_at: sentAt,
                status: status,
                tracking_id: trackingId,
                campaign_batch_id: batchId,
                opened: false,
                open_count: 0
            });
        });

        await Promise.all(sendPromises);

        if (campaignsToInsert.length > 0) {
            await db.collection('campagnes_envoyees').insertMany(campaignsToInsert);
            clearStatsCache();
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
    const stats = { ambassador_invite: 0, birthday_gift: 0, vip_danger: 0, vip: 0, regular: 0, baisse_frequence: 0, at_risk: 0, lost: 0, skipped_cooldown: 0 };

    // 2. Déterminer la durée de cooldown au niveau MARQUE
    // (tous les points de vente de la même marque partagent le même réglage)
    let cooldownDays = 30;
    let cooldownResetAt = null; // Date de la dernière réinitialisation manuelle du cooldown
    try {
        const brandId = commerceId.replace(/_\d+$/, ''); // ex: commerce_local_1 → commerce_local
        const settings = await db.collection('commerces_settings').findOne({ brand_id: brandId });
        if (settings && settings.cooldown_days !== undefined) {
            cooldownDays = parseFloat(settings.cooldown_days) || 30;
        }
        // Récupérer la date de réinitialisation manuelle si elle existe
        if (settings && settings.cooldown_reset_at) {
            cooldownResetAt = new Date(settings.cooldown_reset_at);
        }
        console.log(`[SmartAutomation] Cooldown marque "${brandId}" : ${cooldownDays} jours${cooldownResetAt ? ` | Réinitialisé le ${cooldownResetAt.toLocaleString('fr-FR')}` : ''}`);
    } catch (err) {
        console.warn(`[SmartAutomation] Impossible de lire les paramètres de cooldown, défaut 30j:`, err.message);
    }

    const cooldownMs = cooldownDays * 24 * 60 * 60 * 1000;
    const cooldownWindowStart = new Date(Date.now() - cooldownMs);

    // Si une réinitialisation manuelle a eu lieu APRÈS la fenêtre de cooldown calculée,
    // on utilise la date de reset comme borne inférieure (les emails avant le reset sont ignorés
    // dans le calcul du cooldown, mais restent intacts dans la base).
    const effectiveCooldownStart = (cooldownResetAt && cooldownResetAt > cooldownWindowStart)
        ? cooldownResetAt
        : cooldownWindowStart;

    // Récupérer les campagnes envoyées depuis la borne effective pour le cooldown anti-spam
    // EXCLUSION INTENTIONNELLE : birthday_gift et ambassador_invite ne comptent PAS dans ce cooldown
    const recentCampaigns = await db.collection('campagnes_envoyees')
        .find({
            commerce_id: commerceId,
            sent_at: { $gte: effectiveCooldownStart.toISOString() },
            category: { $nin: ['birthday_gift', 'ambassador_invite'] } // ces catégories ont leur propre anti-doublon
        })
        .toArray();

    // Map email -> date du dernier envoi de campagne promotionnelle/automatique
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

    // 2b. RGPD : récupérer les clients ayant désactivé le ciblage marketing
    const rgpdClients = await db.collection('clients')
        .find({
            commerce_id: commerceId,
            $or: [
                { rgpd_opt_out: true },
                { rgpd_opt_out_marketing: true }
            ]
        }, { projection: { email: 1 } })
        .toArray();
    const rgpdOptOutSet = new Set(rgpdClients.map(c => c.email ? c.email.toLowerCase() : '').filter(Boolean));

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

    // ============================================================
    // 🧪 FILTRE MODE TEST : si cooldown ≤ 0.01j, limiter aux emails de test
    // En mode production (7j/14j/21j/30j), tous les clients sont traités.
    // ============================================================
    const isTestMode = cooldownDays <= TEST_MODE_THRESHOLD_DAYS;
    let clientsToProcess = clients;

    if (isTestMode) {
        const testEmailsSet = new Set(TEST_MODE_EMAILS.map(e => e.toLowerCase()));
        const allEligible = clients.filter(c => (c.email || c.client_db_id));
        clientsToProcess = allEligible.filter(c => {
            const email = (c.email || c.client_db_id || '').toLowerCase();
            return testEmailsSet.has(email);
        });
        const skippedCount = allEligible.length - clientsToProcess.length;
        console.log(`🧪 [TEST MODE] Filtrage actif : envoi limité à ${clientsToProcess.length} client(s) de test (${TEST_MODE_EMAILS.join(', ')}) — ${skippedCount} autres clients éligibles ignorés pour ce cycle.`);

        if (clientsToProcess.length === 0) {
            console.warn(`🧪 [TEST MODE] Aucun client de test trouvé dans commerce "${commerceId}" — vérifiez que l'email est bien dans la base et la collection analyses_ia.`);
            return { status: 'info', message: 'Mode test : aucun client de test trouvé dans ce commerce.', stats };
        }
    } else {
        console.log(`⚙️ [PRODUCTION MODE] Traitement de ${clients.length} clients (cooldown: ${cooldownDays}j) — filtre test désactivé.`);
    }

    for (const client of clientsToProcess) {
        const clientEmail = client.email || client.client_db_id;
        if (!clientEmail) continue;

        // --- GARDE RGPD : exclure les clients ayant désactivé le ciblage marketing ---
        // NOTE : les e-mails transactionnels (confirmation commande, crédit points) ne passent
        // pas par cet automatiseur et ne sont donc pas affectés par ce garde.
        if (rgpdOptOutSet.has(clientEmail.toLowerCase())) continue;

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
            continue; // Ne pas envoyer d'autre email ce cycle à cet ambassadeur
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
                continue;
            }

            // --- REGLE 3 : DÉCISIONS IA COMBINÉES (GMM + XGBOOST CHURN) ---
            let probs = client.probabilities_gmm;
            if (Array.isArray(probs)) probs = probs[0] || probs;
            
            if (!probs || typeof probs !== 'object') continue; // Passer si pas de GMM

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
            // Règle 8.5 : Baisse de Fréquence détectée (Δ < -25%) — client encore "regular" par GMM
            // ANTI-CHEVAUCHEMENT : cette règle ne s'applique QUE si le segment GMM est 'regular'.
            // Si le client est déjà 'at_risk' ou 'lost', les règles 4-7 ci-dessus ont déjà géré
            // son cas avec une offre plus agressive. Pas de double envoi.
            else if (client.baisse_frequence_detectee === true && client.segment_gmm === 'regular') {
                const deltaPct = client.delta_frequence ? Math.round(Math.abs(client.delta_frequence) * 100) : 25;
                finalSubject = `${nomClient}, on vous a remarqué 👀 — une offre pour vous fidéliser`;
                finalBody    = `Bonjour ${nomClient},\n\nNous avons remarqué que vos achats ont baissé de ${deltaPct}% ce dernier mois. Nous ne voulons pas vous perdre !\n\nPour vous remercier de votre fidélité passée, voici une remise de 15% sur votre prochain achat avec le code : FIDELITE15.\n\nCette offre est valable 14 jours. N'hésitez pas à en profiter !\n\nL'équipe Retenza 💛`;
                category     = 'baisse_frequence';
                console.log(`🤖 [AUTO IA] 📉 BAISSE FRÉQUENCE détectée : Δ=-${deltaPct}% pour ${nomClient} (${clientEmail}) — segment GMM: ${client.segment_gmm}`);
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
        
        // Délai de 50ms entre chaque envoi pour soulager le serveur SMTP
        await new Promise(resolve => setTimeout(resolve, 50));
    }

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

// État en mémoire de la dernière automatisation (pour le polling)
const automationStatus = {
    running: false,
    lastResult: null,
    lastError: null,
    startedAt: null,
    commerceId: null
};

// GET /api/campaigns/automation-status — Polling du statut de l'automatisation en cours
const getAutomationStatus = (req, res) => {
    return res.json({
        status: 'success',
        running: automationStatus.running,
        startedAt: automationStatus.startedAt,
        result: automationStatus.lastResult,
        error: automationStatus.lastError
    });
};

const triggerSmartAutomation = async (req, res) => {
    const commerceId = req.body.commerce_id || COMMERCE_ID;

    // Si une automatisation tourne déjà, on refuse
    if (automationStatus.running) {
        return res.status(409).json({
            status: 'busy',
            message: 'Une automatisation est déjà en cours. Veuillez patienter.',
            startedAt: automationStatus.startedAt
        });
    }

    // Répondre IMMÉDIATEMENT au client — le bouton se débloque tout de suite
    automationStatus.running = true;
    automationStatus.lastResult = null;
    automationStatus.lastError = null;
    automationStatus.startedAt = new Date().toISOString();
    automationStatus.commerceId = commerceId;

    res.status(202).json({
        status: 'started',
        message: 'Automatisation IA lancée en arrière-plan. Vérifiez le statut dans quelques instants.',
        startedAt: automationStatus.startedAt
    });

    // Exécuter l'automatisation EN ARRIÈRE-PLAN (après réponse HTTP)
    runSmartAutomationInternal(commerceId)
        .then(result => {
            automationStatus.running = false;
            automationStatus.lastResult = result;
            console.log(`✅ [AUTO IA] Terminé : ${result.message}`);
        })
        .catch(err => {
            automationStatus.running = false;
            automationStatus.lastError = err.message;
            console.error('❌ triggerSmartAutomation background error :', err.message);
        });
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
                    ambassador_count: { $sum: { $cond: [{ $gte: ['$influence_score', 80] }, 1, 0] } },
                    // Clients avec baisse de fréquence d'achat (Option A)
                    baisse_freq_count: { $sum: { $cond: [{ $eq: ['$baisse_frequence_detectee', true] }, 1, 0] } }
                }
            },
            { $sort: { ca_total: -1 } }
        ]).toArray();

        // Charger les KPIs de boutique (pour le Taux de Retour Client) (Option A)
        const kpis = await db.collection('kpis_boutiques').find().toArray();

        // Agrégation de la fidélité par commerce (Option A)
        const loyaltyStats = await db.collection('points_fidelite').aggregate([
            {
                $group: {
                    _id: '$commerce_id',
                    total_cumules: { $sum: '$points_cumules' },
                    total_disponibles: { $sum: '$points_disponibles' },
                    total_utilises: { $sum: '$points_utilises' },
                    nb_membres: { $sum: 1 }
                }
            }
        ]).toArray();

        // Enrichir avec les noms lisibles et les nouvelles données
        const result = stats.map(s => {
            let label = commerceLabels[s._id];
            if (!label) {
                // Nettoyage générique de l'ID (ex: commerce_local_3 -> Local 3, commerce_sf -> Sf)
                label = s._id.replace('commerce_', '').replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase());
            }

            // Récupérer le taux de retour
            const kpi = kpis.find(k => k.commerce_id === s._id);
            const taux_retour = kpi ? kpi.taux_retour_30j : 0;

            // Récupérer les stats de fidélité
            const loyalty = loyaltyStats.find(l => l._id === s._id);
            const loyalty_points = loyalty ? loyalty.total_cumules : 0;
            const loyalty_membres = loyalty ? loyalty.nb_membres : 0;

            return {
                ...s,
                label,
                churn_moyen_pct:    Math.round(s.churn_moyen * 1000) / 10,
                score_sa_moyen_pct: Math.round(s.score_sa_moyen * 1000) / 10,
                ca_total:           Math.round(s.ca_total * 100) / 100,
                panier_moyen:       Math.round(s.panier_moyen * 100) / 100,
                recence_moyenne:    Math.round(s.recence_moyenne * 10) / 10,
                freq_moyenne:       Math.round(s.freq_moyenne * 10) / 10,
                taux_retour_pct:    Math.round(taux_retour * 100) / 100, // Déjà en % dans kpis_boutiques
                baisse_freq_count:  s.baisse_freq_count || 0,
                loyalty_points:     loyalty_points,
                loyalty_membres:    loyalty_membres
            };
        });

        return res.json({ status: 'success', data: result });
    } catch (err) {
        console.error('❌ getGlobalComparison error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/kpis/return-rate?commerce_id=...
// Retourne le Taux de Retour Client (Tr) de la boutique.
// ============================================================
const getReturnRate = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;

    try {
        const db = await connectDB();
        const kpi = await db.collection('kpis_boutiques').findOne({ commerce_id: commerceId });

        if (!kpi) {
            return res.json({
                status: 'success',
                data: {
                    commerce_id: commerceId,
                    taux_retour_30j: 0.0,
                    clients_actifs_30j: 0,
                    clients_revenus_30j: 0,
                    date_calcul: new Date().toISOString()
                }
            });
        }

        if (kpi._id) kpi._id = kpi._id.toString();

        return res.json({
            status: 'success',
            data: kpi
        });
    } catch (err) {
        console.error('❌ getReturnRate error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/recommendations?commerce_id=...
// Renvoie des recommandations IA rule-based pour la boutique.
// - Si Tr < 50% → suggérer campagne fidélité
// - Si baisse fréquence > 20% des réguliers → suggérer campagne baisse fréquence
// - Si clients proches d'un palier (80-99 ou 180-199 pts) → suggérer boost points
// ============================================================
const getRecommendations = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    try {
        const db = await connectDB();
        const recommendations = [];

        // --- Règle 1 : Taux de Retour Client (Tr) ---
        const kpi = await db.collection('kpis_boutiques').findOne({ commerce_id: commerceId });
        const tr = kpi ? (kpi.taux_retour_30j || 0) : 0;
        if (tr < 50) {
            recommendations.push({
                id: 'low_return_rate',
                type: 'warning',
                priority: 1,
                title: 'Taux de retour client faible',
                message: `Votre taux de retour est de ${tr.toFixed(1)}% sur les 30 derniers jours (seuil recommandé : 50%). Activez le programme de fidélité ou lancez une campagne de rétention.`,
                action: {
                    label: 'Lancer une campagne fidélité',
                    filters: { segment_gmm: 'regular' }
                }
            });
        }

        // --- Règle 2 : Baisse de Fréquence ---
        const analyses = await db.collection('analyses_ia').find({ commerce_id: commerceId }).toArray();
        const total = analyses.length;
        const regularClients = analyses.filter(c => c.segment_gmm === 'regular');
        const baisseCount = analyses.filter(c => c.baisse_frequence_detectee === true).length;
        const baissePct = total > 0 ? (baisseCount / total) * 100 : 0;

        if (baissePct > 20) {
            recommendations.push({
                id: 'freq_drop',
                type: 'alert',
                priority: 2,
                title: 'Baisse de fréquence détectée',
                message: `${baisseCount} clients (${baissePct.toFixed(1)}% du total) ont baissé leurs achats de plus de 25% ce mois-ci. Recommandation : lancez une campagne "Baisse de Fréquence" ciblée.`,
                action: {
                    label: 'Lancer campagne Baisse de Fréquence',
                    filters: { onlyBaisse: true }
                }
            });
        }

        // --- Règle 3 : Clients proches d'un palier de fidélité (80-99 pts OU 180-199 pts) ---
        // Bornes : [80, 100[ et [180, 200[ — les seuils exacts 100 et 200 sont déjà débloqués.
        const closeToPalierDocs = await db.collection('points_fidelite').find({
            commerce_id: commerceId,
            $or: [
                { points_cumules: { $gte: 80, $lt: 100 } },
                { points_cumules: { $gte: 180, $lt: 200 } }
            ]
        }).toArray();

        if (closeToPalierDocs.length > 0) {
            recommendations.push({
                id: 'close_to_tier',
                type: 'opportunity',
                priority: 3,
                title: 'Clients proches d\'un palier de fidélité',
                message: `${closeToPalierDocs.length} client(s) sont à moins de 20 points du prochain palier de réduction (FID10 ou FID20). Un email de motivation pourrait déclencher un achat.`,
                action: {
                    label: 'Envoyer un boost de points',
                    filters: { close_to_palier: true }
                }
            });
        }

        // Trier par priorité croissante
        recommendations.sort((a, b) => a.priority - b.priority);

        return res.json({
            status: 'success',
            commerce_id: commerceId,
            count: recommendations.length,
            data: recommendations,
            meta: {
                total_clients: total,
                tr_30j: tr,
                baisse_freq_pct: parseFloat(baissePct.toFixed(1)),
                close_to_palier_count: closeToPalierDocs.length
            }
        });
    } catch (err) {
        console.error('❌ getRecommendations error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/rgpd/opt-out
// Marque le client comme ayant désactivé le ciblage marketing.
// NOTE IMPORTANTE : Cette action bloque UNIQUEMENT les campagnes marketing
// automatiques et groupées. Les e-mails transactionnels (confirmation de
// commande, crédit de points de fidélité, etc.) ne sont PAS concernés car
// ils ne passent pas par le moteur d'automatisation.
// ============================================================
const optOutRGPD = async (req, res) => {
    const { email, commerce_id, target = 'both' } = req.body || {};
    const commerceId = commerce_id || COMMERCE_ID;

    if (!email) {
        return res.status(400).json({ error: 'Champ requis manquant : email.' });
    }

    try {
        const db = await connectDB();
        const nowStr = new Date().toISOString();

        const updatePayload = {
            rgpd_opt_out_date: nowStr
        };

        if (target === 'marketing' || target === 'both') {
            updatePayload.rgpd_opt_out_marketing = true;
            updatePayload.rgpd_opt_out = true; // backward compatibility
        }
        if (target === 'profiling' || target === 'both') {
            updatePayload.rgpd_opt_out_profiling = true;
        }

        const result = await db.collection('clients').updateOne(
            { email: email, commerce_id: commerceId },
            { $set: updatePayload },
            { upsert: true }
        );

        await db.collection('analyses_ia').updateMany(
            { email: email, commerce_id: commerceId },
            { $set: updatePayload }
        );

        return res.json({
            status: 'success',
            message: `Préférences RGPD mises à jour pour ${email} (Opt-Out appliqué sur : ${target}).`,
            matched: result.matchedCount,
            modified: result.modifiedCount
        });
    } catch (err) {
        console.error('❌ optOutRGPD error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/rgpd/opt-in
// Marque le client comme ayant réactivé les préférences RGPD.
// ============================================================
const optInRGPD = async (req, res) => {
    const { email, commerce_id, target = 'both' } = req.body || {};
    const commerceId = commerce_id || COMMERCE_ID;

    if (!email) {
        return res.status(400).json({ error: 'Champ requis manquant : email.' });
    }

    try {
        const db = await connectDB();
        const updatePayload = {};

        if (target === 'marketing' || target === 'both') {
            updatePayload.rgpd_opt_out_marketing = false;
            updatePayload.rgpd_opt_out = false;
        }
        if (target === 'profiling' || target === 'both') {
            updatePayload.rgpd_opt_out_profiling = false;
        }

        const result = await db.collection('clients').updateOne(
            { email: email, commerce_id: commerceId },
            { $set: updatePayload },
            { upsert: true }
        );

        await db.collection('analyses_ia').updateMany(
            { email: email, commerce_id: commerceId },
            { $set: updatePayload }
        );

        return res.json({
            status: 'success',
            message: `Préférences RGPD réactivées pour ${email} (${target}).`,
            matched: result.matchedCount,
            modified: result.modifiedCount
        });
    } catch (err) {
        console.error('❌ optInRGPD error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// Helper : extraire l'ID de la marque à partir du commerce_id
// Ex : commerce_local_1  →  commerce_local
//      commerce_local_2  →  commerce_local
//      boutique_paris    →  boutique_paris  (pas de numéro)
// ============================================================
const extractBrandId = (commerceId) => {
    if (!commerceId) return commerceId;
    return commerceId.replace(/_\d+$/, '');
};

// ============================================================
// GET /api/commerces/settings?commerce_id=...
// Récupère les paramètres de la MARQUE (tous ses points de vente
// partagent le même réglage).
// ============================================================
const getCommerceSettings = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    const brandId = extractBrandId(commerceId); // ex: commerce_local
    try {
        const db = await connectDB();
        let settings = await db.collection('commerces_settings').findOne({ brand_id: brandId });
        if (!settings) {
            settings = { brand_id: brandId, cooldown_days: 30 };
        }
        if (settings._id) settings._id = settings._id.toString();
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.json({ status: 'success', data: settings });
    } catch (err) {
        console.error('❌ getCommerceSettings error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/commerces/settings
// Enregistre les paramètres au niveau de la MARQUE.
// Tous les points de vente de cette marque hériteront
// automatiquement du même réglage.
// ============================================================
const updateCommerceSettings = async (req, res) => {
    const {
        commerce_id,
        cooldown_days,
        shop_anniversary_mode,
        shop_anniversary_date,
        shop_anniversary_by_boutique,
        shop_anniversary_discount_percent,
        shop_anniversary_promo_code
    } = req.body || {};
    const commerceId = commerce_id || COMMERCE_ID;
    const brandId = extractBrandId(commerceId);
    const days = parseFloat(cooldown_days) || 30;
    const resetAt = new Date().toISOString();

    const $setFields = {
        brand_id: brandId,
        cooldown_days: days,
        cooldown_reset_at: resetAt,
        updated_at: resetAt
    };

    // Champs anniversaire boutique (optionnels — on ne les écrase que s'ils sont fournis)
    if (shop_anniversary_mode !== undefined) {
        $setFields.shop_anniversary_mode = shop_anniversary_mode;
    }
    if (shop_anniversary_date !== undefined) {
        $setFields.shop_anniversary_date = shop_anniversary_date;
    }
    if (shop_anniversary_by_boutique !== undefined) {
        $setFields.shop_anniversary_by_boutique = shop_anniversary_by_boutique;
    }

    // Offre promo anniversaire boutique
    if (shop_anniversary_discount_percent !== undefined) {
        const pct = Math.min(100, Math.max(1, Math.round(parseFloat(shop_anniversary_discount_percent) || 15)));
        $setFields.shop_anniversary_discount_percent = pct;
    }
    if (shop_anniversary_promo_code !== undefined) {
        const raw = String(shop_anniversary_promo_code).trim();
        const sanitized = raw.replace(/[^A-Z0-9a-z\-]/g, '').toUpperCase().substring(0, 30);
        $setFields.shop_anniversary_promo_code = sanitized || 'ANNIVBOUTIQUE';
    }

    // Seuils de détection de fraude configurables
    if (req.body.fraud_max_daily_purchases !== undefined) {
        const val = Math.min(100, Math.max(1, parseInt(req.body.fraud_max_daily_purchases, 10) || 5));
        $setFields.fraud_max_daily_purchases = val;
    }
    if (req.body.fraud_max_basket_multiplier !== undefined) {
        const val = Math.min(10, Math.max(1.5, parseFloat(req.body.fraud_max_basket_multiplier) || 3.0));
        $setFields.fraud_max_basket_multiplier = val;
    }

    try {
        const db = await connectDB();
        await db.collection('commerces_settings').updateOne(
            { brand_id: brandId },
            { $set: $setFields },
            { upsert: true }
        );
        console.log(`⚙️ [SETTINGS] Cooldown réinitialisé pour "${brandId}" à ${resetAt} (${days}j)`);
        return res.json({ 
            status: 'success', 
            message: `Paramètres de la marque "${brandId}" mis à jour. Délai de relance réglé sur ${days} jours. Tous les clients sont à nouveau éligibles.`, 
            brand_id: brandId,
            cooldown_days: days,
            cooldown_reset_at: resetAt
        });
    } catch (err) {
        console.error('❌ updateCommerceSettings error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// sendShopAnniversaryCampaign(commerceId, db)
// Déclenche les campagnes anniversaire boutique pour 3 paliers
// indépendants : J-7, J-3, J-1 avant la date d'anniversaire.
// Les 3 paliers partagent le même code promo et le même taux
// de réduction, lus dynamiquement depuis commerces_settings.
// Anti-doublon par palier via trigger_stage dans campagnes_envoyees.
// ============================================================

// Définitions des paliers : seule la mise en forme temporelle varie
const SHOP_ANNIVERSARY_STAGE_DEFS = [
    { stage: 'J-7', daysOffset: 7 },
    { stage: 'J-3', daysOffset: 3 },
    { stage: 'J-1', daysOffset: 1 }
];

/**
 * Formate une date MM-DD en libellé lisible (ex: "03-15" -> "15 mars").
 */
function formatAnniversaryDate(mmDd) {
    try {
        const [mm, dd] = mmDd.split('-').map(Number);
        const d = new Date(Date.UTC(2000, mm - 1, dd));
        return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    } catch { return mmDd; }
}

/**
 * Nettoie et formate proprement le nom de la boutique pour l'affichage dans les e-mails.
 * Exemples : "commerce_local_1" -> "Commerce Local", "boutique_paris" -> "Boutique Paris"
 */
function formatBoutiqueName(rawName) {
    if (!rawName) return "Commerce Local";
    const clean = String(rawName)
        .replace(/_\d+$/, '')
        .replace(/_/g, ' ')
        .trim();
    return clean.replace(/\b\w/g, char => char.toUpperCase());
}

/**
 * Construit le sujet et le corps d'un email anniversaire boutique selon le palier.
 * Toutes les variables (boutique, date, discount, code) sont injectées dynamiquement.
 */
function buildShopAnniversaryEmail(stage, boutiqueName, anniversaryMmDd, discount, promoCode) {
    const dateLabel = formatAnniversaryDate(anniversaryMmDd);
    const cleanName = formatBoutiqueName(boutiqueName);

    switch (stage) {
        case 'J-7':
            return {
                subject: `🎂 Dans 7 jours, ${cleanName} fête son anniversaire !`,
                body: `Chère cliente, cher client,\n\nNous avons une bonne nouvelle à vous partager : dans exactement 7 jours, le ${dateLabel}, ${cleanName} célèbre son anniversaire !\n\nPour marquer l'occasion, nous vous offrons ${discount}% de réduction sur l'ensemble de vos achats — valable uniquement le jour J, le ${dateLabel}.\n\nVotre code à garder précieusement :\n${promoCode}\n\nÀ très bientôt,\nL'équipe ${cleanName}`
            };
        case 'J-3':
            return {
                subject: `⏳ Plus que 3 jours — votre réduction de ${discount}% vous attend !`,
                body: `Chère cliente, cher client,\n\nPetit rappel : dans 3 jours seulement, le ${dateLabel}, ${cleanName} fête son anniversaire et vous réserve une offre exclusive.\n\nN'oubliez pas : ${discount}% de réduction sur tous vos achats, valable uniquement le jour de notre anniversaire, le ${dateLabel}.\n\nVotre code :\n${promoCode}\n\nÀ bientôt,\nL'équipe ${cleanName}`
            };
        case 'J-1':
        default:
            return {
                subject: `🎉 Demain c'est notre anniversaire — profitez de ${discount}% de réduction !`,
                body: `Chère cliente, cher client,\n\nDemain, le ${dateLabel}, c'est l'anniversaire de ${cleanName} !\n\nDernier rappel : votre réduction de ${discount}% est valable uniquement demain, le jour de notre anniversaire. Ne la manquez pas !\n\nVotre code :\n${promoCode}\n\nOn vous attend demain,\nL'équipe ${cleanName}`
            };
    }
}

/**
 * Calcule si aujourd'hui correspond à exactement `daysOffset` jours avant la date anniversaire (format "MM-DD").
 */
function isAnniversaryTriggerDay(anniversaryMmDd, daysOffset) {
    if (!anniversaryMmDd || !/^\d{2}-\d{2}$/.test(anniversaryMmDd)) return false;
    const [mm, dd] = anniversaryMmDd.split('-').map(Number);
    const today = new Date();
    // Date anniversaire cette année (UTC)
    const anniversary = new Date(Date.UTC(today.getUTCFullYear(), mm - 1, dd));
    // Cible = anniversaire - daysOffset
    const target = new Date(anniversary);
    target.setUTCDate(target.getUTCDate() - daysOffset);
    return (
        today.getUTCDate()  === target.getUTCDate() &&
        today.getUTCMonth() === target.getUTCMonth()
    );
}

/**
 * Envoie les campagnes anniversaire boutique pour un commerce donné.
 * Les 3 paliers (J-7, J-3, J-1) partagent le même code promo et taux
 * de réduction lus depuis commerces_settings (shop_anniversary_discount_percent
 * et shop_anniversary_promo_code).
 * @param {string} commerceId
 * @param {import('mongodb').Db} [dbOverride] - optionnel, si déjà connecté
 * @param {object} [options] - { force: boolean } force le déclenchement pour tests manuels
 */
const sendShopAnniversaryCampaign = async (commerceId, dbOverride, options = {}) => {
    const db = dbOverride || await connectDB();
    const brandId = extractBrandId(commerceId);
    const sentAt  = new Date().toISOString();
    const threeHundredDaysAgo = new Date();
    threeHundredDaysAgo.setDate(threeHundredDaysAgo.getDate() - 300);
    const isForce = options.force === true;

    // 1. Charger les settings de la marque
    const settings = await db.collection('commerces_settings').findOne({ brand_id: brandId });
    if (!settings) {
        console.log(`[SHOP-ANNIV] Pas de settings pour "${brandId}" — aucun anniversaire boutique configuré.`);
        return { status: 'skip', message: 'Aucun paramètre trouvé pour cette marque.' };
    }

    const mode = settings.shop_anniversary_mode || null;
    if (!mode) {
        console.log(`[SHOP-ANNIV] Anniversaire boutique non configuré pour "${brandId}".`);
        return { status: 'skip', message: 'Anniversaire boutique non configuré.' };
    }

    // 2. Déterminer la date anniversaire pour CE commerce
    let anniversaryMmDd = null;
    if (mode === 'global') {
        anniversaryMmDd = settings.shop_anniversary_date || null;
    } else if (mode === 'par_boutique') {
        const map = settings.shop_anniversary_by_boutique || {};
        anniversaryMmDd = map[commerceId] || null;
    }

    if (!anniversaryMmDd && !isForce) {
        console.log(`[SHOP-ANNIV] Pas de date anniversaire pour "${commerceId}" (mode: ${mode}).`);
        return { status: 'skip', message: `Pas de date anniversaire configurée pour ce commerce.` };
    }

    // Si date non saisie en mode force, fallback sur la date du jour pour l'affichage
    if (!anniversaryMmDd) {
        const now = new Date();
        anniversaryMmDd = `${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
    }

    // 2b. Lire l'offre promo configurée (commune à toutes les boutiques de la marque)
    const discount  = settings.shop_anniversary_discount_percent || 15;
    const promoCode = settings.shop_anniversary_promo_code || 'ANNIVBOUTIQUE';
    console.log(`[SHOP-ANNIV] Offre : ${discount}% | Code : ${promoCode} | Date : ${anniversaryMmDd}${isForce ? ' [FORCE TEST]' : ''}`);

    // 3. Filtre boutique : supporter le brand_id (ex: commerce_local) ou un ID spécifique (ex: commerce_local_1)
    const commerceFilter = { $regex: `^${commerceId}` };

    // RGPD : clients opt-out
    const rgpdClients = await db.collection('clients')
        .find({
            commerce_id: commerceFilter,
            $or: [
                { rgpd_opt_out: true },
                { rgpd_opt_out_marketing: true }
            ]
        }, { projection: { email: 1 } })
        .toArray();
    const rgpdOptOutSet = new Set(rgpdClients.map(c => (c.email || '').toLowerCase()).filter(Boolean));

    // 4. Clients actifs (recency ≤ 365 jours dans analyses_ia ou fallback sur la collection clients)
    let activeClients = await db.collection('analyses_ia')
        .find({ commerce_id: commerceFilter, recency: { $lte: 365 } })
        .toArray();

    if (activeClients.length === 0) {
        activeClients = await db.collection('clients')
            .find({ commerce_id: commerceFilter })
            .toArray();
    }

    // 5. Nom lisible de la boutique
    const commerceDoc = await db.collection('clients').findOne(
        { commerce_id: commerceId },
        { projection: { commerce_nom: 1, commerce_id: 1 } }
    );
    const boutiqueName = (commerceDoc && commerceDoc.commerce_nom) || commerceId;

    const globalStats = {};
    const campaignsToInsert = [];

    // 6. Boucle sur les 3 paliers
    for (const stageInfo of SHOP_ANNIVERSARY_STAGE_DEFS) {
        const { stage, daysOffset } = stageInfo;

        // Si on n'est pas en mode force test, vérifier si aujourd'hui = date cible de ce palier
        if (!isForce && !isAnniversaryTriggerDay(anniversaryMmDd, daysOffset)) {
            console.log(`[SHOP-ANNIV] ${stage} : pas le bon jour pour "${commerceId}" (anniversaire: ${anniversaryMmDd}) — saut.`);
            globalStats[stage] = 'not_today';
            continue;
        }

        // Anti-doublon PAR PALIER (ignoré en mode force test manuel pour pouvoir tester plusieurs fois)
        if (!isForce) {
            const alreadySent = await db.collection('campagnes_envoyees').findOne({
                commerce_id: commerceId,
                category: 'shop_anniversary',
                trigger_stage: stage,
                sent_at: { $gte: threeHundredDaysAgo.toISOString() }
            });

            if (alreadySent) {
                console.log(`[SHOP-ANNIV] ${stage} : déjà envoyé pour "${commerceId}" le ${alreadySent.sent_at} — ignoré.`);
                globalStats[stage] = 'already_sent';
                continue;
            }
        }

        // Construire le sujet et le corps avec les variables dynamiques
        const { subject, body } = buildShopAnniversaryEmail(stage, boutiqueName, anniversaryMmDd, discount, promoCode);

        // Envoi à tous les clients actifs non RGPD opt-out
        let sentCount = 0;

        for (const client of activeClients) {
            const clientEmail = client.email || client.client_db_id;
            if (!clientEmail) continue;
            if (rgpdOptOutSet.has(clientEmail.toLowerCase())) continue;

            const nomClient = client.nom || clientEmail;
            let status = 'simulated_auto';
            try {
                const emailResult = await sendEmail({ to: clientEmail, subject, text: body });
                status = emailResult.status === 'sent' ? 'sent_auto' : 'simulated_auto';
            } catch (err) {
                console.error(`❌ [SHOP-ANNIV] ${stage} — échec envoi à ${clientEmail}:`, err.message);
                status = 'failed_auto';
            }

            campaignsToInsert.push({
                commerce_id: commerceId,
                client_email: clientEmail,
                client_nom: nomClient,
                subject,
                body,
                sent_at: sentAt,
                status,
                category: 'shop_anniversary',
                trigger_stage: stage,
                discount_percent: discount,
                promo_code: promoCode,
                segment: client.segment_gmm || 'unknown',
                churn_score: client.churn_score || 0
            });
            sentCount++;
        }

        if (campaignsToInsert.length > 0) {
            await db.collection('campagnes_envoyees').insertMany(campaignsToInsert.splice(0));
        }

        console.log(`[SHOP-ANNIV] ${stage} — "${commerceId}" : ${sentCount} email(s) envoyé(s) (${discount}% | ${promoCode}).`);
        globalStats[stage] = sentCount;
    }

    return {
        status: 'success',
        commerce_id: commerceId,
        anniversary_date: anniversaryMmDd,
        stats: globalStats
    };
};

// ============================================================
// POST /api/campaigns/trigger-shop-anniversary
// Déclenchement MANUEL de la campagne anniversaire boutique
// (pour tests sans attendre le scheduler à 9h)
// ============================================================
const triggerShopAnniversary = async (req, res) => {
    const commerceId = req.body.commerce_id || COMMERCE_ID;
    console.log(`🎂 [SHOP-ANNIV MANUAL] Déclenchement manuel pour "${commerceId}"`);
    try {
        const result = await sendShopAnniversaryCampaign(commerceId, null, { force: true });
        return res.json(result);
    } catch (err) {
        console.error('❌ triggerShopAnniversary error:', err.message);
        return res.status(500).json({ status: 'error', error: err.message });
    }
};

// ============================================================
// Helper pour générer un token RGPD sécurisé pour le portail client
// ============================================================
const generateRGPDToken = (email) => {
    const secret = process.env.RGPD_SECRET || 'ratenza_rgpd_secret_key_2026';
    return crypto.createHmac('sha256', secret).update(String(email).toLowerCase().trim()).digest('hex').substring(0, 32);
};

// ============================================================
// GET /api/security/fraud-alerts?commerce_id=...
// Analyse et retourne les alertes de fraude et comportements suspects
// ============================================================
const getFraudAlerts = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    const brandId = extractBrandId(commerceId);

    try {
        const db = await connectDB();
        const settings = await db.collection('commerces_settings').findOne({ brand_id: brandId }) || {};
        
        const maxDaily = settings.fraud_max_daily_purchases || 5;
        const basketMultiplier = settings.fraud_max_basket_multiplier || 3.0;

        const commerceFilter = { $regex: `^${commerceId === '__all__' ? 'commerce_local' : commerceId}` };

        // 1. Comptes chatbot bloqués pour insultes / spam
        const blockedChatbotAccounts = await db.collection('chatbot_status')
            .find({ is_blocked: true })
            .toArray();

        // 2. Analyse des commandes et du panier moyen
        const txs = await db.collection('commandes')
            .find({ commerce_id: commerceFilter })
            .toArray();

        let totalRevenue = 0;
        const clientDailyCounts = {};

        txs.forEach(t => {
            const amount = parseFloat(t.montant) || parseFloat(t.total) || 0;
            const email = (t.email || t.client_id || '').toLowerCase();
            const dateStr = (t.date || t.created_at || '').substring(0, 10);
            if (!email) return;

            totalRevenue += amount;
            
            const key = `${email}_${dateStr}`;
            if (!clientDailyCounts[key]) {
                clientDailyCounts[key] = { email, date: dateStr, count: 0, totalAmount: 0 };
            }
            clientDailyCounts[key].count += 1;
            clientDailyCounts[key].totalAmount += amount;
        });

        const avgBasket = txs.length > 0 ? (totalRevenue / txs.length) : 50;
        const thresholdBasketAmount = avgBasket * basketMultiplier;

        const suspiciousFrequency = [];
        Object.values(clientDailyCounts).forEach(item => {
            if (item.count > maxDaily) {
                suspiciousFrequency.push({
                    email: item.email,
                    date: item.date,
                    count: item.count,
                    threshold: maxDaily,
                    type: 'frequency_abnormal',
                    reason: `${item.count} achats effectués le même jour (seuil configuré: ${maxDaily})`
                });
            }
        });

        const suspiciousBaskets = [];
        txs.forEach(t => {
            const amount = parseFloat(t.montant) || parseFloat(t.total) || 0;
            const email = (t.email || t.client_id || '').toLowerCase();
            if (amount > thresholdBasketAmount) {
                suspiciousBaskets.push({
                    email,
                    commande_id: t._id ? t._id.toString() : (t.commande_id || 'CMD-ANOMALIE'),
                    amount,
                    date: (t.date || t.created_at || '').substring(0, 10),
                    threshold: parseFloat(thresholdBasketAmount.toFixed(2)),
                    type: 'basket_abnormal',
                    reason: `Montant d'achat de ${amount} DT supérieur à ${basketMultiplier}x le panier moyen (${avgBasket.toFixed(1)} DT)`
                });
            }
        });

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.json({
            status: 'success',
            commerce_id: commerceId,
            settings: {
                fraud_max_daily_purchases: maxDaily,
                fraud_max_basket_multiplier: basketMultiplier,
                avg_basket_calculated: parseFloat(avgBasket.toFixed(2))
            },
            summary: {
                total_blocked_chatbot: blockedChatbotAccounts.length,
                total_suspicious_frequency: suspiciousFrequency.length,
                total_suspicious_baskets: suspiciousBaskets.length,
                total_alerts: blockedChatbotAccounts.length + suspiciousFrequency.length + suspiciousBaskets.length
            },
            alerts: {
                chatbot_blocked: blockedChatbotAccounts,
                suspicious_frequency: suspiciousFrequency,
                suspicious_baskets: suspiciousBaskets
            }
        });
    } catch (err) {
        console.error('❌ getFraudAlerts error:', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// Endpoints du Portail Client RGPD Libre-Service (Sécurisé par Token)
// ============================================================
const getRGPDPortalToken = async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'Email requis.' });
    const token = generateRGPDToken(email);
    return res.json({ status: 'success', email, token, link: `/rgpd/preferences?token=${token}` });
};

const getRGPDPortalData = async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requis.' });

    try {
        const db = await connectDB();
        const allClients = await db.collection('clients').find({}, { projection: { email: 1, nom: 1, rgpd_opt_out: 1, rgpd_opt_out_marketing: 1, rgpd_opt_out_profiling: 1 } }).toArray();
        const match = allClients.find(c => c.email && generateRGPDToken(c.email) === token);

        if (!match) {
            return res.status(404).json({ error: 'Lien RGPD invalide ou expiré.' });
        }

        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
        return res.json({
            status: 'success',
            email: match.email,
            nom: match.nom || match.email,
            marketing_opt_out: match.rgpd_opt_out_marketing ?? match.rgpd_opt_out ?? false,
            profiling_opt_out: match.rgpd_opt_out_profiling ?? match.rgpd_opt_out ?? false,
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const updateRGPDPortalData = async (req, res) => {
    const { token, marketing_opt_out, profiling_opt_out } = req.body || {};
    if (!token) return res.status(400).json({ error: 'Token requis.' });

    try {
        const db = await connectDB();
        const allClients = await db.collection('clients').find({}, { projection: { email: 1 } }).toArray();
        const match = allClients.find(c => c.email && generateRGPDToken(c.email) === token);

        if (!match) {
            return res.status(404).json({ error: 'Lien RGPD invalide ou expiré.' });
        }

        const email = match.email;
        const nowStr = new Date().toISOString();

        const updatePayload = {
            rgpd_opt_out_marketing: Boolean(marketing_opt_out),
            rgpd_opt_out_profiling: Boolean(profiling_opt_out),
            rgpd_opt_out: Boolean(marketing_opt_out),
            rgpd_opt_out_date: nowStr,
            rgpd_token: token
        };

        await db.collection('clients').updateMany(
            { email: email },
            { $set: updatePayload }
        );

        await db.collection('analyses_ia').updateMany(
            { email: email },
            { $set: updatePayload }
        );

        return res.json({
            status: 'success',
            message: 'Vos préférences RGPD ont été enregistrées avec succès.',
            email
        });
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// Exports CSV au format UTF-8 avec BOM (\uFEFF)
// ============================================================
const exportClientsCSV = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    try {
        const db = await connectDB();
        const commerceFilter = commerceId === '__all__' ? {} : { commerce_id: { $regex: `^${commerceId}` } };
        const clients = await db.collection('analyses_ia').find(commerceFilter).toArray();

        let csv = '\uFEFF'; // BOM UTF-8 pour Excel
        csv += 'ID Client;Nom;Email;Boutique;Récence (j);Fréquence;Montant Total (DT);Segment GMM;Churn (%);Opt-Out Marketing;Opt-Out Profilage\n';

        clients.forEach(c => {
            const nom = (c.nom || '').replace(/;/g, ',');
            const email = (c.email || '').replace(/;/g, ',');
            const boutique = (c.commerce_id || '').replace(/;/g, ',');
            const recency = c.recency ?? '';
            const freq = c.frequency ?? '';
            const monetary = (parseFloat(c.monetary) || 0).toFixed(2);
            const segment = c.segment_gmm || 'Inconnu';
            const churn = ((parseFloat(c.churn_score) || 0) * 100).toFixed(0);
            const optMarketing = (c.rgpd_opt_out_marketing ?? c.rgpd_opt_out) ? 'Oui' : 'Non';
            const optProfiling = (c.rgpd_opt_out_profiling ?? c.rgpd_opt_out) ? 'Oui' : 'Non';

            csv += `${c.client_db_id || ''};${nom};${email};${boutique};${recency};${freq};${monetary};${segment};${churn}%;${optMarketing};${optProfiling}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="export_clients_${Date.now()}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const exportCampaignsCSV = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    try {
        const db = await connectDB();
        const commerceFilter = commerceId === '__all__' ? {} : { commerce_id: { $regex: `^${commerceId}` } };
        const campaigns = await db.collection('campagnes_envoyees').find(commerceFilter).sort({ sent_at: -1 }).toArray();

        let csv = '\uFEFF'; // BOM UTF-8 pour Excel
        csv += 'Date Envoi;Boutique;Email Client;Nom Client;Sujet;Catégorie;Palier;Statut;Réduction (%);Code Promo\n';

        campaigns.forEach(c => {
            const date = (c.sent_at || '').substring(0, 19).replace('T', ' ');
            const boutique = (c.commerce_id || '').replace(/;/g, ',');
            const email = (c.client_email || '').replace(/;/g, ',');
            const nom = (c.client_nom || '').replace(/;/g, ',');
            const sujet = (c.subject || '').replace(/;/g, ',');
            const category = c.category || 'inconnu';
            const stage = c.trigger_stage || '-';
            const status = c.status || '-';
            const discount = c.discount_percent || '-';
            const code = c.promo_code || '-';

            csv += `${date};${boutique};${email};${nom};${sujet};${category};${stage};${status};${discount};${code}\n`;
        });

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="export_campagnes_${Date.now()}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const exportGlobalCSV = async (req, res) => {
    try {
        const db = await connectDB();
        const commerces = await db.collection('commerces').find({}).toArray();

        let csv = '\uFEFF'; // BOM UTF-8 pour Excel
        csv += 'ID Boutique;Nom Boutique;Ville;Code Postal;CA Total (DT);Nombre Clients;Score Sa Moyen\n';

        for (const c of commerces) {
            const id = c.commerce_id || c.id;
            const nom = (c.nom || c.label || id).replace(/;/g, ',');
            const ville = (c.ville || '').replace(/;/g, ',');
            const cp = c.code_postal || '';
            
            const docs = await db.collection('analyses_ia').find({ commerce_id: id }).toArray();
            const ca = docs.reduce((acc, curr) => acc + (parseFloat(curr.monetary) || 0), 0).toFixed(2);
            const clientsCount = docs.length;
            const avgSa = docs.length > 0 ? (docs.reduce((acc, curr) => acc + (parseFloat(curr.score_global_sa) || 0), 0) / docs.length).toFixed(1) : '0';

            csv += `${id};${nom};${ville};${cp};${ca};${clientsCount};${avgSa}%\n`;
        }

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="export_global_${Date.now()}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

const exportDashboardCSV = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    try {
        const db = await connectDB();
        const commerceFilter = commerceId === '__all__' ? {} : { commerce_id: { $regex: `^${commerceId}` } };
        const clients = await db.collection('analyses_ia').find(commerceFilter).toArray();

        // 1. Calculer les KPIs identiques au dashboard
        const totalClients = clients.length;
        const avgBasket = totalClients > 0 
            ? (clients.reduce((acc, c) => acc + (parseFloat(c.monetary) || 0), 0) / totalClients) 
            : 0;
        
        const avgRecency = totalClients > 0 
            ? (clients.reduce((acc, c) => acc + (parseFloat(c.recency) || 0), 0) / totalClients) 
            : 0;

        const avgFrequency = totalClients > 0 
            ? (clients.reduce((acc, c) => acc + (parseFloat(c.frequency) || 0), 0) / totalClients) 
            : 0;

        const avgChurn = totalClients > 0 
            ? (clients.reduce((acc, c) => acc + (parseFloat(c.churn_score) || 0), 0) / totalClients) 
            : 0;

        const churnAlerts = clients.filter(c => (c.churn_score || 0) >= 0.55).length;

        const ambassadors = clients.filter(c => {
            const infl = c.influence_score !== undefined
                ? c.influence_score
                : Math.round(((c.score_global_sa || 0) * 0.7 + (1.0 - (c.churn_score || 0)) * 0.3) * 100);
            return infl >= 80;
        }).length;

        // Taux de retour client
        let returnRate = 0;
        if (commerceId === '__all__') {
            const comp = await db.collection('kpis_boutiques').find({}).toArray();
            if (comp.length > 0) {
                returnRate = comp.reduce((acc, curr) => acc + (parseFloat(curr.taux_retour_30j) || 0), 0) / comp.length;
            }
        } else {
            const kpi = await db.collection('kpis_boutiques').findOne({ commerce_id: commerceId });
            returnRate = kpi ? (kpi.taux_retour_30j || 0) : 0;
        }

        // Segments distribution
        const segCounts = { vip: 0, regular: 0, at_risk: 0, lost: 0 };
        clients.forEach(c => {
            const s = c.segment_gmm || 'regular';
            if (segCounts[s] !== undefined) segCounts[s]++;
        });

        // 2. Générer le CSV
        let csv = '\uFEFF'; // BOM UTF-8
        csv += `RAPPORT TABLEAU DE BORD RFM & IA;Boutique: ${commerceId === '__all__' ? 'Toutes' : commerceId};Date: ${new Date().toLocaleDateString('fr-FR')}\n\n`;
        
        csv += 'INDICATEURS CLÉS (KPIs)\n';
        csv += 'Indicateur;Valeur;Description\n';
        csv += `Clients Totaux;${totalClients};Clients modélisés en base de données\n`;
        csv += `Panier Moyen;${avgBasket.toFixed(2)} DT;Valeur monétaire moyenne par client\n`;
        csv += `Taux de Retour (Tr);${returnRate.toFixed(1)}%;Clients actifs revenus sous 30 jours\n`;
        csv += `Taux de Churn (IA);${(avgChurn * 100).toFixed(1)}%;Probabilité moyenne de départ des clients\n`;
        csv += `Récence Moyenne;${avgRecency.toFixed(1)} jours;Nombre moyen de jours depuis le dernier achat\n`;
        csv += `Fréquence Moyenne;${avgFrequency.toFixed(1)} achats;Nombre moyen d'achats cumulés par client\n`;
        csv += `Alertes Churn (>= 55%);${churnAlerts};Clients en risque modéré ou élevé d'attrition\n`;
        csv += `Ambassadeurs;${ambassadors};Clients avec un score d'influence >= 80%\n\n`;

        csv += 'DISTRIBUTION DES SEGMENTS GMM\n';
        csv += 'Segment;Nombre de clients;Pourcentage (%)\n';
        const getPct = (cnt) => totalClients > 0 ? ((cnt / totalClients) * 100).toFixed(1) + '%' : '0%';
        csv += `VIP;${segCounts.vip};${getPct(segCounts.vip)}\n`;
        csv += `Réguliers;${segCounts.regular};${getPct(segCounts.regular)}\n`;
        csv += `À Risque;${segCounts.at_risk};${getPct(segCounts.at_risk)}\n`;
        csv += `Perdus;${segCounts.lost};${getPct(segCounts.lost)}\n`;

        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="dashboard_metrics_${Date.now()}.csv"`);
        return res.status(200).send(csv);
    } catch (err) {
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/campaigns/track/open/:trackingId
// Pixel de tracking d'ouverture 1x1 transparent
// ============================================================
const trackCampaignOpen = async (req, res) => {
    const { trackingId } = req.params;

    const TRANSPARENT_GIF = Buffer.from(
        'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
        'base64'
    );

    res.writeHead(200, {
        'Content-Type': 'image/gif',
        'Content-Length': TRANSPARENT_GIF.length,
        'Cache-Control': 'no-store, no-cache, must-revalidate, private, max-age=0'
    });

    if (!trackingId || trackingId.length < 8) {
        return res.end(TRANSPARENT_GIF);
    }

    try {
        const db = await connectDB();
        const nowIso = new Date().toISOString();

        // $set est utilisé pour opened_at (et non $setOnInsert qui ne s'applique qu'aux upserts)
        await db.collection('campagnes_envoyees').updateOne(
            { tracking_id: trackingId },
            {
                $set: { opened: true, opened_at: nowIso },
                $inc: { open_count: 1 }
            }
        );
        clearStatsCache();
    } catch (err) {
        console.error('❌ trackCampaignOpen error :', err.message);
    }

    return res.end(TRANSPARENT_GIF);
};

// ============================================================
// GET /api/campaigns/advanced-stats
// Statistiques avancées & attribution Last-Touch du CA
// ============================================================
const getAdvancedCampaignStats = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;
    const windowDays = parseInt(req.query.window_days || '7', 10);
    const cacheKey = `${commerceId}_${windowDays}`;

    // Vérifier le cache en mémoire (TTL 5 min)
    const cached = statsCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        return res.json(cached.data);
    }

    try {
        const db = await connectDB();
        const query = {};
        if (commerceId && commerceId !== '__all__') {
            query.commerce_id = commerceId;
        }

        // 1. Récupérer toutes les campagnes envoyées
        const campaigns = await db.collection('campagnes_envoyees')
            .find(query)
            .sort({ sent_at: -1 })
            .toArray();

        // 2. Mappage d'identifiants clients (email -> set d'IDs)
        const clientsDocs = await db.collection('clients').find({}).toArray();
        const clientEmailMap = new Map();
        clientsDocs.forEach(c => {
            if (c.email) {
                const em = c.email.toLowerCase().trim();
                if (!clientEmailMap.has(em)) clientEmailMap.set(em, new Set());
                const set = clientEmailMap.get(em);
                set.add(em);
                if (c.id) set.add(String(c.id));
                if (c._id) set.add(c._id.toString());
            }
        });

        const identifierToEmail = new Map();
        for (const [em, set] of clientEmailMap.entries()) {
            for (const idVal of set) {
                identifierToEmail.set(idVal, em);
            }
        }

        // 3. Récupérer les achats depuis commandes et transactions
        const commandes = await db.collection('commandes').find({}).toArray();
        const transactions = await db.collection('transactions').find({}).toArray();

        const purchases = [];

        commandes.forEach(cmd => {
            const rawEmail = cmd.client_email || cmd.email;
            let emLower = rawEmail ? rawEmail.toLowerCase().trim() : null;
            if (!emLower && cmd.client_id) {
                emLower = identifierToEmail.get(String(cmd.client_id));
            }
            if (emLower && cmd.date_commande) {
                purchases.push({
                    emailLower: emLower,
                    date: new Date(cmd.date_commande),
                    amount: parseFloat(cmd.montant_total || cmd.montant || 0)
                });
            }
        });

        transactions.forEach(tx => {
            const rawEmail = tx.email || tx.client_email;
            let emLower = rawEmail ? rawEmail.toLowerCase().trim() : null;
            if (!emLower && tx.client_id) {
                emLower = identifierToEmail.get(String(tx.client_id));
            }
            if (emLower && tx.date_transaction) {
                purchases.push({
                    emailLower: emLower,
                    date: new Date(tx.date_transaction),
                    amount: parseFloat(tx.montant || tx.montant_total || 0)
                });
            }
        });

        const purchasesByEmail = new Map();
        purchases.forEach(p => {
            if (!purchasesByEmail.has(p.emailLower)) {
                purchasesByEmail.set(p.emailLower, []);
            }
            purchasesByEmail.get(p.emailLower).push(p);
        });

        // 4. Regrouper les campagnes par client pour attribution Last-Touch
        const campaignsByClient = new Map();
        campaigns.forEach(c => {
            const em = c.client_email ? c.client_email.toLowerCase().trim() : null;
            if (em && c.sent_at) {
                if (!campaignsByClient.has(em)) campaignsByClient.set(em, []);
                campaignsByClient.get(em).push({
                    doc: c,
                    sentAt: new Date(c.sent_at)
                });
            }
        });

        for (const [em, list] of campaignsByClient.entries()) {
            list.sort((a, b) => a.sentAt - b.sentAt);
        }

        const windowMs = windowDays * 24 * 60 * 60 * 1000;
        const campaignAttributedRevenue = new Map();
        const campaignConversions = new Map();

        // 5. Calcul d'Attribution Last-Touch
        for (const [em, clientPurchases] of purchasesByEmail.entries()) {
            const clientCampaigns = campaignsByClient.get(em);
            if (!clientCampaigns || clientCampaigns.length === 0) continue;

            for (const purchase of clientPurchases) {
                const txTime = purchase.date.getTime();

                let lastTouchCamp = null;
                for (let i = clientCampaigns.length - 1; i >= 0; i--) {
                    const camp = clientCampaigns[i];
                    const campTime = camp.sentAt.getTime();
                    if (campTime <= txTime && (txTime - campTime) <= windowMs) {
                        lastTouchCamp = camp;
                        break;
                    }
                }

                if (lastTouchCamp) {
                    const campIdStr = lastTouchCamp.doc._id.toString();
                    const currentRev = campaignAttributedRevenue.get(campIdStr) || 0;
                    campaignAttributedRevenue.set(campIdStr, currentRev + purchase.amount);

                    if (!campaignConversions.has(campIdStr)) {
                        campaignConversions.set(campIdStr, new Set());
                    }
                    campaignConversions.get(campIdStr).add(em);
                }
            }
        }

        // 6. Regrouper par Batch de Campagne
        // is_tracked = le batch a un vrai campaign_batch_id (pixel de suivi actif)
        const batchMap = new Map();

        campaigns.forEach(c => {
            const campIdStr = c._id.toString();
            let batchKey = c.campaign_batch_id;
            const isTracked = !!c.campaign_batch_id;  // true uniquement pour les nouveaux envois avec tracking
            if (!batchKey) {
                const roundedDate = c.sent_at ? c.sent_at.slice(0, 16) : 'unknown';
                batchKey = `batch_legacy_${(c.subject || 'sans_sujet').slice(0, 20)}_${roundedDate}`;
            }

            if (!batchMap.has(batchKey)) {
                batchMap.set(batchKey, {
                    batch_id: batchKey,
                    subject: c.subject || 'Campagne sans sujet',
                    category: c.category || c.segment || 'general',
                    segment: c.segment || 'all',
                    sent_at: c.sent_at,
                    is_tracked: isTracked,
                    recipients: 0,
                    opened_count: 0,
                    converted_count: 0,
                    revenue_generated: 0
                });
            }

            const batch = batchMap.get(batchKey);
            batch.recipients += 1;
            if (c.opened === true || c.open_count > 0 || c.status?.includes('opened')) {
                batch.opened_count += 1;
            }
            const rev = campaignAttributedRevenue.get(campIdStr) || 0;
            batch.revenue_generated += rev;

            const convertedSet = campaignConversions.get(campIdStr);
            if (convertedSet && convertedSet.size > 0) {
                batch.converted_count += 1;
            }
        });

        const batchesArray = Array.from(batchMap.values()).map(b => {
            const openRate = b.recipients > 0 ? (b.opened_count / b.recipients) * 100 : 0;
            const convRate = b.recipients > 0 ? (b.converted_count / b.recipients) * 100 : 0;
            const revPerRecipient = b.recipients > 0 ? b.revenue_generated / b.recipients : 0;

            return {
                batch_id: b.batch_id,
                subject: b.subject,
                category: b.category,
                segment: b.segment,
                sent_at: b.sent_at,
                is_tracked: b.is_tracked,
                total_sent: b.recipients,
                total_opened: b.opened_count,
                total_converted: b.converted_count,
                open_rate: parseFloat(openRate.toFixed(1)),
                conversion_rate: parseFloat(convRate.toFixed(1)),
                revenue_generated: parseFloat(b.revenue_generated.toFixed(2)),
                revenue_per_recipient: parseFloat(revPerRecipient.toFixed(2))
            };
        });

        batchesArray.sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));

        // 7. Agrégation par Catégorie avec dénominateurs trackés stricts
        const categoryMap = new Map();
        batchesArray.forEach(b => {
            const cat = b.category || 'general';
            if (!categoryMap.has(cat)) {
                categoryMap.set(cat, {
                    category: cat,
                    total_sent: 0,
                    total_sent_tracked: 0,
                    total_opened: 0,
                    total_converted: 0,
                    revenue_generated: 0
                });
            }
            const catStat = categoryMap.get(cat);
            catStat.total_sent += b.total_sent;
            if (b.is_tracked) {
                catStat.total_sent_tracked += b.total_sent;
                catStat.total_opened += b.total_opened;
                catStat.total_converted += b.total_converted;
            }
            catStat.revenue_generated += b.revenue_generated;
        });

        const categoryStats = Array.from(categoryMap.values()).map(c => {
            // Si la catégorie a des envois trackés, utiliser total_sent_tracked comme dénominateur
            // pour ne pas diluer le taux avec l'historique non-tracké
            const trackedDenom = c.total_sent_tracked > 0 ? c.total_sent_tracked : 0;

            const openRate = trackedDenom > 0 ? (c.total_opened / trackedDenom) * 100 : 0;
            const convRate = trackedDenom > 0 ? (c.total_converted / trackedDenom) * 100 : 0;
            
            // CA par destinataire : basé sur les destinataires trackés s'il y en a, sinon sur le total
            const revDenom = trackedDenom > 0 ? trackedDenom : (c.total_sent > 0 ? c.total_sent : 1);
            const revPerRec = c.revenue_generated / revDenom;

            return {
                category: c.category,
                total_sent: c.total_sent,
                total_sent_tracked: c.total_sent_tracked,
                total_opened: c.total_opened,
                total_converted: c.total_converted,
                revenue_generated: parseFloat(c.revenue_generated.toFixed(2)),
                open_rate: parseFloat(openRate.toFixed(1)),
                conversion_rate: parseFloat(convRate.toFixed(1)),
                revenue_per_recipient: parseFloat(revPerRec.toFixed(2))
            };
        });

        // KPIs Globaux
        // total_sent inclut tous les envois (historiques + tracké) pour le CA et le contexte
        const totalSentAll = batchesArray.reduce((sum, b) => sum + b.total_sent, 0);
        const totalRevenueAll = batchesArray.reduce((sum, b) => sum + b.revenue_generated, 0);
        const totalConvertedAll = batchesArray.reduce((sum, b) => sum + b.total_converted, 0);

        // Pour les taux (ouverture & conversion) : on exclut les batches legacy sans tracking
        // car leurs ouvertures ne peuvent pas être mesurées → dénominateur honnête
        const trackedBatches = batchesArray.filter(b => b.is_tracked);
        const trackedSent = trackedBatches.reduce((sum, b) => sum + b.total_sent, 0);
        const trackedOpened = trackedBatches.reduce((sum, b) => sum + b.total_opened, 0);
        const trackedConverted = trackedBatches.reduce((sum, b) => sum + b.total_converted, 0);

        const globalOpenRate = trackedSent > 0 ? (trackedOpened / trackedSent) * 100 : 0;
        const globalConvRate = trackedSent > 0 ? (trackedConverted / trackedSent) * 100 : 0;

        // Top Catégorie par CA Total
        const sortedCatsByRev = [...categoryStats].sort((a, b) => b.revenue_generated - a.revenue_generated);
        const topCategoryByRevenue = sortedCatsByRev.length > 0 ? sortedCatsByRev[0].category : 'N/A';
        const topCategoryRevVal = sortedCatsByRev.length > 0 ? sortedCatsByRev[0].revenue_generated : 0;

        // Top Catégorie par Rendement / Client (stricte sur les données trackées)
        const sortedCatsByEff = [...categoryStats].sort((a, b) => b.revenue_per_recipient - a.revenue_per_recipient);
        const topCategoryByEfficiency = sortedCatsByEff.length > 0 ? sortedCatsByEff[0].category : 'N/A';
        const topCategoryEffVal = sortedCatsByEff.length > 0 ? sortedCatsByEff[0].revenue_per_recipient : 0;

        const resultData = {
            window_days: windowDays,
            global_kpis: {
                total_sent: totalSentAll,           // Tous les envois (contexte CA)
                total_sent_tracked: trackedSent,    // Envois avec tracking pixel actif
                total_opened: trackedOpened,        // Ouvertures trackées uniquement
                total_converted: trackedConverted,  // Conversions issues de batches trackés
                total_converted_all: totalConvertedAll, // Conversions toutes campagnes
                total_revenue: parseFloat(totalRevenueAll.toFixed(2)),
                open_rate: parseFloat(globalOpenRate.toFixed(1)),       // Sur batches trackés
                conversion_rate: parseFloat(globalConvRate.toFixed(1)), // Sur batches trackés
                tracked_batches_count: trackedBatches.length,
                top_category: topCategoryByRevenue,
                top_category_revenue_val: parseFloat(topCategoryRevVal.toFixed(2)),
                top_category_efficiency: topCategoryByEfficiency,
                top_category_efficiency_val: parseFloat(topCategoryEffVal.toFixed(2))
            },
            category_stats: categoryStats,
            batches: batchesArray
        };

        statsCache.set(cacheKey, {
            data: resultData,
            timestamp: Date.now()
        });

        return res.json(resultData);
    } catch (err) {
        console.error('❌ getAdvancedCampaignStats error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/campaigns/recommendations-ai
// Assistant IA de Recommandation de Campagne basé sur les statistiques
// ============================================================
const getCampaignRecommendationsAI = async (req, res) => {
    const commerceId = req.query.commerce_id || COMMERCE_ID;

    try {
        const db = await connectDB();

        const clientsAnalyses = await db.collection('analyses_ia')
            .find({ commerce_id: commerceId })
            .toArray();

        const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
        const recentCampaigns = await db.collection('campagnes_envoyees')
            .find({ commerce_id: commerceId, sent_at: { $gte: fourteenDaysAgo } })
            .toArray();

        const recentlyContactedEmails = new Set(
            recentCampaigns.map(c => (c.client_email ? c.client_email.toLowerCase().trim() : '')).filter(Boolean)
        );

        const categoryTitles = {
            birthday_gift: 'Anniversaire Boutique & Client',
            vip_danger: 'Rétention VIP à Risque',
            ambassador_invite: 'Programme Ambassadeurs & Parrainage',
            baisse_frequence: 'Relance Baisse de Fréquence',
            lost: 'Reconquête Clients Perdus',
            at_risk: 'Prévention Churn Client',
            vip: 'Fidélisation VIP',
            regular: 'Offre Régulière'
        };

        const eligibleByCategory = {
            birthday_gift: clientsAnalyses.filter(c => c.date_naissance && !recentlyContactedEmails.has((c.email || c.client_db_id || '').toLowerCase().trim())),
            vip_danger: clientsAnalyses.filter(c => (c.segment_gmm === 'vip' || (c.probabilities_gmm && c.probabilities_gmm.vip > 0.3)) && (c.churn_score >= 0.55) && !recentlyContactedEmails.has((c.email || c.client_db_id || '').toLowerCase().trim())),
            ambassador_invite: clientsAnalyses.filter(c => ((c.influence_score >= 80) || ((c.score_global_sa || 0) >= 0.8)) && !recentlyContactedEmails.has((c.email || c.client_db_id || '').toLowerCase().trim())),
            baisse_frequence: clientsAnalyses.filter(c => c.baisse_frequence_detectee === true && !recentlyContactedEmails.has((c.email || c.client_db_id || '').toLowerCase().trim())),
            lost: clientsAnalyses.filter(c => (c.segment_gmm === 'lost' || (c.churn_score >= 0.75)) && !recentlyContactedEmails.has((c.email || c.client_db_id || '').toLowerCase().trim())),
            at_risk: clientsAnalyses.filter(c => c.segment_gmm === 'at_risk' && !recentlyContactedEmails.has((c.email || c.client_db_id || '').toLowerCase().trim()))
        };

        let chosenCat = 'birthday_gift';
        let maxCount = 0;

        for (const [catKey, list] of Object.entries(eligibleByCategory)) {
            if (list.length > maxCount) {
                maxCount = list.length;
                chosenCat = catKey;
            }
        }

        if (maxCount === 0) {
            chosenCat = 'baisse_frequence';
            maxCount = clientsAnalyses.length;
        }

        const title = categoryTitles[chosenCat] || 'Fidélisation Ciblé';
        const sampleList = (eligibleByCategory[chosenCat] || []).slice(0, 5).map(c => ({
            email: c.email || c.client_db_id,
            nom: c.nom || c.email || 'Client'
        }));

        // Estimer le taux de conversion dynamique à partir des campagnes réelles trackées
        let conversionEstimate = chosenCat === 'birthday_gift' ? 24.1 : chosenCat === 'vip_danger' ? 22.5 : 18.0;
        
        // Rechercher si des campagnes de cette catégorie ont des données de conversion réelles
        const trackedCatCamp = await db.collection('campagnes_envoyees').find({
            commerce_id: commerceId,
            category: chosenCat,
            campaign_batch_id: { $exists: true }
        }).toArray();

        if (trackedCatCamp.length > 0) {
            const totalSentTracked = trackedCatCamp.length;
            const convertedCount = trackedCatCamp.filter(c => c.converted || c.revenue_generated > 0).length;
            if (totalSentTracked > 0 && convertedCount > 0) {
                conversionEstimate = parseFloat(((convertedCount / totalSentTracked) * 100).toFixed(1));
            }
        }

        return res.json({
            recommended_category: chosenCat,
            title: title,
            eligible_count: maxCount,
            reasoning: `Basé sur l'analyse comparative des campagnes passées, la stratégie '${title}' présente le plus fort potentiel d'engagement direct. ${maxCount} client(s) n'ont pas reçu d'offre ces 14 derniers jours.`,
            sample_clients: sampleList,
            conversion_rate_estimate: conversionEstimate
        });
    } catch (err) {
        console.error('❌ getCampaignRecommendationsAI error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/commandes/add
// Enregistre une commande et invalide immédiatement le cache des stats
// ============================================================
const addCommande = async (req, res) => {
    try {
        const db = await connectDB();
        const {
            commerce_id,
            client_email,
            client_id,
            numero_commande,
            statut = 'livre',
            date_commande,
            montant_total,
            produits = []
        } = req.body;

        if (!client_email && !client_id) {
            return res.status(400).json({ error: 'client_email ou client_id requis' });
        }
        if (!montant_total || isNaN(parseFloat(montant_total))) {
            return res.status(400).json({ error: 'montant_total (numérique) requis' });
        }

        const doc = {
            commerce_id : commerce_id || COMMERCE_ID,
            client_email: client_email ? client_email.toLowerCase().trim() : null,
            client_id   : client_id   || null,
            numero_commande: numero_commande || `CMD-${Date.now()}`,
            statut,
            date_commande  : date_commande ? new Date(date_commande) : new Date(),
            montant_total  : parseFloat(montant_total),
            produits
        };

        const result = await db.collection('commandes').insertOne(doc);

        // Invalider immédiatement le cache des statistiques avancées
        clearStatsCache();

        return res.json({
            status : 'success',
            message: `Commande ${doc.numero_commande} enregistrée et cache des stats invalidé.`,
            inserted_id: result.insertedId
        });
    } catch (err) {
        console.error('❌ addCommande error :', err.message);
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
    getAutomationStatus,
    runSmartAutomationInternal,
    getCommerces,
    getGlobalComparison,
    getReturnRate,
    getRecommendations,
    optOutRGPD,
    optInRGPD,
    getCommerceSettings,
    updateCommerceSettings,
    sendShopAnniversaryCampaign,
    triggerShopAnniversary,
    getFraudAlerts,
    getRGPDPortalToken,
    getRGPDPortalData,
    updateRGPDPortalData,
    exportClientsCSV,
    exportCampaignsCSV,
    exportGlobalCSV,
    exportDashboardCSV,
    trackCampaignOpen,
    getAdvancedCampaignStats,
    getCampaignRecommendationsAI,
    addCommande
};

