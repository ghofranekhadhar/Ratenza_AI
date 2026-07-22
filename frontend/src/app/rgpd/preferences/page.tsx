"use client";

import { useEffect, useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { Shield, Check, Loader2, Lock, Mail, Sparkles, AlertCircle } from "lucide-react";

function PreferencePortalContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean>(false);
  const [saving, setSaving] = useState<boolean>(false);

  const [clientInfo, setClientInfo] = useState<{ email: string; nom: string } | null>(null);
  const [marketingOptOut, setMarketingOptOut] = useState<boolean>(false);
  const [profilingOptOut, setProfilingOptOut] = useState<boolean>(false);

  useEffect(() => {
    if (!token) {
      setError("Jeton d'accès de sécurité manquant dans l'URL.");
      setLoading(false);
      return;
    }

    async function loadPreferences() {
      try {
        const res = await fetch(`/api/rgpd/portal-data?token=${encodeURIComponent(token!)}`);
        const json = await res.json();
        if (json.status === "success") {
          setClientInfo({ email: json.email, nom: json.nom });
          setMarketingOptOut(Boolean(json.marketing_opt_out));
          setProfilingOptOut(Boolean(json.profiling_opt_out));
        } else {
          setError(json.error || "Lien invalide ou expiré.");
        }
      } catch {
        setError("Erreur de connexion au serveur.");
      } finally {
        setLoading(false);
      }
    }

    loadPreferences();
  }, [token]);

  const handleSave = async () => {
    if (!token) return;
    setSaving(true);
    setSuccess(false);

    try {
      const res = await fetch("/api/rgpd/portal-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          marketing_opt_out: marketingOptOut,
          profiling_opt_out: profilingOptOut,
        }),
      });

      const json = await res.json();
      if (json.status === "success") {
        setSuccess(true);
        setTimeout(() => setSuccess(false), 4000);
      } else {
        alert(json.error || "Erreur lors de la sauvegarde.");
      }
    } catch {
      alert("Erreur de connexion au serveur.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-slate-50 p-6">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600 mb-3" />
        <p className="text-sm font-semibold text-slate-600">Chargement de vos préférences sécurisées...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50 p-6">
        <div className="bg-white border border-rose-200 rounded-3xl p-8 max-w-md w-full shadow-sm text-center">
          <div className="w-12 h-12 bg-rose-100 rounded-2xl flex items-center justify-center mx-auto mb-4 text-rose-600">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h1 className="text-lg font-bold text-slate-800 mb-2">Lien Invalide ou Expiré</h1>
          <p className="text-xs text-slate-500 leading-relaxed mb-6">{error}</p>
          <div className="text-[11px] text-slate-400 bg-slate-50 rounded-xl p-3 flex items-center justify-center gap-2">
            <Lock className="w-3.5 h-3.5" />
            Accès sécurisé conforme au RGPD
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
      <div className="bg-white border border-[#e5e5e5] rounded-3xl p-8 max-w-lg w-full shadow-lg flex flex-col gap-6">
        
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-slate-100 pb-5">
          <div className="w-10 h-10 bg-blue-50 border border-blue-100 rounded-2xl flex items-center justify-center text-blue-600 shrink-0">
            <Shield className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-slate-800">Gestion des Préférences RGPD</h1>
            <p className="text-xs text-slate-400">
              Espace sécurisé réservé à <strong className="text-slate-700">{clientInfo?.email}</strong>
            </p>
          </div>
        </div>

        {/* Info Box */}
        <div className="bg-blue-50/60 border border-blue-100 rounded-2xl p-4 text-xs text-blue-800 leading-relaxed">
          Vous pouvez choisir librement comment vos données sont utilisées. Les e-mails transactionnels (confirmation de commande, mot de passe) restent toujours actifs.
        </div>

        {/* Toggles */}
        <div className="flex flex-col gap-4">
          
          {/* Toggle 1: Marketing */}
          <div className="p-4 rounded-2xl border border-slate-200 hover:border-slate-300 transition-all flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Mail className="w-4 h-4 text-slate-500 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Offres & Campagnes Marketing</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Recevoir nos newsletters, offres promotionnelles et relances d&apos;anniversaire par e-mail.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setMarketingOptOut(!marketingOptOut)}
              className={`w-12 h-6 rounded-full transition-colors relative shrink-0 mt-1 cursor-pointer ${
                !marketingOptOut ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform shadow-md ${
                  !marketingOptOut ? "translate-x-6" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

          {/* Toggle 2: Profiling / AI Recommendations */}
          <div className="p-4 rounded-2xl border border-slate-200 hover:border-slate-300 transition-all flex items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <Sparkles className="w-4 h-4 text-slate-500 mt-1 shrink-0" />
              <div>
                <p className="text-sm font-semibold text-slate-800">Recommandations Personnalisées IA</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
                  Autoriser l&apos;analyse de vos préférences pour recevoir des suggestions de produits adaptées à vos goûts.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setProfilingOptOut(!profilingOptOut)}
              className={`w-12 h-6 rounded-full transition-colors relative shrink-0 mt-1 cursor-pointer ${
                !profilingOptOut ? "bg-emerald-500" : "bg-slate-300"
              }`}
            >
              <span
                className={`w-5 h-5 bg-white rounded-full absolute top-0.5 transition-transform shadow-md ${
                  !profilingOptOut ? "translate-x-6" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>

        </div>

        {/* Footer actions */}
        <div className="pt-4 border-t border-slate-100 flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
            <Lock className="w-3.5 h-3.5" />
            Accès sécurisé par jeton unique
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-slate-800 hover:bg-slate-900 text-white px-6 py-2.5 rounded-xl text-xs font-bold shadow-md transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 flex items-center gap-2 cursor-pointer"
          >
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Enregistrer
          </button>
        </div>

        {success && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-bold px-4 py-2.5 rounded-xl flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-600" />
            Vos préférences ont été enregistrées avec succès !
          </div>
        )}

      </div>
    </div>
  );
}

export default function PreferencePortalPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
      </div>
    }>
      <PreferencePortalContent />
    </Suspense>
  );
}
