"use client";

import { useEffect, useState } from "react";
import {
  Banknote,
  Users,
  Crown,
  TrendingDown,
  ShoppingBag,
  Gift,
  Award,
  Star,
  Flame,
  Undo2,
  Trophy,
  Loader2,
  Sparkles,
  AlertTriangle,
  ArrowRight,
  Download
} from "lucide-react";
import {
  Chart as ChartJS,
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler
} from "chart.js";
import { Doughnut, Bar } from "react-chartjs-2";

ChartJS.register(
  ArcElement,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Filler
);

interface Commerce {
  id: string;
  label: string;
}

interface ClientData {
  client_db_id: string;
  nom: string;
  email: string;
  commerce_id: string;
  segment_gmm?: "vip" | "regular" | "at_risk" | "lost" | null;
  churn_score?: number;
  churn_risk_label?: string;
  recency: number;
  frequency: number;
  monetary: number;
  recency_score: number;
  frequency_score: number;
  monetary_score: number;
  score_global_sa: number;
  influence_score?: number;
  baisse_frequence_detectee?: boolean;
}

interface Recommendation {
  id: string;
  type: "warning" | "alert" | "opportunity";
  priority: number;
  title: string;
  message: string;
  action: {
    label: string;
    filters: any;
  };
}

interface GlobalComparisonStore {
  _id: string;
  label: string;
  nb_clients: number;
  ca_total: number;
  panier_moyen: number;
  churn_moyen_pct: number;
  score_sa_moyen_pct: number;
  vip_count: number;
  regular_count: number;
  at_risk_count: number;
  lost_count: number;
  critical_churn_count: number;
  ambassador_count: number;
  baisse_freq_count: number;
  taux_retour_pct: number;
  loyalty_points: number;
  loyalty_membres: number;
}

export default function DashboardPage() {
  const [commerces, setCommerces] = useState<Commerce[]>([]);
  const [selectedCommerce, setSelectedCommerce] = useState<string>("__all__");
  const [loading, setLoading] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<"stats" | "global">("stats");

  // Data states
  const [allClients, setAllClients] = useState<ClientData[]>([]);
  const [returnRate, setReturnRate] = useState<number>(0);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [globalComparison, setGlobalComparison] = useState<GlobalComparisonStore[]>([]);
  const [cooldownDays, setCooldownDays] = useState<number>(30);
  const [settingsSaved, setSettingsSaved] = useState<boolean>(false);

  // Fetch initial boutique list
  useEffect(() => {
    async function init() {
      try {
        const res = await fetch("/api/commerces");
        const data = await res.json();
        if (Array.isArray(data)) {
          setCommerces(data);
          const saved = localStorage.getItem("ratenza_commerce_id");
          if (saved && data.some((c: Commerce) => c.id === saved)) {
            setSelectedCommerce(saved);
          }
        } else {
          setCommerces([]);
        }
      } catch (err) {
        console.error("Failed to load commerces:", err);
        setCommerces([]);
      }
    }
    init();
  }, []);

  // Fetch dashboard data based on selected boutique
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      try {
        // Fetch cooldown settings
        const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;
        const setRes = await fetch(`/api/commerces/settings?commerce_id=${encodeURIComponent(targetId)}`);
        const setJson = await setRes.json();
        if (setJson.status === "success" && setJson.data) {
          setCooldownDays(setJson.data.cooldown_days || 30);
        }

        if (selectedCommerce === "__all__") {
          // Fetch data from all shops
          const shopsRes = await fetch("/api/commerces");
          const shops = await shopsRes.json();
          if (Array.isArray(shops)) {
            const allPromises = shops.map((c: Commerce) =>
              fetch(`/api/data?commerce_id=${encodeURIComponent(c.id)}`).then((r) => r.json())
            );
            const results = await Promise.all(allPromises);
            const merged: ClientData[] = results.flat().filter((d: any) => d && !d.error);
            setAllClients(merged);
          } else {
            setAllClients([]);
          }

          // Get global comparison stats (which includes return rates and loyalty points)
          const compRes = await fetch("/api/global-comparison");
          const compData = await compRes.json();
          if (compData.status === "success" && Array.isArray(compData.data) && compData.data.length > 0) {
            setGlobalComparison(compData.data);
            // Average return rate
            const avgTr =
              compData.data.reduce((acc: number, curr: any) => acc + curr.taux_retour_pct, 0) /
              compData.data.length;
            setReturnRate(avgTr);
          } else {
            setReturnRate(0);
          }
          setRecommendations([]); // Hide recommendations in global view
        } else {
          // Fetch specific shop
          const res = await fetch(`/api/data?commerce_id=${encodeURIComponent(selectedCommerce)}`);
          const data = await res.json();
          setAllClients(Array.isArray(data) ? data : []);

          // Fetch return rate
          const trRes = await fetch(
            `/api/kpis/return-rate?commerce_id=${encodeURIComponent(selectedCommerce)}`
          );
          const trData = await trRes.json();
          if (trData.status === "success" && trData.data) {
            setReturnRate(trData.data.taux_retour_30j || 0);
          } else {
            setReturnRate(0);
          }

          // Fetch recommendations
          const recRes = await fetch(
            `/api/recommendations?commerce_id=${encodeURIComponent(selectedCommerce)}`
          );
          const recData = await recRes.json();
          if (recData.status === "success" && recData.data) {
            setRecommendations(recData.data);
          } else {
            setRecommendations([]);
          }
        }
      } catch (err) {
        console.error("Failed to load data for dashboard:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [selectedCommerce]);

  // Fetch comparison data if in the comparison tab
  useEffect(() => {
    if (activeTab === "global") {
      async function loadComparison() {
        try {
          const res = await fetch("/api/global-comparison");
          const data = await res.json();
          if (data.status === "success") {
            setGlobalComparison(data.data);
          }
        } catch (err) {
          console.error("Failed to load global comparison:", err);
        }
      }
      loadComparison();
    }
  }, [activeTab]);

  // Handle selector change
  const handleCommerceSelect = (id: string) => {
    setSelectedCommerce(id);
    if (id !== "__all__") {
      localStorage.setItem("ratenza_commerce_id", id);
    }
  };

  // Recalculate pipeline RFM
  const handleRecalculate = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/recalculate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commerce_id: selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce })
      });
      const data = await res.json();
      if (data.status === "success") {
        alert("Calcul RFM recalculé et sauvegardé avec succès !");
        // Reload page data
        setSelectedCommerce((prev) => prev);
      } else {
        alert(`Erreur lors du recalcul: ${data.error || "Inconnue"}`);
      }
    } catch (err: any) {
      alert(`Erreur réseau: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Save Cooldown Settings
  const handleSaveCooldown = async (days: number) => {
    setCooldownDays(days);
    const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;
    try {
      const res = await fetch("/api/commerces/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commerce_id: targetId,
          cooldown_days: days
        })
      });
      const json = await res.json();
      if (json.status === "success") {
        setSettingsSaved(true);
        setTimeout(() => setSettingsSaved(false), 3000);
      } else {
        alert(json.error || "Erreur lors de l'enregistrement.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur réseau lors de l'enregistrement des paramètres.");
    }
  };

  // --- KPI Computations ---
  const totalClients = allClients.length;
  const avgRecency = totalClients > 0 ? allClients.reduce((acc, curr) => acc + curr.recency, 0) / totalClients : 0;
  const avgFrequency = totalClients > 0 ? allClients.reduce((acc, curr) => acc + curr.frequency, 0) / totalClients : 0;
  const avgMonetary = totalClients > 0 ? allClients.reduce((acc, curr) => acc + curr.monetary, 0) / totalClients : 0;
  const avgChurn = totalClients > 0 ? (allClients.reduce((acc, curr) => acc + (curr.churn_score || 0), 0) / totalClients) * 100 : 0;
  const alertClientsCount = allClients.filter((c) => (c.churn_score || 0) >= 0.55).length;
  const ambassadorsCount = allClients.filter((c) => {
    const score = c.influence_score !== undefined
      ? c.influence_score
      : Math.round(((c.score_global_sa || 0) * 0.7 + (1.0 - (c.churn_score || 0)) * 0.3) * 100);
    return score >= 80;
  }).length;

  // --- Segment classification helper ---
  const getSegmentKey = (c: ClientData): "vip" | "regular" | "at_risk" | "lost" => {
    if (c.segment_gmm) return c.segment_gmm;
    const scoreSa = c.score_global_sa || 0;
    if (scoreSa >= 0.7) return "vip";
    if (scoreSa >= 0.4) return "regular";
    if (scoreSa >= 0.2) return "at_risk";
    return "lost";
  };

  // --- Doughnut Segment Chart Data ---
  const segments = { vip: 0, regular: 0, at_risk: 0, lost: 0 };
  const rfmScores = {
    vip: { r: 0, f: 0, m: 0, count: 0 },
    regular: { r: 0, f: 0, m: 0, count: 0 },
    at_risk: { r: 0, f: 0, m: 0, count: 0 },
    lost: { r: 0, f: 0, m: 0, count: 0 }
  };
  const churnDist = { low: 0, medium: 0, high: 0, critical: 0 };

  allClients.forEach((c) => {
    const seg = getSegmentKey(c);
    segments[seg]++;

    rfmScores[seg].r += c.recency_score || 0;
    rfmScores[seg].f += c.frequency_score || 0;
    rfmScores[seg].m += c.monetary_score || 0;
    rfmScores[seg].count++;

    const churn = c.churn_score || 0;
    if (churn < 0.3) churnDist.low++;
    else if (churn < 0.55) churnDist.medium++;
    else if (churn < 0.75) churnDist.high++;
    else churnDist.critical++;
  });

  const segmentChartData = {
    labels: ["VIP", "Régulier", "À risque", "Perdu"],
    datasets: [
      {
        data: [segments.vip, segments.regular, segments.at_risk, segments.lost],
        backgroundColor: ["#10b981", "#3b82f6", "#f59e0b", "#ef4444"],
        borderWidth: 2,
        borderColor: "#ffffff"
      }
    ]
  };

  const churnChartData = {
    labels: ["Faible (<30%)", "Moyen (30-55%)", "Élevé (55-75%)", "Critique (>=75%)"],
    datasets: [
      {
        data: [churnDist.low, churnDist.medium, churnDist.high, churnDist.critical],
        backgroundColor: ["#10b981", "#f59e0b", "#ef4444", "#7f1d1d"],
        borderWidth: 2,
        borderColor: "#ffffff"
      }
    ]
  };

  const getAvg = (sum: number, count: number) => (count > 0 ? sum / count : 0);

  const rfmChartData = {
    labels: ["VIP", "Régulier", "À risque", "Perdu"],
    datasets: [
      {
        label: "Score Récence",
        data: [
          getAvg(rfmScores.vip.r, rfmScores.vip.count),
          getAvg(rfmScores.regular.r, rfmScores.regular.count),
          getAvg(rfmScores.at_risk.r, rfmScores.at_risk.count),
          getAvg(rfmScores.lost.r, rfmScores.lost.count)
        ],
        backgroundColor: "rgba(16, 185, 129, 0.85)",
        borderRadius: 6
      },
      {
        label: "Score Fréquence",
        data: [
          getAvg(rfmScores.vip.f, rfmScores.vip.count),
          getAvg(rfmScores.regular.f, rfmScores.regular.count),
          getAvg(rfmScores.at_risk.f, rfmScores.at_risk.count),
          getAvg(rfmScores.lost.f, rfmScores.lost.count)
        ],
        backgroundColor: "rgba(59, 130, 246, 0.85)",
        borderRadius: 6
      },
      {
        label: "Score Montant",
        data: [
          getAvg(rfmScores.vip.m, rfmScores.vip.count),
          getAvg(rfmScores.regular.m, rfmScores.regular.count),
          getAvg(rfmScores.at_risk.m, rfmScores.at_risk.count),
          getAvg(rfmScores.lost.m, rfmScores.lost.count)
        ],
        backgroundColor: "rgba(239, 68, 68, 0.85)",
        borderRadius: 6
      }
    ]
  };

  // --- Large comparison chart (Tab 2) ---
  const storeColors = ["#2563eb", "#10b981", "#f59e0b", "#8b5cf6", "#06b6d4", "#ec4899"];
  const comparisonLabels = [
    "CA Total (kDT)",
    "Fidélité Sa (%)",
    "Taux de Churn (%)",
    "Panier Moyen (DT)",
    "Ambassadeurs 👑",
    "Taux de Retour (%)",
    "Baisse Fréquence (cl)",
    "Membres Fidélité"
  ];

  const comparisonDatasets = globalComparison.map((s, idx) => {
    const color = storeColors[idx % storeColors.length];
    return {
      label: s.label,
      data: [
        s.ca_total / 1000,
        s.score_sa_moyen_pct,
        s.churn_moyen_pct,
        s.panier_moyen,
        s.ambassador_count || 0,
        s.taux_retour_pct || 0,
        s.baisse_freq_count || 0,
        s.loyalty_membres || 0
      ],
      backgroundColor: color + "d0",
      borderColor: color,
      borderWidth: 1.5,
      borderRadius: 6,
      barPercentage: 0.5,
      categoryPercentage: 0.7
    };
  });

  const comparisonChartData = {
    labels: comparisonLabels,
    datasets: comparisonDatasets
  };

  // Find direct comparison winners
  const metrics = [
    { label: "Chiffre d'Affaires", key: "ca_total" as const, fmt: (v: number) => v.toLocaleString("fr-FR") + " DT", higher: true, color: "text-blue-600" },
    { label: "Clients Actifs", key: "nb_clients" as const, fmt: (v: number) => v + " clients", higher: true, color: "text-purple-600" },
    { label: "Ambassadeurs 👑", key: "ambassador_count" as const, fmt: (v: number) => v + " ambassadeurs", higher: true, color: "text-yellow-600" },
    { label: "Score Fidélité (Sa)", key: "score_sa_moyen_pct" as const, fmt: (v: number) => v + "%", higher: true, color: "text-amber-500" },
    { label: "Taux de Churn (IA)", key: "churn_moyen_pct" as const, fmt: (v: number) => v + "%", higher: false, color: "text-red-500", isChurn: true },
    { label: "Panier Moyen", key: "panier_moyen" as const, fmt: (v: number) => v.toFixed(2) + " DT", higher: true, color: "text-cyan-500" },
    { label: "Taux de Retour Client", key: "taux_retour_pct" as const, fmt: (v: number) => v.toFixed(1) + "%", higher: false, color: "text-pink-500" },
    { label: "Baisse de Fréquence 📉", key: "baisse_freq_count" as const, fmt: (v: number) => v + " clients", higher: false, color: "text-red-500" },
    { label: "Membres Fidélité 🎁", key: "loyalty_membres" as const, fmt: (v: number) => v + " membres", higher: true, color: "text-purple-500" },
    { label: "Points de Fidélité", key: "loyalty_points" as const, fmt: (v: number) => v.toLocaleString("fr-FR") + " pts", higher: true, color: "text-indigo-500" }
  ];

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Top bar with filters */}
      <header className="bg-white border-b border-[#e5e5e5] px-8 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-40">
        {/* Left — Title */}
        <div className="shrink-0">
          <h2 className="text-xl font-bold text-slate-800">
            {activeTab === "stats" ? "Tableau de Bord RFM & IA" : "Comparateur de Boutiques"}
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Pilotage et analyses prédictives de la stratégie commerciale
          </p>
        </div>

        {/* Right — Controls grouped */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Cooldown selector — toujours visible */}
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider whitespace-nowrap">
              Relance auto
            </span>
            {settingsSaved && (
              <span className="text-xs text-emerald-600 font-bold">✓ Enregistré</span>
            )}
            <select
              value={cooldownDays}
              onChange={(e) => handleSaveCooldown(parseFloat(e.target.value))}
              className="bg-white border border-[#e5e5e5] px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 outline-none hover:border-blue-600 focus:border-blue-600 transition-all cursor-pointer shadow-sm"
            >
              <option value={30}>30 jours</option>
              <option value={21}>21 jours</option>
              <option value={14}>14 jours</option>
              <option value={7}>7 jours</option>
              <option value={0.00694}>Mode Test (5 min)</option>
            </select>
          </div>

          {/* Commerce selector */}
          <select
            value={selectedCommerce}
            onChange={(e) => handleCommerceSelect(e.target.value)}
            className="bg-white border border-[#e5e5e5] px-3 py-1.5 rounded-xl text-xs font-semibold text-slate-700 outline-none hover:border-blue-600 focus:border-blue-600 transition-all cursor-pointer shadow-sm shrink-0"
          >
            <option value="__all__">Toutes les boutiques</option>
            {commerces.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>

          {/* Recalculate button */}
          <button
            onClick={handleRecalculate}
            disabled={loading}
            className="bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none flex items-center gap-1.5 shrink-0 cursor-pointer"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            Recalculer RFM
          </button>

          {/* Export CSV link */}
          <a
            href={`/api/export/dashboard?commerce_id=${selectedCommerce}`}
            download
            className="bg-white border border-[#e5e5e5] hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
          >
            <Download className="w-3.5 h-3.5" />
            Exporter CSV
          </a>
        </div>
      </header>

      {/* Tabs navigation */}
      <div className="px-8 mt-6">
        <div className="flex border-b border-[#e5e5e5] gap-6">
          <button
            onClick={() => setActiveTab("stats")}
            className={`pb-3 text-sm font-bold border-b-2 transition-all ${
              activeTab === "stats"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            Indicateurs & Analyses
          </button>
          <button
            onClick={() => setActiveTab("global")}
            className={`pb-3 text-sm font-bold border-b-2 transition-all ${
              activeTab === "global"
                ? "border-blue-600 text-blue-600"
                : "border-transparent text-slate-400 hover:text-slate-600"
            }`}
          >
            Comparatif Direct Boutiques
          </button>
        </div>
      </div>

      {/* Page Content */}
      <div className="flex-1 p-8 max-w-7xl mx-auto w-full animate-fade-in">
        {loading && allClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
            <p className="text-sm text-slate-500 font-semibold mt-4">
              Chargement des analyses et KPIs...
            </p>
          </div>
        ) : activeTab === "stats" ? (
          <>
            {/* KPI Cards Grid */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Clients Totaux
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center">
                    <Users className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800">{totalClients}</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Clients modélisés en base
                </p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Panier Moyen
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
                    <Banknote className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800">
                  {avgMonetary.toFixed(2)} DT
                </h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Valeur monétaire moyenne
                </p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Taux de Retour (Tr)
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                    <Undo2 className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800">{returnRate.toFixed(1)}%</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Clients actifs revenus sous 30j
                </p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Taux de Churn (IA)
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                    <Flame className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800">{avgChurn.toFixed(1)}%</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Probabilité moyenne de départ
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Récence Moyenne
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center">
                    <ShoppingBag className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800">{avgRecency.toFixed(1)} j</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Depuis le dernier achat
                </p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Fréquence Moyenne
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-slate-50 text-slate-600 flex items-center justify-center">
                    <TrendingDown className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-slate-800">{avgFrequency.toFixed(1)} achats</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Transactions cumulées par client
                </p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Alerte Churn (≥ 55%)
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
                    <AlertTriangle className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-red-600">{alertClientsCount}</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Clients en risque modéré/élevé
                </p>
              </div>

              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-5 hover:translate-y-[-4px] hover:shadow-lg transition-all duration-300">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Ambassadeurs 👑
                  </span>
                  <div className="w-8 h-8 rounded-lg bg-yellow-50 text-yellow-600 flex items-center justify-center">
                    <Crown className="w-4 h-4" />
                  </div>
                </div>
                <h3 className="text-2xl font-extrabold text-yellow-600">{ambassadorsCount}</h3>
                <p className="text-[10px] text-slate-400 mt-1 font-semibold">
                  Clients avec influence {`>=`} 80%
                </p>
              </div>
            </div>

            {/* AI Recommendations */}
            {selectedCommerce !== "__all__" && recommendations.length > 0 && (
              <div className="mb-8 bg-gradient-to-r from-blue-50/50 to-indigo-50/20 border border-blue-100 rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Sparkles className="w-5 h-5 text-blue-600" />
                  <h4 className="text-sm font-bold text-slate-800">
                    Recommandations IA & Stratégie Marketing
                  </h4>
                </div>
                <div className="grid md:grid-cols-3 gap-4">
                  {recommendations.map((rec) => {
                    const isWarning = rec.type === "warning";
                    const isAlert = rec.type === "alert";

                    return (
                      <div
                        key={rec.id}
                        className={`bg-white border rounded-xl p-4 flex flex-col justify-between shadow-sm transition-all duration-200 hover:shadow-md ${
                          isAlert
                            ? "border-red-200"
                            : isWarning
                            ? "border-pink-200"
                            : "border-blue-200"
                        }`}
                      >
                        <div>
                          <div className="flex items-center gap-1.5 mb-2">
                            <span
                              className={`w-2.5 h-2.5 rounded-full ${
                                isAlert
                                  ? "bg-red-500"
                                  : isWarning
                                  ? "bg-pink-500"
                                  : "bg-blue-500"
                              }`}
                            ></span>
                            <h5 className="text-xs font-bold text-slate-800 leading-snug">
                              {rec.title}
                            </h5>
                          </div>
                          <p className="text-xs text-slate-500 leading-relaxed">{rec.message}</p>
                        </div>
                        <button
                          onClick={() => {
                            const qParams = new URLSearchParams();
                            if (rec.action?.filters) {
                              Object.entries(rec.action.filters).forEach(([k, v]) => {
                                qParams.set(k, String(v));
                              });
                            }
                            window.location.href = `/campaigns?${qParams.toString()}`;
                          }}
                          className={`self-start mt-4 text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all flex items-center gap-1 cursor-pointer ${
                            isAlert
                              ? "border-red-200 text-red-600 bg-red-50/30 hover:bg-red-50"
                              : isWarning
                              ? "border-pink-200 text-pink-600 bg-pink-50/30 hover:bg-pink-50"
                              : "border-blue-200 text-blue-600 bg-blue-50/30 hover:bg-blue-50"
                          }`}
                        >
                          {rec.action.label}
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
              {/* Doughnut 1: GMM Segments */}
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Répartition GMM
                  </h4>
                  <p className="text-sm font-bold text-slate-800">Segments Clients</p>
                </div>
                <div className="h-[200px] relative flex items-center justify-center">
                  <Doughnut data={segmentChartData} options={{ maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { family: "Outfit", size: 10 } } } } }} />
                </div>
              </div>

              {/* Doughnut 2: Churn Distribution */}
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Risques de Churn
                  </h4>
                  <p className="text-sm font-bold text-slate-800">Prédictions XGBoost</p>
                </div>
                <div className="h-[200px] relative flex items-center justify-center">
                  <Doughnut data={churnChartData} options={{ maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { family: "Outfit", size: 10 } } } } }} />
                </div>
              </div>

              {/* Bar 1: RFM Profiles */}
              <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 flex flex-col justify-between shadow-sm hover:shadow-md transition-shadow">
                <div className="mb-4">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                    Profils Moyens
                  </h4>
                  <p className="text-sm font-bold text-slate-800">Indicateurs RFM par Segment</p>
                </div>
                <div className="h-[200px] relative">
                  <Bar
                    data={rfmChartData}
                    options={{
                      maintainAspectRatio: false,
                      scales: {
                        y: { min: 0, max: 1.0, ticks: { stepSize: 0.2, font: { family: "Outfit", size: 9 } } },
                        x: { ticks: { font: { family: "Outfit", size: 10 } } }
                      },
                      plugins: {
                        legend: { position: "bottom", labels: { boxWidth: 10, font: { family: "Outfit", size: 9 } } }
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </>
        ) : (
          /* Tab 2: Global Shop Comparison */
          <div className="space-y-8 animate-fade-in">
            {/* Direct Comparison Table Card */}
            <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm overflow-hidden">
              <div className="mb-6">
                <h3 className="text-lg font-bold text-slate-800">
                  Comparaison Directe des Performances
                </h3>
                <p className="text-xs text-slate-400">
                  Vue croisée des boutiques. L'icône{" "}
                  <span className="inline-flex items-center justify-center bg-yellow-50 text-yellow-600 p-1 rounded-full border border-yellow-200">
                    <Trophy className="w-3 h-3" />
                  </span>{" "}
                  désigne le leader sur chaque indicateur.
                </p>
              </div>

              {globalComparison.length === 0 ? (
                <p className="text-sm text-slate-500 text-center py-10 font-semibold">
                  Aucune donnée disponible pour le comparateur.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <div className="min-w-[600px] space-y-3">
                    {/* Dynamic Headers */}
                    <div
                      className="grid gap-4 border-b-2 border-slate-100 pb-3 font-bold text-slate-500 text-xs tracking-wider"
                      style={{
                        gridTemplateColumns: `2fr repeat(${globalComparison.length}, 1fr)`
                      }}
                    >
                      <div>Indicateur de Performance</div>
                      {globalComparison.map((s, idx) => (
                        <div
                          key={s._id}
                          className="text-center"
                          style={{ color: storeColors[idx % storeColors.length] }}
                        >
                          {s.label}
                        </div>
                      ))}
                    </div>

                    {/* Metrics rows */}
                    {metrics.map((m) => {
                      const values = globalComparison.map((s) => s[m.key]);
                      const validValues = values.filter((v) => v !== null && v !== undefined);
                      let bestValue: number | null = null;
                      if (validValues.length > 0) {
                        bestValue = m.higher
                          ? Math.max(...validValues)
                          : Math.min(...validValues);
                      }

                      return (
                        <div
                          key={m.key}
                          className="grid gap-4 py-3 px-4 bg-slate-50/50 hover:bg-slate-50 rounded-xl items-center border border-slate-100 transition-colors"
                          style={{
                            gridTemplateColumns: `2fr repeat(${globalComparison.length}, 1fr)`
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold text-sm ${m.color}`}>{m.label}</span>
                          </div>

                          {globalComparison.map((s) => {
                            const val = s[m.key];
                            const isWinner =
                              val !== null && val !== undefined && val === bestValue;

                            let valColor = "text-slate-800";
                            if (m.isChurn && val !== null) {
                              valColor = val > 20 ? "text-rose-600" : "text-emerald-600";
                            } else if (!isWinner) {
                              valColor = "text-slate-500";
                            }

                            return (
                              <div
                                key={s._id}
                                className={`text-center py-1.5 px-2 rounded-lg text-sm flex items-center justify-center gap-1 transition-all ${
                                  isWinner
                                    ? "bg-yellow-500/10 border border-yellow-500/20 font-bold"
                                    : "border border-transparent"
                                }`}
                              >
                                <span className={valColor}>
                                  {val !== null && val !== undefined ? m.fmt(val) : "—"}
                                </span>
                                {isWinner && (
                                  <Trophy className="w-3.5 h-3.5 text-yellow-600 shrink-0" />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Shop Comparison Chart */}
            <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow">
              <div className="mb-6 flex items-center gap-2">
                <Trophy className="w-5 h-5 text-blue-600" />
                <h3 className="text-lg font-bold text-slate-800">
                  Performance Comparée des Boutiques
                </h3>
              </div>
              <div className="h-[350px] relative">
                {globalComparison.length > 0 && (
                  <Bar
                    data={comparisonChartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: {
                        legend: { position: "top", labels: { font: { family: "Outfit", size: 11, weight: "bold" } } }
                      },
                      scales: {
                        y: { beginAtZero: true, grid: { color: "rgba(0,0,0,0.03)" }, ticks: { font: { family: "Outfit", size: 10 } } },
                        x: { grid: { display: false }, ticks: { font: { family: "Outfit", size: 10 } } }
                      }
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
