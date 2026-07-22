"use client";

import { useEffect, useState, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import {
  Mail,
  Sparkles,
  Loader2,
  Users,
  CheckCircle,
  AlertCircle,
  Calendar,
  Send,
  Play,
  History,
  ShieldCheck,
  TrendingDown,
  Crown,
  Gift,
  Clock,
  Zap,
  Bot,
  Download
} from "lucide-react";
import { ToastContainer, useToast } from "@/components/Toast";

interface ClientData {
  email: string;
  nom: string;
  commerce_id: string;
  segment_gmm?: string;
  churn_score?: number;
  influence_score?: number;
  baisse_frequence_detectee?: boolean;
  points_cumules?: number;
  rgpd_opt_out?: boolean;
}

interface CampaignHistoryItem {
  _id: string;
  commerce_id: string;
  client_email: string;
  client_nom: string;
  segment: string;
  subject: string;
  body: string;
  sent_at: string;
  status: string;
  category?: string;
}

interface AutomationStats {
  ambassador_invite?: number;
  birthday_gift?: number;
  vip_danger?: number;
  vip?: number;
  regular?: number;
  baisse_frequence?: number;
  at_risk?: number;
  lost?: number;
  skipped_cooldown?: number;
}

function CampaignsContent() {
  const searchParams = useSearchParams();
  const [selectedCommerce, setSelectedCommerce] = useState<string>("__all__");
  const [clients, setClients] = useState<ClientData[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [history, setHistory] = useState<CampaignHistoryItem[]>([]);

  // Manual Campaign Form States
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [targetSegment, setTargetSegment] = useState<string>("all");
  const [onlyBaisse, setOnlyBaisse] = useState<boolean>(false);
  const [onlyAmbassadors, setOnlyAmbassadors] = useState<boolean>(false);
  const [onlyCloseToPalier, setOnlyCloseToPalier] = useState<boolean>(false);

  // Automation states
  const [autoRunning, setAutoRunning] = useState<boolean>(false);
  const [autoStartedAt, setAutoStartedAt] = useState<string | null>(null);
  const [autoLastResult, setAutoLastResult] = useState<{ message: string; stats: AutomationStats } | null>(null);
  const [autoLastError, setAutoLastError] = useState<string | null>(null);

  // Feedback states
  const [formSuccess, setFormSuccess] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sendingCampaign, setSendingCampaign] = useState<boolean>(false);
  const [triggeringAuto, setTriggeringAuto] = useState<boolean>(false);

  // Toast system
  const { toasts, addToast, removeToast } = useToast();

  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Load selected commerce & parse query params
  useEffect(() => {
    const saved = localStorage.getItem("ratenza_commerce_id");
    if (saved) {
      setSelectedCommerce(saved);
    }

    // Pre-fill filters from query parameters (from dashboard redirection)
    if (searchParams.get("onlyBaisse") === "true") {
      setOnlyBaisse(true);
    }
    if (searchParams.get("close_to_palier") === "true") {
      setOnlyCloseToPalier(true);
    }
    if (searchParams.get("segment_gmm")) {
      setTargetSegment(searchParams.get("segment_gmm") || "all");
    }
  }, [searchParams]);

  // Load clients & campaign history
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        let clientsList: ClientData[] = [];
        if (selectedCommerce === "__all__") {
          const shopsRes = await fetch("/api/commerces");
          const shops = await shopsRes.json();
          const allPromises = shops.map((c: any) =>
            fetch(`/api/data?commerce_id=${encodeURIComponent(c.id)}`).then((r) => r.json())
          );
          const results = await Promise.all(allPromises);
          clientsList = results.flat().filter((d: any) => !d.error);
        } else {
          const res = await fetch(`/api/data?commerce_id=${encodeURIComponent(selectedCommerce)}`);
          const data = await res.json();
          clientsList = Array.isArray(data) ? data : [];
        }
        setClients(clientsList);

        // Fetch global campaign history using __all__ endpoint
        const histRes = await fetch(`/api/campaigns/history/__all__?commerce_id=${encodeURIComponent(selectedCommerce)}`);
        const histData = await histRes.json();
        setHistory(Array.isArray(histData) ? histData : []);
      } catch (err) {
        console.error("Failed to load campaigns page data:", err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, [selectedCommerce]);

  // Status Polling for SmartAutomation
  const checkAutomationStatus = async () => {
    try {
      const res = await fetch("/api/campaigns/automation-status");
      const data = await res.json();
      if (data.status === "success") {
        setAutoRunning(data.running);
        setAutoStartedAt(data.startedAt);
        setAutoLastResult(data.result);
        setAutoLastError(data.error);

        if (!data.running && pollIntervalRef.current) {
          // Automation finished, stop polling
          clearInterval(pollIntervalRef.current);
          pollIntervalRef.current = null;
          // Refresh global campaign history
          const histRes = await fetch(`/api/campaigns/history/__all__?commerce_id=${encodeURIComponent(selectedCommerce)}`);
          const histData = await histRes.json();
          setHistory(Array.isArray(histData) ? histData : []);
        }
      }
    } catch (err) {
      console.error("Error polling automation status:", err);
    }
  };

  // Start polling if autoRunning becomes true or on load if active
  useEffect(() => {
    checkAutomationStatus();
    pollIntervalRef.current = setInterval(checkAutomationStatus, 3000);
    return () => {
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
      }
    };
  }, [selectedCommerce]);

  // Calculate targeted clients count in real time
  const getTargetedClients = () => {
    return clients.filter((c) => {
      if (c.rgpd_opt_out === true) return false;

      // Filter by GMM segment
      if (targetSegment !== "all" && c.segment_gmm !== targetSegment) return false;

      // Filter by purchase drop
      if (onlyBaisse && c.baisse_frequence_detectee !== true) return false;

      // Filter by close to palier
      if (onlyCloseToPalier) {
        const pts = c.points_cumules || 0;
        const inPalier = (pts >= 80 && pts < 100) || (pts >= 180 && pts < 200);
        if (!inPalier) return false;
      }

      // Filter by ambassador status
      if (onlyAmbassadors) {
        const score = c.influence_score !== undefined
          ? c.influence_score
          : Math.round(((c.churn_score || 0) * 0.3) * 100);
        if (score < 80) return false;
      }

      return true;
    });
  };

  const targetedCount = getTargetedClients().length;

  // Trigger SmartAutomation IA
  const handleTriggerAutomation = async () => {
    if (autoRunning) return;
    setTriggeringAuto(true);
    setAutoLastError(null);
    try {
      const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;
      const res = await fetch("/api/campaigns/trigger-automation", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commerce_id: targetId })
      });
      const data = await res.json();
      if (res.status === 202 || res.status === 200) {
        setAutoRunning(true);
        setAutoStartedAt(data.startedAt);
        addToast("⚡ Automatisation IA lancée en arrière-plan...", "info");
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = setInterval(checkAutomationStatus, 3000);
      } else {
        setAutoLastError(data.message || "Impossible de lancer l'automatisation.");
        addToast(data.message || "Impossible de lancer l'automatisation.", "error");
      }
    } catch (err: any) {
      setAutoLastError("Erreur de connexion : " + err.message);
      addToast("Erreur de connexion : " + err.message, "error");
    } finally {
      setTriggeringAuto(false);
    }
  };

  // Send Group Campaign
  const handleSendGroupCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subject.trim() || !body.trim()) {
      setFormError("Veuillez saisir un objet et un corps de message.");
      return;
    }
    if (targetedCount === 0) {
      setFormError("Aucun client ciblé ne correspond aux critères sélectionnés.");
      return;
    }

    setSendingCampaign(true);
    setFormSuccess(null);
    setFormError(null);

    const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;

    try {
      const res = await fetch("/api/campaigns/send-group", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commerce_id: targetId,
          subject,
          body,
          filters: {
            onlyBaisse,
            onlyAmbassadors,
            segment_gmm: targetSegment,
            close_to_palier: onlyCloseToPalier
          }
        })
      });
      const data = await res.json();
      if (res.ok && data.status === "success") {
        setFormSuccess(data.message);
        addToast("📨 " + (data.message || "Campagne groupée envoyée avec succès !"), "success");
        setSubject("");
        setBody("");
        const histRes = await fetch(`/api/campaigns/history/__all__?commerce_id=${encodeURIComponent(selectedCommerce)}`);
        const histData = await histRes.json();
        setHistory(Array.isArray(histData) ? histData : []);
      } else {
        setFormError(data.error || "Une erreur est survenue lors de l'envoi.");
        addToast(data.error || "Une erreur est survenue lors de l'envoi.", "error");
      }
    } catch (err: any) {
      setFormError("Erreur réseau : " + err.message);
      addToast("Erreur réseau : " + err.message, "error");
    } finally {
      setSendingCampaign(false);
    }
  };

  return (
    <>
    <div className="flex-1 p-8 max-w-7xl mx-auto w-full flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <h2 className="text-xl font-bold text-slate-800">Gestion des Campagnes & Automatisation</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Suivi des envois groupés, statistiques de ciblage et automatisation IA
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Boutique Selector */}
          <select
            value={selectedCommerce}
            onChange={(e) => setSelectedCommerce(e.target.value)}
            className="bg-white border border-[#e5e5e5] px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none hover:border-slate-300 focus:border-blue-600 transition-all cursor-pointer shadow-sm shrink-0"
          >
            <option value="__all__">Toutes les boutiques</option>
            <option value="commerce_local_1">Commerce Local 1</option>
            <option value="commerce_local_2">Commerce Local 2</option>
            <option value="boutique_paris">Boutique Paris</option>
          </select>

          <a
            href={`/api/export/campaigns?commerce_id=${selectedCommerce}`}
            download
            className="bg-white border border-[#e5e5e5] hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Exporter CSV
          </a>
        </div>
      </div>

      {/* Main Grid: Form Left, SmartAutomation Right */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 shrink-0">
        {/* Left 2/3 - Group Campaign Creator */}
        <div className="lg:col-span-2 bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
          <div className="flex items-center gap-2 border-b border-slate-100 pb-3">
            <Mail className="w-5 h-5 text-blue-600" />
            <h3 className="font-extrabold text-slate-800 text-sm">Créer une Campagne de Groupe</h3>
          </div>

          {formSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-800 flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-600" />
              <span>{formSuccess}</span>
            </div>
          )}

          {formError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-bold text-rose-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-rose-600" />
              <span>{formError}</span>
            </div>
          )}

          <form onSubmit={handleSendGroupCampaign} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Target Segment */}
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-slate-500">Segment GMM cible</label>
                <select
                  value={targetSegment}
                  onChange={(e) => setTargetSegment(e.target.value)}
                  className="bg-[#f8fafc] border border-[#e5e5e5] px-3 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white transition-all cursor-pointer"
                >
                  <option value="all">Tous les clients</option>
                  <option value="vip">VIP uniquement</option>
                  <option value="regular">Réguliers uniquement</option>
                  <option value="at_risk">À risque uniquement</option>
                  <option value="lost">Perdus uniquement</option>
                </select>
              </div>

              {/* Dynamic Reach Meter */}
              <div className="bg-blue-50/40 border border-blue-100 rounded-xl p-3 flex flex-col justify-center items-center text-center">
                <span className="text-[10px] font-bold text-slate-400 uppercase">Portée Estimée</span>
                <strong className="text-lg font-black text-blue-600 mt-0.5">{targetedCount} clients ciblés</strong>
                <span className="text-[9px] text-slate-400 font-medium">(Hors désabonnés RGPD)</span>
              </div>
            </div>

            {/* Target Options Toggles */}
            <div className="bg-slate-50 p-4 rounded-xl border border-slate-100/50 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => setOnlyBaisse(!onlyBaisse)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  onlyBaisse
                    ? "bg-gradient-to-r from-red-400 to-red-500 border-red-500 text-white shadow-sm"
                    : "bg-white border-[#e5e5e5] text-red-500 hover:border-red-200 hover:bg-red-50/20"
                }`}
              >
                <TrendingDown className="w-3.5 h-3.5" />
                Baisse Fréquence
              </button>

              <button
                type="button"
                onClick={() => setOnlyAmbassadors(!onlyAmbassadors)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  onlyAmbassadors
                    ? "bg-gradient-to-r from-yellow-500 to-yellow-600 border-yellow-600 text-white shadow-sm"
                    : "bg-white border-[#e5e5e5] text-yellow-600 hover:border-yellow-200 hover:bg-yellow-50/20"
                }`}
              >
                <Crown className="w-3.5 h-3.5" />
                Ambassadeurs
              </button>

              <button
                type="button"
                onClick={() => setOnlyCloseToPalier(!onlyCloseToPalier)}
                className={`px-3 py-2 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  onlyCloseToPalier
                    ? "bg-gradient-to-r from-blue-600 to-blue-700 border-blue-700 text-white shadow-sm"
                    : "bg-white border-[#e5e5e5] text-blue-600 hover:border-blue-200 hover:bg-blue-50/20"
                }`}
              >
                <Gift className="w-3.5 h-3.5" />
                Proche Palier
              </button>
            </div>

            {/* AI Template Suggestions — dynamic based on active filters */}
            {(() => {
              const templates: { label: string; subject: string; body: string }[] = [];

              if (onlyCloseToPalier) {
                templates.push({
                  label: "🎯 Objectif Palier Fidélité Proche",
                  subject: "Plus que quelques points pour votre réduction, {nom} ! 🎯",
                  body: "Bonjour {nom},\n\nVous êtes tout près du but ! Il ne vous manque que quelques points pour franchir votre prochain palier de fidélité et débloquer votre récompense exclusive (code : FID10 ou FID20).\n\nFaites un achat dès aujourd'hui pour valider votre avantage !\n\nL'équipe Retenza 💛"
                });
              }

              if (onlyBaisse) {
                templates.push({
                  label: "📉 Relance Baisse Fréquence",
                  subject: "Vous nous manquez, {nom} ! Une petite attention pour votre retour 💛",
                  body: "Bonjour {nom},\n\nNous avons remarqué que vos visites se sont espacées ces derniers temps. Votre fidélité nous est précieuse !\n\nPour fêter votre retour, profitez d'une offre spéciale de -15% sur votre prochain achat :\n👉 Code promo : RETOUR15\n\nÀ très bientôt dans nos boutiques !\n\nL'équipe Retenza 💛"
                });
              }

              if (onlyAmbassadors) {
                templates.push({
                  label: "👑 Invitation Programme Ambassadeur",
                  subject: "{nom}, devenez notre Ambassadeur Officiel ! 👑",
                  body: "Bonjour {nom},\n\nGrâce à votre fidélité exceptionnelle, l'IA de Retenza vous a sélectionné(e) comme Ambassadeur Officiel !\n\nPartagez votre code de parrainage personnel avec vos proches et débloquez :\n   - 1 filleul  → -10% sur votre prochain achat (PARRAIN10)\n   - 3 filleuls → -20% sur votre prochain achat (PARRAIN20)\n   - 5 filleuls → Statut VIP + avantages exclusifs (VIPAMBASSADEUR)\n\nMerci pour votre confiance et votre rayonnement.\n\nL'équipe Retenza 💛"
                });
              }

              if (targetSegment === "vip") {
                templates.push({
                  label: "🌟 Remerciement Fidélité VIP",
                  subject: "Merci pour votre fidélité incroyable, {nom} !",
                  body: "Bonjour {nom},\n\nEn tant que client VIP, nous vous offrons un accès en avant-première à nos nouvelles collections et des avantages exclusifs réservés à nos meilleurs clients.\n\nMerci pour votre confiance absolue !\n\nL'équipe Retenza 💛"
                });
                templates.push({
                  label: "🎁 Avantage Privilège VIP (-10%)",
                  subject: "Votre privilège VIP du mois, {nom} ! 🎁",
                  body: "Bonjour {nom},\n\nPour vous remercier de votre fidélité parmi nos clients VIP les plus précieux, nous avons le plaisir de vous offrir un code promo exclusif de -10% sur l'ensemble de notre catalogue.\n\n📌 Code avantage : VIPPRIVILEGE10\n\nÀ très bientôt pour vos prochains achats !\n\nL'équipe Retenza 💛"
                });
              }

              if (targetSegment === "at_risk") {
                templates.push({
                  label: "🔥 Réactivation Urgente (-20%)",
                  subject: "{nom}, nous pensons à vous — une offre exclusive vous attend",
                  body: "Bonjour {nom},\n\nNotre équipe a détecté que vous n'avez pas commandé depuis un moment. Pour vous remercier de votre confiance, voici une remise de 20% sur votre prochain achat :\n\n👉 Code promo : REACTIVATION20\n\nNous comptons sur votre retour !\n\nL'équipe Retenza 💛"
                });
              }

              if (targetSegment === "lost") {
                templates.push({
                  label: "💔 Reconquête Dernière Chance (-30%)",
                  subject: "{nom}, une dernière offre pour votre retour 💔",
                  body: "Bonjour {nom},\n\nCela fait longtemps que nous ne vous avons pas vu ! Nous avons préparé une offre spéciale de reconquête : 30% de remise avec le code RETOUR30.\n\nCette offre est valable 7 jours seulement.\n\nL'équipe Retenza 💛"
                });
              }

              if (targetSegment === "regular" && !onlyBaisse && !onlyAmbassadors) {
                templates.push({
                  label: "💡 Découverte Nouveautés",
                  subject: "Nos nouveautés vous attendent, {nom} !",
                  body: "Bonjour {nom},\n\nDe nouveaux produits viennent d'arriver ! Venez découvrir notre sélection qui pourrait vous plaire.\n\nÀ très bientôt !\n\nL'équipe Retenza 💛"
                });
              }

              if (templates.length === 0) return null;

              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider">Modèles suggérés par l'IA</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {templates.map((tpl, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setSubject(tpl.subject);
                          setBody(tpl.body);
                        }}
                        className="text-[10px] font-bold px-2.5 py-1.5 bg-indigo-50 border border-indigo-100 hover:bg-indigo-100 text-indigo-700 rounded-lg transition-all cursor-pointer"
                      >
                        {tpl.label}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* Email Subject */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500">Sujet de l'e-mail</label>
              <input
                type="text"
                placeholder="Ex : Offre spéciale fidélité pour {nom} !"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="w-full bg-[#f8fafc] border border-[#e5e5e5] px-3.5 py-2.5 rounded-xl text-xs font-semibold outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
              />
              <span className="text-[10px] text-slate-400 font-medium">Astuce : Utilisez <code className="bg-slate-100 px-1 rounded font-bold">{"{nom}"}</code> pour personnaliser dynamiquement avec le nom du client.</span>
            </div>

            {/* Email Body */}
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-bold text-slate-500">Corps du message</label>
              <textarea
                rows={5}
                placeholder="Rédigez votre message ici..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full bg-[#f8fafc] border border-[#e5e5e5] px-3.5 py-2.5 rounded-xl text-xs font-semibold outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={sendingCampaign || targetedCount === 0 || !subject.trim() || !body.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white font-extrabold text-xs px-5 py-3 rounded-xl shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5"
            >
              {sendingCampaign ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Envoi de la campagne...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Envoyer à la cible ({targetedCount} clients)
                </>
              )}
            </button>
          </form>
        </div>

        {/* Right 1/3 - SmartAutomation (IA) */}
        <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm flex flex-col gap-4">

          {/* Header */}
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div className="flex items-center gap-2">
              <Bot className="w-5 h-5 text-yellow-500" />
              <h3 className="font-extrabold text-slate-800 text-sm">IA SmartAutomation</h3>
            </div>
            {/* Auto-scheduled badge */}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 text-[10px] font-black">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
              Auto-planifié ✅
            </span>
          </div>

          {/* Explanation */}
          <p className="text-xs text-slate-500 leading-relaxed">
            Le moteur IA tourne <strong className="text-slate-700">automatiquement chaque matin à 9h00</strong> — sans aucune intervention. Il détecte les anniversaires, baisses de fréquence et risques VIP, puis distribue les e-mails sur-mesure.
          </p>

          {/* Next auto-run info */}
          {!autoRunning && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
              <Clock className="w-4 h-4 text-blue-500 shrink-0" />
              <div>
                <span className="text-[10px] font-bold text-blue-400 uppercase block">Prochaine exécution automatique</span>
                <strong className="text-xs font-black text-blue-700">
                  {(() => {
                    const now = new Date();
                    const next = new Date();
                    next.setHours(9, 0, 0, 0);
                    if (now >= next) next.setDate(next.getDate() + 1);
                    const diff = next.getTime() - now.getTime();
                    const h = Math.floor(diff / 3600000);
                    const m = Math.floor((diff % 3600000) / 60000);
                    return `Demain à 09h00 — dans ${h}h${m.toString().padStart(2,'0')}min`;
                  })()}
                </strong>
              </div>
            </div>
          )}

          {/* Status Box */}
          <div className={`p-4 rounded-xl border flex items-center justify-between shadow-sm transition-colors ${
            autoRunning
              ? "bg-amber-50/50 border-amber-200"
              : "bg-slate-50 border-slate-200"
          }`}>
            <div>
              <span className="text-[10px] uppercase font-bold text-slate-400 block">Statut Moteur</span>
              <strong className={`text-xs font-black block mt-0.5 ${autoRunning ? "text-amber-600 animate-pulse" : "text-slate-600"}`}>
                {autoRunning ? "⚙️ Traitement IA en cours..." : "💤 En veille — prochain run à 9h00"}
              </strong>
            </div>

            {autoRunning ? (
              <Loader2 className="w-5 h-5 text-amber-500 animate-spin" />
            ) : (
              <button
                onClick={handleTriggerAutomation}
                disabled={triggeringAuto}
                title="Forcer l'exécution immédiate sans attendre 9h00"
                className="bg-slate-700 hover:bg-slate-800 text-white font-extrabold text-xs px-3 py-2 rounded-xl shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-1.5 cursor-pointer"
              >
                <Zap className="w-3.5 h-3.5" />
                Forcer maintenant
              </button>
            )}
          </div>

          <p className="text-[10px] text-slate-400 leading-relaxed text-center">
            ⚡ <strong>"Forcer maintenant"</strong> fait exactement la même chose que l'exécution automatique de 9h — mais <strong>immédiatement</strong>. Utile si tu viens d'ajouter des clients et tu ne veux pas attendre demain matin.
          </p>

          {/* Error display if any */}
          {autoLastError && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-xs font-semibold text-rose-800 flex items-center gap-1.5">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{autoLastError}</span>
            </div>
          )}

          {/* Last Run Stats summary */}
          {autoLastResult && (
            <div className="bg-[#f8fafc] border border-slate-100 rounded-xl p-4 space-y-3">
              <div className="flex items-center gap-1.5 border-b border-slate-100 pb-2">
                <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                <span className="text-xs font-bold text-slate-600">Dernier rapport IA</span>
              </div>
              <p className="text-[11px] text-slate-500 leading-snug">{autoLastResult.message}</p>

              {/* Full category grid */}
              {autoLastResult.stats && (
                <div className="space-y-2">
                  <span className="text-[9px] font-black text-slate-400 uppercase tracking-wider block">E-mails envoyés par catégorie</span>
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {/* Ambassadeurs */}
                    <div className="bg-white p-2 rounded-lg border border-yellow-105 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">Invitation Ambassadeur</span>
                        <span className="text-[9px] text-slate-400 truncate">Score influence ≥ 80</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.ambassador_invite || 0) > 0 ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.ambassador_invite || 0}
                      </span>
                    </div>

                    {/* Anniversaires */}
                    <div className="bg-white p-2 rounded-lg border border-pink-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">Cadeau Anniversaire</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Anniversaire demain</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.birthday_gift || 0) > 0 ? 'bg-pink-100 text-pink-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.birthday_gift || 0}
                      </span>
                    </div>

                    {/* VIP en danger */}
                    <div className="bg-white p-2 rounded-lg border border-orange-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">VIP en Danger</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">VIP avec Churn élevé</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.vip_danger || 0) > 0 ? 'bg-orange-100 text-orange-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.vip_danger || 0}
                      </span>
                    </div>

                    {/* VIP fidèles */}
                    <div className="bg-white p-2 rounded-lg border border-blue-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">VIP Fidèles</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Remerciements VIP</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.vip || 0) > 0 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.vip || 0}
                      </span>
                    </div>

                    {/* Réguliers */}
                    <div className="bg-white p-2 rounded-lg border border-indigo-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">Clients Réguliers</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Offres & nouveautés</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.regular || 0) > 0 ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.regular || 0}
                      </span>
                    </div>

                    {/* Baisse fréquence */}
                    <div className="bg-white p-2 rounded-lg border border-red-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">Baisse de Fréquence</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Relance -15%</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.baisse_frequence || 0) > 0 ? 'bg-red-100 text-red-650' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.baisse_frequence || 0}
                      </span>
                    </div>

                    {/* À risque */}
                    <div className="bg-white p-2 rounded-lg border border-amber-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">À Risque</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Churn élevé (-20%)</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.at_risk || 0) > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.at_risk || 0}
                      </span>
                    </div>

                    {/* Perdus */}
                    <div className="bg-white p-2 rounded-lg border border-rose-100 flex items-center justify-between gap-1">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-700 truncate">Clients Perdus</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Reconquête -30%</span>
                      </div>
                      <span className={`text-xs font-black px-1.5 py-0.5 rounded-full shrink-0 ${(autoLastResult.stats.lost || 0) > 0 ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-400'}`}>
                        {autoLastResult.stats.lost || 0}
                      </span>
                    </div>

                    {/* Ignorés cooldown */}
                    <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 flex items-center justify-between gap-1 sm:col-span-2">
                      <div className="flex flex-col min-w-0">
                        <span className="text-[10px] font-black text-slate-500 truncate">Ignorés (Cooldown actif)</span>
                        <span className="text-[9px] text-slate-400 truncate font-medium">Déjà contactés récemment</span>
                      </div>
                      <span className="text-xs font-black px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 shrink-0">
                        {autoLastResult.stats.skipped_cooldown || 0}
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Global Campaign Sent History Log */}
      <div className="bg-white border border-[#e5e5e5] rounded-2xl shadow-sm overflow-hidden flex-1 flex flex-col">
        <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0 bg-[#f8fafc]">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-slate-500" />
            <h3 className="font-extrabold text-slate-800 text-sm">Historique Global de Ciblage</h3>
          </div>
          <span className="text-xs text-slate-400 font-bold">Affichage des 100 derniers envois</span>
        </div>

        {loading && history.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
            <p className="text-xs text-slate-400 font-bold mt-2">Chargement du journal d'envois...</p>
          </div>
        ) : history.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-center text-slate-400">
            <Mail className="w-8 h-8 opacity-40" />
            <p className="text-xs font-bold mt-2">Aucun historique de campagne disponible.</p>
          </div>
        ) : (
          <div className="flex-1 overflow-auto max-h-[45vh]">
            <table className="w-full border-collapse text-left text-xs">
              <thead className="bg-slate-50 sticky top-0 z-10 border-b border-slate-100 font-bold text-slate-400 uppercase tracking-wider">
                <tr>
                  <th className="px-6 py-4">Client</th>
                  <th className="px-6 py-4">Date d'Envoi</th>
                  <th className="px-6 py-4">Objet de la Campagne</th>
                  <th className="px-6 py-4">Segment RFM</th>
                  <th className="px-6 py-4 text-right">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-slate-600">
                {history.map((item) => (
                  <tr key={item._id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-6 py-4 max-w-[200px] truncate">
                      <div className="flex flex-col">
                        <strong className="text-slate-800 font-extrabold truncate">{item.client_nom}</strong>
                        <span className="text-[10px] text-slate-400 truncate">{item.client_email}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      {new Date(item.sent_at).toLocaleDateString("fr-FR")} à {new Date(item.sent_at).toLocaleTimeString("fr-FR", { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="px-6 py-4 font-semibold text-slate-800 max-w-[280px] truncate">
                      {item.subject}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="bg-slate-100 text-slate-600 font-extrabold text-[9px] px-2 py-0.5 rounded">
                        {(item.segment || item.category || "inconnu").toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full font-bold border ${
                        item.status === 'sent_batch' || item.status === 'sent_auto' || item.status === 'sent_manual'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : item.status === 'simulated_batch' || item.status === 'simulated_auto'
                          ? 'bg-blue-50 text-blue-700 border-blue-200'
                          : 'bg-rose-50 text-rose-700 border-rose-200'
                      }`}>
                        <span>{
                          item.status === 'sent_batch' || item.status === 'sent_auto' || item.status === 'sent_manual'
                            ? '🟢 Envoyé'
                            : item.status === 'simulated_batch' || item.status === 'simulated_auto'
                            ? '🔵 Simulé'
                            : '🔴 Échoué'
                        }</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

    {/* Toast notifications overlay */}
    <ToastContainer toasts={toasts} onRemove={removeToast} />
    </>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={
      <div className="flex-1 flex flex-col items-center justify-center py-20">
        <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
        <p className="text-xs text-slate-400 font-bold mt-3">Chargement du module Campagnes...</p>
      </div>
    }>
      <CampaignsContent />
    </Suspense>
  );
}
