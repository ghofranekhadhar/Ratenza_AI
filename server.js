require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rfmRoutes     = require('./routes/rfmRoutes');
const loyaltyRoutes = require('./routes/loyaltyRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ============================================================
// Middlewares
// ============================================================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

// Logger minimaliste pour chaque requête
app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
});

// ============================================================
// Routes API REST
// ============================================================
app.use('/api', rfmRoutes);
app.use('/api/loyalty', loyaltyRoutes);
app.use('/api/chatbot', require('./routes/chatbotRoutes'));

// ============================================================
// Servir la page HTML d'interface (templates/index.html)
// ============================================================
const templatesDir = path.join(__dirname, 'templates');
app.use(express.static(templatesDir));

app.get('/', (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');
    res.sendFile(path.join(templatesDir, 'index.html'));
});

// Fallback pour les routes inconnues
app.use((req, res) => {
    if (req.path.startsWith('/api')) {
        return res.status(404).json({ error: `Route introuvable : ${req.path}` });
    }
    res.sendFile(path.join(templatesDir, 'index.html'));
});

// ============================================================
// Gestionnaire d'erreurs global
// ============================================================
app.use((err, req, res, next) => {
    console.error('❌ Erreur serveur :', err.stack);
    res.status(500).json({ error: 'Erreur interne du serveur.' });
});

// ============================================================
// Planificateur quotidien autonome d'envois marketing (IA)
// ============================================================
const { runSmartAutomationInternal, sendShopAnniversaryCampaign } = require('./controllers/rfmController');
const connectDB = require('./config/db');


// Seuil de détection du "mode test" : cooldown_days ≤ 0.01 (= ~14 minutes max)
const TEST_MODE_THRESHOLD_DAYS = 0.01;
// Fenêtre d'exécution quotidienne : 9h00 → 9h04 (4 minutes de tolérance)
const DAILY_RUN_HOUR = 9;
const DAILY_WINDOW_MINUTES = 4;

function startAdaptiveScheduler() {
    let isSchedulerRunning = false;
    // Garde-fou pour ne pas relancer plusieurs fois dans la même journée (mode production)
    let lastDailyRunDate = null;

    /**
     * Lit le cooldown de chaque marque en base et détermine si ce commerce
     * doit être traité lors de ce tick.
     */
    async function shouldRunForCommerce(db, commerceId) {
        const brandId = commerceId.replace(/_\d+$/, '');
        try {
            const settings = await db.collection('commerces_settings').findOne({ brand_id: brandId });
            const cooldownDays = (settings && settings.cooldown_days !== undefined)
                ? parseFloat(settings.cooldown_days) || 30
                : 30;

            const isTestMode = cooldownDays <= TEST_MODE_THRESHOLD_DAYS;

            if (isTestMode) {
                // Mode 5 minutes : on exécute à chaque tick (toutes les 5 min)
                console.log(`⏰ [SCHEDULER] Mode TEST (${cooldownDays}j) détecté pour "${brandId}" — tick 5 min`);
                return true;
            } else {
                // Mode production : on exécute uniquement dans la fenêtre 9h00–9h04
                const now = new Date();
                const hour = now.getHours();
                const minute = now.getMinutes();
                const todayStr = now.toDateString();
                const inDailyWindow = (hour === DAILY_RUN_HOUR && minute < DAILY_WINDOW_MINUTES);
                const alreadyRanToday = (lastDailyRunDate === todayStr);

                if (inDailyWindow && !alreadyRanToday) {
                    console.log(`⏰ [SCHEDULER] Mode PRODUCTION (${cooldownDays}j) pour "${brandId}" — fenêtre 9h OK`);
                    return true;
                } else if (inDailyWindow && alreadyRanToday) {
                    console.log(`⏰ [SCHEDULER] Mode PRODUCTION — déjà exécuté aujourd'hui pour "${brandId}", saut.`);
                    return false;
                } else {
                    // Pas dans la fenêtre — afficher prochaine exécution prévue
                    const nextRun = new Date();
                    nextRun.setHours(DAILY_RUN_HOUR, 0, 0, 0);
                    if (now >= nextRun) nextRun.setDate(nextRun.getDate() + 1);
                    return false;
                }
            }
        } catch (err) {
            console.warn(`[SCHEDULER] Impossible de lire les paramètres pour "${commerceId}":`, err.message);
            return false;
        }
    }

    async function tickScheduler() {
        if (isSchedulerRunning) {
            console.log(`⏰ [SCHEDULER] [WARNING] Exécution déjà en cours, saut de ce tick.`);
            return;
        }
        isSchedulerRunning = true;

        try {
            const db = await connectDB();
            const commerceIds = await db.collection('clients').distinct('commerce_id');
            let anyRan = false;

            for (const commerceId of commerceIds) {
                const shouldRun = await shouldRunForCommerce(db, commerceId);
                if (!shouldRun) continue;

                anyRan = true;
                console.log(`⏰ [SCHEDULER] Lancement automatique pour le commerce : ${commerceId} à ${new Date().toLocaleString('fr-FR')}`);
                const result = await runSmartAutomationInternal(commerceId);
                console.log(`⏰ [SCHEDULER] Résultat pour ${commerceId} :`, result.message, result.stats);

                // Campagnes anniversaire boutique (J-7, J-3, J-1) — indépendant du cooldown RFM
                try {
                    const db = await connectDB();
                    const anniversaryResult = await sendShopAnniversaryCampaign(commerceId, db);
                    if (anniversaryResult.status === 'success') {
                        console.log(`🎂 [SCHEDULER] Anniversaire boutique pour ${commerceId} :`, anniversaryResult.stats);
                    }
                } catch (err) {
                    console.error(`❌ [SCHEDULER] Erreur anniversaire boutique pour ${commerceId} :`, err.message);
                }
            }

            // Marquer la date du jour comme "déjà traitée" si on a tourné en mode production
            if (anyRan) {
                const now = new Date();
                const isTestTick = commerceIds.length > 0 && await (async () => {
                    for (const id of commerceIds) {
                        const brandId = id.replace(/_\d+$/, '');
                        const s = await db.collection('commerces_settings').findOne({ brand_id: brandId });
                        const cd = (s && s.cooldown_days !== undefined) ? parseFloat(s.cooldown_days) : 30;
                        if (cd > TEST_MODE_THRESHOLD_DAYS) return false;
                    }
                    return true;
                })();
                if (!isTestTick) {
                    lastDailyRunDate = now.toDateString();
                    console.log(`⏰ [SCHEDULER] Exécution quotidienne enregistrée pour ${lastDailyRunDate}`);
                }
            }
        } catch (err) {
            console.error(`❌ [SCHEDULER] Erreur globale :`, err.message);
        } finally {
            isSchedulerRunning = false;
        }
    }

    // Tick toutes les 5 minutes — le scheduler décide lui-même si on est en mode test ou production
    const TICK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
    console.log(`⏰ [SCHEDULER] Planificateur adaptatif démarré (tick toutes les 5 min).`);
    console.log(`⏰ [SCHEDULER]   → Mode TEST (≤ 0.01j) : exécution à chaque tick (5 min)`);
    console.log(`⏰ [SCHEDULER]   → Mode PRODUCTION (7/14/21/30j) : exécution quotidienne à ${DAILY_RUN_HOUR}h00`);

    setInterval(tickScheduler, TICK_INTERVAL_MS);
}


// ============================================================
// Démarrage du serveur
// ============================================================
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   🚀 Retenza Phase 1 — Node.js / Express.js      ║');
    console.log(`║   Serveur démarré sur http://localhost:${PORT}      ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║   Routes API :                                   ║');
    console.log('║   GET  /api/data                → KPIs + RFM    ║');
    console.log('║   GET  /api/transactions/:email → Achats client  ║');
    console.log('║   POST /api/recalculate         → Pipeline RFM   ║');
    console.log('║   POST /api/loyalty/credit      → Fidélité pts   ║');
    console.log('║   POST /api/loyalty/redeem      → Utiliser code  ║');
    console.log('║   GET  /api/loyalty/balance/:e  → Solde client   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    // Démarrer le planificateur adaptatif de tâches de fond
    startAdaptiveScheduler();
});

module.exports = app;
