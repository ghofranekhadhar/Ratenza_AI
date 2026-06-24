require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const path     = require('path');
const rfmRoutes = require('./routes/rfmRoutes');

const app  = express();
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
// Démarrage du serveur
// ============================================================
app.listen(PORT, () => {
    console.log('');
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║   🚀 Ratenza Phase 1 — Node.js / Express.js      ║');
    console.log(`║   Serveur démarré sur http://localhost:${PORT}      ║`);
    console.log('╠══════════════════════════════════════════════════╣');
    console.log('║   Routes API :                                   ║');
    console.log('║   GET  /api/data                → KPIs + RFM    ║');
    console.log('║   GET  /api/transactions/:email → Achats client  ║');
    console.log('║   POST /api/recalculate         → Pipeline RFM   ║');
    console.log('╚══════════════════════════════════════════════════╝');
    console.log('');
});

module.exports = app;
