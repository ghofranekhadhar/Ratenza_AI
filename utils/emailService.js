const nodemailer = require('nodemailer');

const isSmtpConfigured = () => {
    return !!(process.env.SMTP_HOST && process.env.SMTP_USER);
};

let transporter = null;

if (isSmtpConfigured()) {
    console.log(`🚀 [EMAIL SERVICE] SMTP configuré (${process.env.SMTP_HOST}:${process.env.SMTP_PORT}). Initialisation du transporteur...`);
    transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587', 10),
        secure: process.env.SMTP_SECURE === 'true', // true pour le port 465, false pour les autres ports
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS || '',
        },
        tls: {
            // Ne pas échouer sur les certificats autosignés (utile pour certains serveurs d'hébergement)
            rejectUnauthorized: false
        }
    });

    // Optionnel : vérifier la connexion SMTP de manière asynchrone au démarrage
    transporter.verify((error, success) => {
        if (error) {
            console.error('❌ [EMAIL SERVICE] Échec de la vérification de la connexion SMTP :', error.message);
        } else {
            console.log('✅ [EMAIL SERVICE] Connexion SMTP établie et prête à envoyer des e-mails.');
        }
    });
} else {
    console.log('⚠️ [EMAIL SERVICE] SMTP non configuré dans le fichier .env. Les e-mails seront lancés en MODE SIMULATION.');
}

/**
 * Envoie un e-mail en utilisant le transporteur SMTP ou le simule en écrivant dans les logs.
 * 
 * @param {Object} options
 * @param {string} options.to - Adresse de destination
 * @param {string} options.subject - Objet de l'e-mail
 * @param {string} options.text - Corps de texte brut
 * @param {string} [options.html] - Corps au format HTML (optionnel)
 * @returns {Promise<{status: 'sent' | 'simulated', messageId?: string, info?: string}>}
 */
const sendEmail = async ({ to, subject, text, html }) => {
    const from = process.env.EMAIL_FROM || '"Retenza AI" <contact@retenza.com>';

    if (!isSmtpConfigured()) {
        console.log('');
        console.log('📧 ─── [SIMULATION D\'ENVOI E-MAIL (SMTP non configuré)] ───');
        console.log(`   De           : ${from}`);
        console.log(`   Destinataire : <${to}>`);
        console.log(`   Sujet        : ${subject}`);
        console.log(`   Contenu      :\n${text}`);
        console.log('📧 ────────────────────────────────────────────────────────');
        console.log('');
        
        return { 
            status: 'simulated', 
            info: 'Simulation active : SMTP non configuré.' 
        };
    }

    try {
        const info = await transporter.sendMail({
            from,
            to,
            subject,
            text,
            html: html || text.replace(/\n/g, '<br>') // Fallback HTML automatique
        });
        console.log(`📧 [EMAIL SENT] E-mail envoyé avec succès à <${to}> (ID: ${info.messageId})`);
        return { 
            status: 'sent', 
            messageId: info.messageId 
        };
    } catch (error) {
        console.error(`❌ [EMAIL ERROR] Échec de l'envoi de l'e-mail à <${to}> :`, error.message);
        throw error;
    }
};

module.exports = {
    sendEmail,
    isSmtpConfigured
};
