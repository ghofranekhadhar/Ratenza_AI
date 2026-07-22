"use client";

import { useEffect, useState } from "react";
import { Shield, AlertTriangle, UserX, ShoppingBag, Check, Loader2, RefreshCw, Lock, Sparkles, Download } from "lucide-react";

interface FraudAlertsData {
  status: string;
  commerce_id: string;
  settings: {
    fraud_max_daily_purchases: number;
    fraud_max_basket_multiplier: number;
    avg_basket_calculated: number;
  };
  summary: {
    total_blocked_chatbot: number;
    total_suspicious_frequency: number;
    total_suspicious_baskets: number;
    total_alerts: number;
  };
  alerts: {
    chatbot_blocked: Array<{
      email: string;
      warnings: number;
      block_reason?: string;
      blocked_at?: string;
    }>;
    suspicious_frequency: Array<{
      email: string;
      date: string;
      count: number;
      threshold: number;
      reason: string;
    }>;
    suspicious_baskets: Array<{
      email: string;
      commande_id: string;
      amount: number;
      date: string;
      threshold: number;
      reason: string;
    }>;
  };
}

export default function SecurityAdminPage() {
  const [data, setData] = useState<FraudAlertsData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [unblockingEmail, setUnblockingEmail] = useState<string | null>(null);

  // Settings inputs
  const [maxDaily, setMaxDaily] = useState<number>(5);
  const [basketMultiplier, setBasketMultiplier] = useState<number>(3.0);

  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/security/fraud-alerts?commerce_id=commerce_local", {
        cache: "no-store",
      });
      const json = await res.json();
      if (json.status === "success") {
        setData(json);
        if (json.settings) {
          setMaxDaily(json.settings.fraud_max_daily_purchases || 5);
          setBasketMultiplier(json.settings.fraud_max_basket_multiplier || 3.0);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAlerts();
  }, []);

  const handleSaveSettings = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/commerces/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commerce_id: "commerce_local",
          fraud_max_daily_purchases: maxDaily,
          fraud_max_basket_multiplier: basketMultiplier,
        }),
      });

      const json = await res.json();
      if (json.status === "success") {
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
        fetchAlerts();
      } else {
        alert(json.error || "Erreur d'enregistrement.");
      }
    } catch {
      alert("Erreur réseau.");
    } finally {
      setSaving(false);
    }
  };

  const handleUnblockChatbot = async (email: string) => {
    setUnblockingEmail(email);
    try {
      const res = await fetch("/api/chatbot/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const json = await res.json();
      if (json.status === "success") {
        fetchAlerts();
      } else {
        alert(json.error || "Erreur de déblocage.");
      }
    } catch {
      alert("Erreur réseau.");
    } finally {
      setUnblockingEmail(null);
    }
  };

  const handleExportCSV = () => {
    if (!data) return;
    let csv = '\uFEFF';
    csv += `RAPPORT SÉCURITÉ & FRAUDE;Date: ${new Date().toLocaleDateString('fr-FR')}\n\n`;
    csv += `RÉSUMÉ;Valeur\n`;
    csv += `Total Alertes;${data.summary.total_alerts}\n`;
    csv += `Comptes Chatbot Bloqués;${data.summary.total_blocked_chatbot}\n`;
    csv += `Volume Suspect (achats >  ${data.settings.fraud_max_daily_purchases}/jour);${data.summary.total_suspicious_frequency}\n`;
    csv += `Paniers Hors-Normes (> ${data.settings.fraud_max_basket_multiplier}x panier moyen);${data.summary.total_suspicious_baskets}\n`;
    csv += `Panier Moyen Calculé;${data.settings.avg_basket_calculated} DT\n\n`;
    if (data.alerts.chatbot_blocked.length > 0) {
      csv += `COMPTES CHATBOT BLOQUÉS\n`;
      csv += `Email;Avertissements;Raison du Blocage;Date Blocage\n`;
      data.alerts.chatbot_blocked.forEach(c => {
        csv += `${c.email};${c.warnings};${c.block_reason || '-'};${c.blocked_at ? c.blocked_at.substring(0, 10) : '-'}\n`;
      });
      csv += '\n';
    }
    if (data.alerts.suspicious_frequency.length > 0) {
      csv += `VOLUMES D'ACHAT SUSPECTS\n`;
      csv += `Email;Date;Nombre d'achats;Seuil;Raison\n`;
      data.alerts.suspicious_frequency.forEach(f => {
        csv += `${f.email};${f.date};${f.count};${f.threshold};${f.reason}\n`;
      });
      csv += '\n';
    }
    if (data.alerts.suspicious_baskets.length > 0) {
      csv += `PANIERS HORS-NORMES\n`;
      csv += `Email;ID Commande;Montant (DT);Date;Seuil (DT);Raison\n`;
      data.alerts.suspicious_baskets.forEach(b => {
        csv += `${b.email};${b.commande_id};${b.amount};${b.date};${b.threshold};${b.reason}\n`;
      });
    }
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `securite_fraude_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen bg-slate-50/50">
      {/* Header */}
      <header className="bg-white border-b border-[#e5e5e5] px-8 py-5 flex items-center justify-between sticky top-0 z-40">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Shield className="w-5 h-5 text-blue-600" />
            Administration & Sécurité — Détection de Fraude
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Surveillance des comportements suspects, blocages Chatbot et transactions anormales
          </p>
        </div>

        <button
          onClick={fetchAlerts}
          disabled={loading}
          className="bg-white border border-[#e5e5e5] hover:bg-slate-50 text-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-2 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          Rafraîchir
        </button>
        <button
          onClick={handleExportCSV}
          disabled={!data}
          className="bg-white border border-[#e5e5e5] hover:bg-slate-50 text-slate-700 px-3.5 py-1.5 rounded-xl text-xs font-semibold shadow-sm transition-all flex items-center gap-2 cursor-pointer disabled:opacity-40"
        >
          <Download className="w-3.5 h-3.5" />
          Exporter CSV
        </button>
      </header>

      {/* Main Content */}
      <div className="flex-1 px-8 py-8 w-full max-w-7xl mx-auto flex flex-col gap-6">

        {loading && !data ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <>
            {/* KPI Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Total Alertes
                  </span>
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                </div>
                <p className="text-2xl font-black text-slate-800">{data?.summary.total_alerts || 0}</p>
                <p className="text-xs text-slate-400 mt-1">Comportements signalés</p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Chatbot Bloqués
                  </span>
                  <UserX className="w-4 h-4 text-rose-500" />
                </div>
                <p className="text-2xl font-black text-rose-600">
                  {data?.summary.total_blocked_chatbot || 0}
                </p>
                <p className="text-xs text-slate-400 mt-1">Insultes / Spam répétitif</p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Volume Suspect
                  </span>
                  <ShoppingBag className="w-4 h-4 text-blue-500" />
                </div>
                <p className="text-2xl font-black text-slate-800">
                  {data?.summary.total_suspicious_frequency || 0}
                </p>
                <p className="text-xs text-slate-400 mt-1">Achats &gt; {maxDaily}/jour</p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Paniers Hors-Normes
                  </span>
                  <Sparkles className="w-4 h-4 text-purple-500" />
                </div>
                <p className="text-2xl font-black text-slate-800">
                  {data?.summary.total_suspicious_baskets || 0}
                </p>
                <p className="text-xs text-slate-400 mt-1">Achats &gt; {basketMultiplier}x Panier Moyen</p>
              </div>
            </div>

            {/* Configurable Thresholds Card */}
            <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Réglages des Seuils de Détection</h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    Ajustez les critères de détection sans redémarrer le serveur
                  </p>
                </div>
                {saved && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                    <Check className="w-3.5 h-3.5" />
                    Enregistré
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Nombre max d&apos;achats par jour / client
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={maxDaily}
                    onChange={(e) => setMaxDaily(parseInt(e.target.value, 10) || 1)}
                    className="bg-[#f8fafc] border border-[#e5e5e5] px-4 py-2.5 rounded-xl text-sm font-bold text-slate-800 outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <p className="text-[11px] text-slate-400">
                    Déclenche une alerte si un client effectue plus de {maxDaily} commandes le même jour.
                  </p>
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-slate-700">
                    Multiplicateur Panier Moyen Hors-Normes (x)
                  </label>
                  <input
                    type="number"
                    step={0.5}
                    min={1.5}
                    max={10}
                    value={basketMultiplier}
                    onChange={(e) => setBasketMultiplier(parseFloat(e.target.value) || 1.5)}
                    className="bg-[#f8fafc] border border-[#e5e5e5] px-4 py-2.5 rounded-xl text-sm font-bold text-slate-800 outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                  <p className="text-[11px] text-slate-400">
                    Panier moyen calculé : {data?.settings.avg_basket_calculated || 50} DT ➔ Alerte au-delà de{" "}
                    <strong>{((data?.settings.avg_basket_calculated || 50) * basketMultiplier).toFixed(1)} DT</strong>.
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-100">
                <button
                  onClick={handleSaveSettings}
                  disabled={saving}
                  className="bg-slate-800 hover:bg-slate-900 text-white px-5 py-2.5 rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
                >
                  {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Enregistrer les seuils
                </button>
              </div>
            </div>

            {/* Alert Lists */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

              {/* Chatbot Blocked Accounts */}
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <UserX className="w-4 h-4 text-rose-500" />
                  Comptes Chatbot Bloqués ({data?.alerts.chatbot_blocked.length || 0})
                </h3>

                {data?.alerts.chatbot_blocked.length === 0 ? (
                  <p className="text-xs text-slate-400 italic py-4 text-center">
                    Aucun compte chatbot actuellement bloqué.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
                    {data?.alerts.chatbot_blocked.map((c) => (
                      <div
                        key={c.email}
                        className="flex items-center justify-between gap-4 p-3 rounded-xl border border-rose-100 bg-rose-50/40"
                      >
                        <div>
                          <p className="text-xs font-bold text-slate-800">{c.email}</p>
                          <p className="text-[11px] text-rose-600 mt-0.5">
                            {c.block_reason || `Bloqué après ${c.warnings} avertissements`}
                          </p>
                        </div>

                        <button
                          onClick={() => handleUnblockChatbot(c.email)}
                          disabled={unblockingEmail === c.email}
                          className="bg-white border border-rose-200 hover:bg-rose-100 text-rose-700 px-3 py-1.5 rounded-lg text-xs font-bold transition-all disabled:opacity-50 shrink-0 cursor-pointer shadow-sm"
                        >
                          {unblockingEmail === c.email ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            "Débloquer"
                          )}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Suspicious Purchases & Baskets */}
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm flex flex-col gap-4">
                <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-500" />
                  Transactions &amp; Volumes Suspects (
                  {(data?.alerts.suspicious_frequency.length || 0) + (data?.alerts.suspicious_baskets.length || 0)}
                  )
                </h3>

                {(data?.alerts.suspicious_frequency.length || 0) + (data?.alerts.suspicious_baskets.length || 0) === 0 ? (
                  <p className="text-xs text-slate-400 italic py-4 text-center">
                    Aucune transaction ou fréquence anormale détectée.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3 max-h-80 overflow-y-auto pr-1">
                    {data?.alerts.suspicious_frequency.map((f, idx) => (
                      <div
                        key={`freq_${idx}`}
                        className="p-3 rounded-xl border border-amber-200 bg-amber-50/40 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800">{f.email}</span>
                          <span className="text-amber-700 font-bold">{f.date}</span>
                        </div>
                        <p className="text-[11px] text-amber-800">{f.reason}</p>
                      </div>
                    ))}

                    {data?.alerts.suspicious_baskets.map((b, idx) => (
                      <div
                        key={`basket_${idx}`}
                        className="p-3 rounded-xl border border-purple-200 bg-purple-50/40 flex flex-col gap-1"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-slate-800">{b.email}</span>
                          <span className="text-purple-700 font-bold">{b.amount} DT</span>
                        </div>
                        <p className="text-[11px] text-purple-800">{b.reason}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>

          </>
        )}

      </div>
    </div>
  );
}
