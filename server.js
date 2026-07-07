require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const rfmRoutes = require('./routes/rfmRoutes');

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
const { runSmartAutomationInternal } = require('./controllers/rfmController');
const connectDB = require('./config/db');

function startDailyScheduler() {
    const TARGET_HOUR = 9;

    function getMsUntilTarget() {
        const now = new Date();
        const target = new Date();
        target.setHours(TARGET_HOUR, 0, 0, 0);

        if (now.getTime() >= target.getTime()) {
            // C'est déjà passé pour aujourd'hui, on planifie pour demain
            target.setDate(target.getDate() + 1);
        }
        return target.getTime() - now.getTime();
    }

    async function executeCampaignsForAllCommerces() {
        console.log(`⏰ [SCHEDULER] Lancement automatique de la campagne IA à ${new Date().toLocaleString('fr-FR')}`);
        try {
            const db = await connectDB();
            // Récupérer tous les commerces actifs dans le système
            const commerceIds = await db.collection('clients').distinct('commerce_id');
            console.log(`⏰ [SCHEDULER] Commerces détectés :`, commerceIds);

            for (const commerceId of commerceIds) {
                console.log(`⏰ [SCHEDULER] Traitement automatique pour le commerce : ${commerceId}`);
                const result = await runSmartAutomationInternal(commerceId);
                console.log(`⏰ [SCHEDULER] Résultat pour ${commerceId} :`, result.message, result.stats);
            }
        } catch (err) {
            console.error(`❌ [SCHEDULER] Erreur globale lors de l'exécution automatique :`, err.message);
        }
    }

    function runDailyTask() {
        executeCampaignsForAllCommerces();
        // Reprogrammer pour dans 24 heures
        setTimeout(runDailyTask, 24 * 60 * 60 * 1000);
    }

    const delay = getMsUntilTarget();
    const targetDate = new Date(Date.now() + delay);
    console.log(`⏰ [SCHEDULER] Planification quotidienne active. Prochaine exécution le : ${targetDate.toLocaleString('fr-FR')}`);

    setTimeout(runDailyTask, delay);
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
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');

    // Démarrer le planificateur de tâches de fond
    startDailyScheduler();
});

module.exports = app;
