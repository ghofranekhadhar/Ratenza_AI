const connectDB = require('../config/db');

// Helper pour générer le code de parrainage de façon déterministe en JS (au cas où non présent)
function getFallbackReferralCode(client) {
    const namePart = (client.nom || 'CL').split(' ')[0].replace(/[^a-zA-Z0-9]/g, '').toUpperCase() || 'CL';
    const emailPart = (client.email || 'REF').split('@')[0].replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase();
    return `REF-${namePart}-${emailPart}`;
}

// Helper pour calculer l'influence de façon déterministe
function getFallbackInfluenceScore(client) {
    const sa = client.score_global_sa || 0;
    const churn = client.churn_score || 0;
    return Math.round((sa * 0.7 + (1.0 - churn) * 0.3) * 100);
}

// ============================================================
// GET /api/referrals/stats
// Statistiques globales du programme de parrainage
// ============================================================
const getReferralStats = async (req, res) => {
    const commerceId = req.query.commerce_id;

    try {
        const db = await connectDB();
        const query = {};
        const iaQuery = {};
        if (commerceId && commerceId !== '__all__') {
            query.commerce_id = commerceId;
            iaQuery.commerce_id = commerceId;
        }

        // 1. Nombre total de parrainages (tous statuts)
        const totalReferrals = await db.collection('parrainages').countDocuments(query);

        // 2. Parrainages finalisés
        const completedQuery = { ...query, status: 'completed' };
        const completedReferrals = await db.collection('parrainages').countDocuments(completedQuery);

        // 3. Chiffre d'affaires généré par les filleuls (ROI)
        const roiResult = await db.collection('parrainages').aggregate([
            { $match: completedQuery },
            { $group: { _id: null, totalROI: { $sum: '$amount_generated' } } }
        ]).toArray();
        const totalROI = roiResult.length > 0 ? Math.round(roiResult[0].totalROI * 100) / 100 : 0;

        // 4. Taux de conversion
        const conversionRate = totalReferrals > 0 ? Math.round((completedReferrals / totalReferrals) * 1000) / 10 : 0;

        // 5. Nombre d'ambassadeurs (influence_score >= 80)
        // On récupère tous les clients de analyses_ia
        const clients = await db.collection('analyses_ia').find(iaQuery).toArray();
        let ambassadorsCount = 0;
        clients.forEach(c => {
            const score = c.influence_score !== undefined ? c.influence_score : getFallbackInfluenceScore(c);
            if (score >= 80) ambassadorsCount++;
        });

        return res.json({
            status: 'success',
            data: {
                totalReferrals,
                completedReferrals,
                totalROI,
                conversionRate,
                ambassadorsCount
            }
        });
    } catch (err) {
        console.error('❌ getReferralStats error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// GET /api/referrals/client/:email
// Détail des parrainages et récompenses d'un client spécifique
// ============================================================
const getClientReferralDetail = async (req, res) => {
    const { email } = req.params;
    const commerceId = req.query.commerce_id;

    if (!email) {
        return res.status(400).json({ error: 'Adresse e-mail requise.' });
    }

    try {
        const db = await connectDB();

        // 1. Trouver le client dans analyses_ia
        // Ne filtrer par commerce_id que si c'est une valeur non vide et non '__all__'
        const emailRegex = { $regex: new RegExp(`^${email.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}$`, 'i') };
        const clientQuery = { email: emailRegex };
        const hasCommerce = commerceId && commerceId !== '__all__' && commerceId !== '';
        if (hasCommerce) {
            clientQuery.commerce_id = commerceId;
        }

        let client = await db.collection('analyses_ia').findOne(clientQuery);

        // Fallback : chercher sans filtre commerce si pas trouvé
        if (!client && hasCommerce) {
            client = await db.collection('analyses_ia').findOne({ email: emailRegex });
        }

        if (!client) {
            // Dernier fallback : chercher par client_db_id (l'email peut être l'id)
            const idQuery = { client_db_id: email };
            if (hasCommerce) idQuery.commerce_id = commerceId;
            client = await db.collection('analyses_ia').findOne(idQuery);
        }

        // Si toujours non trouvé, tenter de chercher dans analyses_ia par client_db_id de manière insensible à la casse
        if (!client) {
            const idQueryRegex = { client_db_id: { $regex: new RegExp(`^${email}$`, 'i') } };
            if (hasCommerce) idQueryRegex.commerce_id = commerceId;
            client = await db.collection('analyses_ia').findOne(idQueryRegex);
        }

        if (!client) {
            return res.status(404).json({ status: 'not_found', error: 'Client non trouvé dans les analyses comportementales.' });
        }

        const score = client.influence_score !== undefined ? client.influence_score : getFallbackInfluenceScore(client);
        const code = client.referral_code || getFallbackReferralCode(client);
        const effectiveCommerceId = client.commerce_id || commerceId;

        // 2. Récupérer les filleuls parraines par ce client
        const sponsorQuery = { parrain_email: client.email };
        if (effectiveCommerceId && effectiveCommerceId !== '__all__') {
            sponsorQuery.commerce_id = effectiveCommerceId;
        }
        const referredClients = await db.collection('parrainages').find(sponsorQuery).sort({ date_parrainage: -1 }).toArray();

        // 3. Trouver si ce client a lui-même un parrain
        const filleulQuery = { filleul_email: client.email };
        if (effectiveCommerceId && effectiveCommerceId !== '__all__') {
            filleulQuery.commerce_id = effectiveCommerceId;
        }
        const sponsorDoc = await db.collection('parrainages').findOne(filleulQuery);

        // 4. Calculer les récompenses
        const completedCount = referredClients.filter(rc => rc.status === 'completed').length;

        const tiers = [
            { level: 1, name: "Bon de réduction de -10%", code: "PARRAIN10", required: 1, unlocked: completedCount >= 1 },
            { level: 2, name: "Bon de réduction de -20%", code: "PARRAIN20", required: 3, unlocked: completedCount >= 3 },
            { level: 3, name: "Statut Ambassadeur VIP + Cadeau", code: "VIPAMBASSADEUR", required: 5, unlocked: completedCount >= 5 }
        ];

        return res.json({
            status: 'success',
            data: {
                referral_code: code,
                influence_score: score,
                is_ambassador: score >= 80,
                sponsor: sponsorDoc ? { nom: sponsorDoc.parrain_nom, email: sponsorDoc.parrain_email } : null,
                referred_clients: referredClients,
                rewards: {
                    completed_count: completedCount,
                    tiers
                }
            }
        });
    } catch (err) {
        console.error('❌ getClientReferralDetail error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

// ============================================================
// POST /api/referrals/declare
// Déclarer un nouveau parrainage (filleul parrainé par code)
// ============================================================
const declareReferral = async (req, res) => {
    const { parrain_code, filleul_email, filleul_nom, commerce_id, amount } = req.body || {};

    if (!parrain_code || !filleul_email || !filleul_nom || !commerce_id) {
        return res.status(400).json({ error: 'Champs requis manquants : parrain_code, filleul_email, filleul_nom, commerce_id.' });
    }

    try {
        const db = await connectDB();

        // 1. Trouver le parrain associé au code de parrainage
        // On cherche en priorité par referral_code exact
        let parrain = await db.collection('analyses_ia').findOne({ commerce_id, referral_code: parrain_code });
        
        // Fallback s'il n'a pas encore de code stocké : générer et comparer en mémoire
        if (!parrain) {
            const allClients = await db.collection('analyses_ia').find({ commerce_id }).toArray();
            parrain = allClients.find(c => getFallbackReferralCode(c) === parrain_code);
        }

        if (!parrain) {
            return res.status(404).json({ error: 'Code de parrainage invalide.' });
        }

        // Vérifier qu'on ne se parraine pas soi-même
        if (parrain.email.toLowerCase() === filleul_email.toLowerCase()) {
            return res.status(400).json({ error: 'Un client ne peut pas se parrainer lui-même.' });
        }

        // 2. Vérifier si ce filleul a déjà été parrainé
        const existing = await db.collection('parrainages').findOne({ filleul_email: { $regex: new RegExp(`^${filleul_email}$`, 'i') }, commerce_id });
        if (existing) {
            return res.status(400).json({ error: 'Ce filleul a déjà été parrainé ou invité.' });
        }

        const isCompleted = !!amount && parseFloat(amount) > 0;

        // 3. Insérer le document de parrainage
        const referralDoc = {
            commerce_id,
            parrain_email: parrain.email,
            parrain_nom: parrain.nom,
            filleul_email: filleul_email.toLowerCase(),
            filleul_nom,
            status: isCompleted ? 'completed' : 'pending',
            date_parrainage: new Date().toISOString(),
            date_completion: isCompleted ? new Date().toISOString() : null,
            amount_generated: isCompleted ? parseFloat(amount) : 0,
            referral_code: parrain_code
        };

        await db.collection('parrainages').insertOne(referralDoc);

        // 5. Si le parrainage est complété, vérifier les paliers et envoyer un email de notification
        if (isCompleted) {
            const { sendEmail } = require('../utils/emailService');

            // Compter le total des parrainages complétés pour ce parrain
            const totalCompleted = await db.collection('parrainages').countDocuments({
                parrain_email: parrain.email,
                commerce_id,
                status: 'completed'
            });

            // Définir les paliers
            const TIERS = [
                {
                    at: 1,
                    code: 'PARRAIN10',
                    label: '-10% de réduction',
                    next: { count: 3, reward: '-20% sur votre prochain achat', code: 'PARRAIN20' }
                },
                {
                    at: 3,
                    code: 'PARRAIN20',
                    label: '-20% de réduction',
                    next: { count: 5, reward: 'Statut Ambassadeur VIP + Cadeau exclusif', code: 'VIPAMBASSADEUR' }
                },
                {
                    at: 5,
                    code: 'VIPAMBASSADEUR',
                    label: 'Statut Ambassadeur VIP + Cadeau exclusif',
                    next: null
                }
            ];

            const tier = TIERS.find(t => t.at === totalCompleted);

            if (tier) {
                const commerceName = parrain.commerce_id || 'notre boutique';

                let nextGoalText = '';
                if (tier.next) {
                    nextGoalText = `\n\n🎯 Prochain objectif : atteignez ${tier.next.count} parrainages pour débloquer "${tier.next.reward}" (code : ${tier.next.code}).`;
                } else {
                    nextGoalText = `\n\n🏆 Vous avez atteint le niveau maximum ! Vous êtes un véritable Ambassadeur VIP de notre boutique.`;
                }

                const subject = `🎉 Félicitations ! Vous avez débloqué ${tier.label} grâce à vos parrainages !`;

                const text = `Bonjour ${parrain.nom},

Bravo ! Vous venez d'enregistrer votre ${totalCompleted}${totalCompleted === 1 ? 'er' : 'ème'} parrainage complété.

🎁 En récompense, vous bénéficiez de : ${tier.label}
📌 Votre code de réduction : ${tier.code}

Utilisez ce code lors de votre prochain achat pour en profiter.${nextGoalText}

Merci pour votre fidélité et votre engagement à nos côtés !

L'équipe Retenza – ${commerceName}`;

                const html = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Récompense Parrainage</title></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;">
  <div style="max-width:580px;margin:32px auto;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background:linear-gradient(135deg,#eab308,#ca8a04);padding:32px 32px 24px;text-align:center;">
      <div style="font-size:2.5rem;margin-bottom:8px;">🎉</div>
      <h1 style="margin:0;color:#ffffff;font-size:1.4rem;font-weight:800;letter-spacing:-0.5px;">Félicitations, ${parrain.nom} !</h1>
      <p style="margin:8px 0 0;color:rgba(255,255,255,0.9);font-size:0.95rem;">Votre ${totalCompleted}${totalCompleted === 1 ? 'er' : 'ème'} parrainage a été validé</p>
    </div>
    <!-- Body -->
    <div style="padding:32px;">
      <p style="color:#475569;font-size:0.95rem;margin:0 0 20px;">Grâce à votre engagement, vous avez débloqué une nouvelle récompense :</p>

      <!-- Reward Box -->
      <div style="background:linear-gradient(135deg,rgba(234,179,8,0.08),rgba(202,138,4,0.04));border:2px solid rgba(234,179,8,0.3);border-radius:12px;padding:24px;text-align:center;margin-bottom:24px;">
        <div style="font-size:1.8rem;margin-bottom:8px;">🎁</div>
        <div style="font-size:1.1rem;font-weight:700;color:#92400e;margin-bottom:12px;">${tier.label}</div>
        <div style="display:inline-block;background:#ca8a04;color:white;font-family:monospace;font-size:1.3rem;font-weight:800;padding:10px 24px;border-radius:8px;letter-spacing:2px;">${tier.code}</div>
        <p style="color:#92400e;font-size:0.82rem;margin:10px 0 0;font-weight:500;">Utilisez ce code lors de votre prochain achat</p>
      </div>

      ${tier.next ? `
      <!-- Next Goal -->
      <div style="background:#f1f5f9;border-radius:10px;padding:18px;margin-bottom:24px;">
        <div style="font-size:0.85rem;font-weight:700;color:#475569;margin-bottom:8px;">🎯 Prochain objectif</div>
        <div style="display:flex;align-items:center;gap:10px;">
          <div style="background:#e2e8f0;border-radius:50%;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-weight:800;color:#64748b;font-size:0.9rem;flex-shrink:0;">${tier.next.count}</div>
          <div>
            <div style="font-size:0.9rem;font-weight:700;color:#1e293b;">Atteignez ${tier.next.count} parrainages complétés</div>
            <div style="font-size:0.82rem;color:#64748b;">Pour débloquer : <strong>${tier.next.reward}</strong> (code : <code style="background:#e2e8f0;padding:2px 6px;border-radius:4px;">${tier.next.code}</code>)</div>
          </div>
        </div>
      </div>
      ` : `
      <!-- VIP Max -->
      <div style="background:linear-gradient(135deg,rgba(234,179,8,0.1),rgba(202,138,4,0.05));border:2px solid rgba(234,179,8,0.25);border-radius:10px;padding:18px;margin-bottom:24px;text-align:center;">
        <div style="font-size:1.5rem;margin-bottom:6px;">👑</div>
        <div style="font-size:0.92rem;font-weight:700;color:#92400e;">Vous avez atteint le niveau maximum !</div>
        <div style="font-size:0.82rem;color:#b45309;margin-top:4px;">Vous êtes un véritable Ambassadeur VIP de notre boutique.</div>
      </div>
      `}

      <p style="color:#94a3b8;font-size:0.82rem;text-align:center;margin:0;">Merci pour votre fidélité et votre engagement à nos côtés 🙏</p>
    </div>
    <!-- Footer -->
    <div style="background:#f8fafc;padding:16px 32px;border-top:1px solid #e2e8f0;text-align:center;">
      <p style="margin:0;font-size:0.78rem;color:#94a3b8;">L'équipe <strong>Retenza</strong> — Programme de Parrainage</p>
    </div>
  </div>
</body>
</html>`;

                try {
                    await sendEmail({ to: parrain.email, subject, text, html });
                    console.log(`📧 [REFERRAL MILESTONE] Email palier ${totalCompleted} envoyé à ${parrain.email}`);
                } catch (emailErr) {
                    console.error('❌ [REFERRAL MILESTONE] Erreur envoi email palier :', emailErr.message);
                    // Ne pas faire échouer la requête si l'email échoue
                }
            }
        }

        // 4. Si complété, on crée le client et la transaction associés pour que l'historique soit propre
        if (isCompleted) {
            // Chercher si le filleul existe dans la collection clients
            let filleulClient = await db.collection('clients').findOne({ email: { $regex: new RegExp(`^${filleul_email}$`, 'i') }, commerce_id });
            let clientDbId;

            if (!filleulClient) {
                // Générer un id unique pour éviter le conflit d'index
                const crypto = require('crypto');
                const generatedId = 'client_' + crypto.createHash('md5')
                    .update(filleul_email.toLowerCase() + commerce_id)
                    .digest('hex').substring(0, 8);

                // Créer le client dans MongoDB
                const resInsert = await db.collection('clients').insertOne({
                    id: generatedId,
                    commerce_id,
                    nom: filleul_nom,
                    email: filleul_email.toLowerCase(),
                    date_creation: new Date().toISOString()
                });
                clientDbId = generatedId;
            } else {
                // Utiliser le champ 'id' custom s'il existe, sinon l'_id Mongo
                clientDbId = filleulClient.id || filleulClient._id.toString();
            }

            // Ajouter la transaction associée
            await db.collection('transactions').insertOne({
                commerce_id,
                client_id: clientDbId,
                date_transaction: new Date().toISOString(),
                montant: parseFloat(amount)
            });
        }

        return res.json({
            status: 'success',
            message: isCompleted 
                ? `Parrainage enregistré et finalisé avec succès pour ${filleul_nom} (ROI: ${amount} DT).`
                : `Invitation de parrainage envoyée avec succès à ${filleul_nom}.`
        });
    } catch (err) {
        console.error('❌ declareReferral error :', err.message);
        return res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getReferralStats,
    getClientReferralDetail,
    declareReferral
};
