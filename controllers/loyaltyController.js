/**
 * loyaltyController.js
 * --------------------
 * Fonctionnalité 2 : Système de Points de Fidélité
 *
 * Règles métier :
 *   - Crédit : 1 point par tranche de 10 DT dépensés (floor).
 *   - Paliers de récompense :
 *       100 pts → code FID10  (-10% sur prochain achat)
 *       200 pts → code FID20  (-20% sur prochain achat)
 *       500 pts → code FIDVIP (Statut VIP + avantages exclusifs)
 *   - Un palier débloqué envoie un email de notification UNE SEULE FOIS.
 *   - Débit : déduit les points du palier utilisé, après vérification
 *     du solde ET de la non-utilisation antérieure du code (anti-fraude).
 *
 * Collections MongoDB :
 *   - points_fidelite      : solde courant par client (upsert)
 *   - points_transactions  : journal d'audit immuable (crédit / débit)
 *
 * Routes exposées (enregistrées dans loyaltyRoutes.js) :
 *   POST /api/loyalty/credit              → Créditer des points après achat
 *   POST /api/loyalty/redeem              → Débiter des points (utiliser un code)
 *   GET  /api/loyalty/balance/:email      → Solde + paliers d'un client
 *   GET  /api/loyalty/history/:email      → Journal d'audit complet
 */

'use strict';

const connectDB      = require('../config/db');
const { sendEmail }  = require('../utils/emailService');

// ============================================================
// CONSTANTES MÉTIER
// ============================================================

/** Nombre de DT par point (1 point = 10 DT dépensés) */
const DT_PAR_POINT = 10;

/**
 * Paliers de fidélité (ordre croissant obligatoire).
 * - cost : nombre de points débités quand le code est utilisé
 * - notified_field : champ booléen dans points_fidelite marquant l'email déjà envoyé
 */
const PALIERS = [
    {
        points_requis : 100,
        code          : 'FID10',
        label         : '-10% sur votre prochain achat',
        cost          : 100,
        notified_field: 'palier_fid10_notifie'
    },
    {
        points_requis : 200,
        code          : 'FID20',
        label         : '-20% sur votre prochain achat',
        cost          : 200,
        notified_field: 'palier_fid20_notifie'
    },
    {
        points_requis : 500,
        code          : 'FIDVIP',
        label         : 'Statut VIP + avantages exclusifs',
        cost          : 500,
        notified_field: 'palier_fidvip_notifie'
    }
];

// ============================================================
// HELPER : Construire l'email HTML de notification de palier
// ============================================================
function buildTierEmail(nomClient, palier, pointsCumules, prochainPalier) {
    const nextGoalHtml = prochainPalier
        ? `<div style="background:#f1f5f9;border-radius:10px;padding:18px;margin-bottom:24px;">
             <div style="font-size:0.85rem;font-weight:700;color:#475569;margin-bottom:8px;">🎯 Prochain objectif</div>
             <div style="font-size:0.9rem;color:#1e293b;">
               Atteignez <strong>${prochainPalier.points_requis} points</strong> pour débloquer
               <strong>${prochainPalier.label}</strong>
               (code&nbsp;: <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;">${prochainPalier.code}</code>)
             </div>
           </div>`
        : `<div style="background:linear-gradient(135deg,rgba(234,179,8,0.1),rgba(202,138,4,0.05));
                        border:2px solid rgba(234,179,8,0.25);border-radius:10px;
                        padding:18px;margin-bottom:24px;text-align:center;">
             <div style="font-size:1.5rem;margin-bottom:6px;">👑</div>
             <div style="font-size:0.92rem;font-weight:700;color:#92400e;">
               Vous avez atteint le niveau maximum des points fidélité !
             </div>
           </div>`;

    const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><title>Récompense Fidélité</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#fff;border-radius:16px;
              overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#6366f1,#4f46e5);padding:32px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:8px;">🏆</div>
      <h1 style="margin:0;color:#fff;font-size:1.4rem;font-weight:800;">
        Félicitations, ${nomClient} !
      </h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:0.95rem;">
        Vous venez de débloquer un palier de fidélité
      </p>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#475569;font-size:0.95rem;margin:0 0 20px;">
        Grâce à vos <strong>${pointsCumules} points</strong> accumulés, vous avez débloqué :
      </p>
      <!-- Récompense -->
      <div style="background:linear-gradient(135deg,rgba(99,102,241,0.08),rgba(79,70,229,0.04));
                  border:2px solid rgba(99,102,241,0.3);border-radius:12px;
                  padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:1.8rem;margin-bottom:8px;">🎁</div>
        <div style="font-size:1.1rem;font-weight:700;color:#3730a3;margin-bottom:12px;">
          ${palier.label}
        </div>
        <div style="display:inline-block;background:#4f46e5;color:white;
                    font-family:monospace;font-size:1.3rem;font-weight:800;
                    padding:10px 24px;border-radius:8px;letter-spacing:2px;">
          ${palier.code}
        </div>
        <p style="color:#4338ca;font-size:0.82rem;margin:10px 0 0;font-weight:500;">
          Utilisez ce code lors de votre prochain achat
        </p>
      </div>
      ${nextGoalHtml}
      <p style="color:#94a3b8;font-size:0.82rem;text-align:center;margin:0;">
        Merci pour votre fidélité 🙏 — L'équipe Retenza
      </p>
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0;font-size:0.78rem;color:#94a3b8;">
        Retenza AI — Programme de Points Fidélité
      </p>
    </div>
  </div>
</body>
</html>`;

    const text = `Bonjour ${nomClient},\n\nFélicitations ! Vous avez atteint ${pointsCumules} points de fidélité.\n\n` +
        `🎁 Récompense débloquée : ${palier.label}\n📌 Votre code : ${palier.code}\n\n` +
        `Utilisez ce code lors de votre prochain achat pour en profiter.\n\n` +
        (prochainPalier
            ? `🎯 Prochain objectif : ${prochainPalier.points_requis} points → ${prochainPalier.label} (${prochainPalier.code})\n\n`
            : `👑 Vous avez atteint le niveau maximum !\n\n`) +
        `Merci pour votre fidélité !\n\nL'équipe Retenza`;

    return { html, text };
}

// ============================================================
// POST /api/loyalty/credit
// Créditer des points après un achat.
// Body: { commerce_id, client_email, client_nom, montant }
// ============================================================
const creditPoints = async (req, res) => {
    const { commerce_id, client_email, client_nom, montant } = req.body || {};

    if (!commerce_id || !client_email || !montant) {
        return res.status(400).json({
            error: 'Champs requis manquants : commerce_id, client_email, montant.'
        });
    }

    const montantNum = parseFloat(montant);
    if (isNaN(montantNum) || montantNum <= 0) {
        return res.status(400).json({ error: 'Le montant doit être un nombre positif.' });
    }

    // Calcul du nombre de points gagnés : floor(montant / 10)
    const pointsGagnes = Math.floor(montantNum / DT_PAR_POINT);
    if (pointsGagnes === 0) {
        return res.json({
            status: 'info',
            message: `Montant insuffisant pour gagner des points (minimum ${DT_PAR_POINT} DT par point).`,
            points_gagnes: 0
        });
    }

    try {
        const db  = await connectDB();
        const now = new Date().toISOString();
        const nomClient = client_nom || client_email;

        // 1. Récupérer ou créer le solde de fidélité
        let solde = await db.collection('points_fidelite').findOne({
            commerce_id,
            client_email: client_email.toLowerCase()
        });

        const ancienSolde = solde ? solde.points_disponibles : 0;
        const nouveauTotal = (solde ? solde.points_cumules : 0) + pointsGagnes;
        const nouveauDisponible = ancienSolde + pointsGagnes;

        // 2. Upsert du solde
        await db.collection('points_fidelite').updateOne(
            { commerce_id, client_email: client_email.toLowerCase() },
            {
                $set: {
                    commerce_id,
                    client_email     : client_email.toLowerCase(),
                    client_nom       : nomClient,
                    points_cumules   : nouveauTotal,
                    points_disponibles: nouveauDisponible,
                    derniere_maj     : now
                },
                $setOnInsert: {
                    date_creation           : now,
                    palier_fid10_notifie    : false,
                    palier_fid20_notifie    : false,
                    palier_fidvip_notifie   : false
                }
            },
            { upsert: true }
        );

        // 3. Journal d'audit : enregistrer la transaction de crédit
        await db.collection('points_transactions').insertOne({
            commerce_id,
            client_email      : client_email.toLowerCase(),
            client_nom        : nomClient,
            type              : 'credit',
            points            : pointsGagnes,
            montant_transaction: montantNum,
            solde_avant       : ancienSolde,
            solde_apres       : nouveauDisponible,
            date              : now,
            description       : `Achat de ${montantNum} DT → +${pointsGagnes} pts`
        });

        console.log(`💎 [LOYALTY] Crédit : +${pointsGagnes} pts pour ${client_email} (achat ${montantNum} DT) | Solde: ${nouveauDisponible} pts`);

        // 4. Vérifier les paliers débloqués et envoyer email si nouveau palier atteint
        // Recharger le document pour avoir l'état des flags de notification
        const soldeMaj = await db.collection('points_fidelite').findOne({
            commerce_id,
            client_email: client_email.toLowerCase()
        });

        const paliersNotifies = [];

        for (const palier of PALIERS) {
            // Le palier est atteint ET la notification n'a pas encore été envoyée
            if (nouveauTotal >= palier.points_requis && !soldeMaj[palier.notified_field]) {

                // Marquer le palier comme notifié avant l'envoi (évite un double envoi si crash)
                await db.collection('points_fidelite').updateOne(
                    { commerce_id, client_email: client_email.toLowerCase() },
                    { $set: { [palier.notified_field]: true } }
                );

                // Identifier le prochain palier (pour le message d'encouragement)
                const indexPalier   = PALIERS.indexOf(palier);
                const prochainPalier = indexPalier < PALIERS.length - 1 ? PALIERS[indexPalier + 1] : null;

                // Construire et envoyer l'email de félicitations
                const { html, text } = buildTierEmail(nomClient, palier, nouveauTotal, prochainPalier);
                const subject = `🏆 ${nomClient}, vous avez débloqué ${palier.label} !`;

                try {
                    await sendEmail({ to: client_email, subject, text, html });
                    console.log(`📧 [LOYALTY] Email palier "${palier.code}" envoyé à ${client_email}`);
                } catch (emailErr) {
                    console.error(`❌ [LOYALTY] Échec email palier ${palier.code} pour ${client_email} :`, emailErr.message);
                }

                paliersNotifies.push(palier.code);
            }
        }

        return res.json({
            status          : 'success',
            message         : `+${pointsGagnes} points crédités avec succès.`,
            points_gagnes   : pointsGagnes,
            solde_avant     : ancienSolde,
            solde_apres     : nouveauDisponible,
            points_cumules  : nouveauTotal,
            paliers_debloques: paliersNotifies
        });

    } catch (err) {
        console.error('❌ creditPoints error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/loyalty/redeem
// Débiter des points (utilisation d'un code de récompense).
// Body: { commerce_id, client_email, code_promo }
//
// Anti-fraude :
//   1. Vérifie que le client a assez de points disponibles.
//   2. Vérifie que le palier n'a PAS déjà été débité (un seul débit par palier).
//   3. Déduit les points et enregistre la transaction de débit.
// ============================================================
const redeemPoints = async (req, res) => {
    const { commerce_id, client_email, code_promo } = req.body || {};

    if (!commerce_id || !client_email || !code_promo) {
        return res.status(400).json({
            error: 'Champs requis manquants : commerce_id, client_email, code_promo.'
        });
    }

    // Trouver le palier correspondant au code
    const palier = PALIERS.find(p => p.code === code_promo.toUpperCase().trim());
    if (!palier) {
        return res.status(400).json({
            error: `Code de récompense inconnu : "${code_promo}". Codes valides : FID10, FID20, FIDVIP.`
        });
    }

    try {
        const db  = await connectDB();
        const now = new Date().toISOString();

        // 1. Récupérer le solde du client
        const solde = await db.collection('points_fidelite').findOne({
            commerce_id,
            client_email: client_email.toLowerCase()
        });

        if (!solde) {
            return res.status(404).json({
                error: 'Aucun compte de points fidélité trouvé pour ce client.'
            });
        }

        // 2. Vérifier le solde disponible
        if (solde.points_disponibles < palier.cost) {
            return res.status(400).json({
                error: `Solde insuffisant. Requis : ${palier.cost} pts | Disponible : ${solde.points_disponibles} pts.`,
                solde_disponible: solde.points_disponibles,
                points_requis   : palier.cost
            });
        }

        // 3. Anti-fraude : vérifier qu'aucune transaction de débit n'existe déjà pour ce code
        const dejaUtilise = await db.collection('points_transactions').findOne({
            commerce_id,
            client_email: client_email.toLowerCase(),
            type        : 'debit',
            code_promo  : palier.code
        });

        if (dejaUtilise) {
            return res.status(400).json({
                error: `Le code "${palier.code}" a déjà été utilisé une fois. Chaque code de récompense est utilisable une seule fois par palier.`,
                date_utilisation: dejaUtilise.date
            });
        }

        const ancienSolde    = solde.points_disponibles;
        const nouveauSolde   = ancienSolde - palier.cost;
        const pointsUtilises = (solde.points_utilises || 0) + palier.cost;

        // 4. Mettre à jour le solde
        await db.collection('points_fidelite').updateOne(
            { commerce_id, client_email: client_email.toLowerCase() },
            {
                $set: {
                    points_disponibles: nouveauSolde,
                    points_utilises   : pointsUtilises,
                    derniere_maj      : now
                }
            }
        );

        // 5. Enregistrer la transaction de débit (preuve d'utilisation anti-fraude)
        await db.collection('points_transactions').insertOne({
            commerce_id,
            client_email: client_email.toLowerCase(),
            client_nom  : solde.client_nom,
            type        : 'debit',
            points      : -palier.cost,
            code_promo  : palier.code,
            label_palier: palier.label,
            solde_avant : ancienSolde,
            solde_apres : nouveauSolde,
            date        : now,
            description : `Utilisation du code ${palier.code} (${palier.label})`
        });

        console.log(`💸 [LOYALTY] Débit : -${palier.cost} pts (${palier.code}) pour ${client_email} | Solde restant: ${nouveauSolde} pts`);

        return res.json({
            status          : 'success',
            message         : `Code "${palier.code}" utilisé avec succès. ${palier.cost} points débités.`,
            code_promo      : palier.code,
            label           : palier.label,
            points_debites  : palier.cost,
            solde_avant     : ancienSolde,
            solde_apres     : nouveauSolde
        });

    } catch (err) {
        console.error('❌ redeemPoints error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/loyalty/balance/:email?commerce_id=...
// Solde courant + état des paliers d'un client.
// ============================================================
const getLoyaltyBalance = async (req, res) => {
    const { email }    = req.params;
    const commerce_id  = req.query.commerce_id;

    if (!email) {
        return res.status(400).json({ error: 'Email du client requis.' });
    }

    try {
        const db    = await connectDB();
        const query = { client_email: email.toLowerCase() };
        if (commerce_id && commerce_id !== '__all__') {
            query.commerce_id = commerce_id;
        }

        const solde = await db.collection('points_fidelite').findOne(query);

        if (!solde) {
            // Client sans aucun point encore : retourner un solde vide plutôt qu'une 404
            return res.json({
                status             : 'success',
                data               : {
                    client_email       : email.toLowerCase(),
                    points_cumules     : 0,
                    points_disponibles : 0,
                    points_utilises    : 0,
                    paliers            : PALIERS.map(p => ({
                        code          : p.code,
                        label         : p.label,
                        points_requis : p.points_requis,
                        debloque      : false,
                        notifie       : false
                    }))
                }
            });
        }

        // Construire l'état des paliers
        const paliersState = PALIERS.map(p => ({
            code          : p.code,
            label         : p.label,
            points_requis : p.points_requis,
            debloque      : solde.points_cumules >= p.points_requis,
            notifie       : !!solde[p.notified_field]
        }));

        return res.json({
            status: 'success',
            data  : {
                client_email       : solde.client_email,
                client_nom         : solde.client_nom,
                points_cumules     : solde.points_cumules     || 0,
                points_disponibles : solde.points_disponibles || 0,
                points_utilises    : solde.points_utilises    || 0,
                derniere_maj       : solde.derniere_maj,
                paliers            : paliersState
            }
        });

    } catch (err) {
        console.error('❌ getLoyaltyBalance error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/loyalty/history/:email?commerce_id=...
// Journal d'audit complet (crédit + débit) d'un client.
// ============================================================
const getLoyaltyHistory = async (req, res) => {
    const { email }   = req.params;
    const commerce_id = req.query.commerce_id;

    if (!email) {
        return res.status(400).json({ error: 'Email du client requis.' });
    }

    try {
        const db    = await connectDB();
        const query = { client_email: email.toLowerCase() };
        if (commerce_id && commerce_id !== '__all__') {
            query.commerce_id = commerce_id;
        }

        const history = await db.collection('points_transactions')
            .find(query)
            .sort({ date: -1 })
            .toArray();

        return res.json({
            status: 'success',
            data  : {
                client_email : email.toLowerCase(),
                total_entries: history.length,
                transactions : history.map(t => ({
                    type              : t.type,
                    points            : t.points,
                    description       : t.description,
                    code_promo        : t.code_promo || null,
                    montant_transaction: t.montant_transaction || null,
                    solde_avant       : t.solde_avant,
                    solde_apres       : t.solde_apres,
                    date              : t.date
                }))
            }
        });

    } catch (err) {
        console.error('❌ getLoyaltyHistory error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    creditPoints,
    redeemPoints,
    getLoyaltyBalance,
    getLoyaltyHistory
};
