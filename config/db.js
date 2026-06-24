const { MongoClient } = require('mongodb');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/';
const DB_NAME     = process.env.DB_NAME     || 'retenza_ai';

let _client = null;
let _db     = null;

/**
 * Retourne une connexion MongoDB réutilisable (singleton).
 */
async function connectDB() {
    if (_db) return _db;

    try {
        _client = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
        await _client.connect();
        await _client.db('admin').command({ ping: 1 });
        _db = _client.db(DB_NAME);
        console.log(`✅ MongoDB connecté : ${MONGODB_URI} — Base : ${DB_NAME}`);
        return _db;
    } catch (err) {
        console.error('❌ Impossible de se connecter à MongoDB :', err.message);
        process.exit(1);
    }
}

module.exports = connectDB;
