"use client";

import React, { useEffect, useState } from "react";
import { Trophy, TrendingUp, TrendingDown, Users, Star, Flame, Award, BarChart3, Loader2, Download } from "lucide-react";
import { Bar } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

interface CommerceMetrics {
  id: string;
  name: string;
  totalClients: number;
  avgRfm: number;
  avgChurn: number;
  churnCount: number;
  ambassadorCount: number;
  avgFrequency: number;
  avgRecency: number;
  avgMontant: number;
  topSegment: string;
}

interface CommerceInfo {
  id: string;
  name?: string;
}

const METRIC_LABELS: Record<keyof Omit<CommerceMetrics, "id" | "name" | "topSegment">, string> = {
  totalClients: "Clients",
  avgRfm: "Score RFM moyen",
  avgChurn: "Risque Churn moyen",
  churnCount: "Nb Churn ≥ 55%",
  ambassadorCount: "Ambassadeurs",
  avgFrequency: "Fréquence moy.",
  avgRecency: "Récence moy. (j)",
  avgMontant: "Montant moy. (DA)",
};

const METRIC_KEYS = Object.keys(METRIC_LABELS) as Array<keyof typeof METRIC_LABELS>;

const METRIC_ICONS: Record<string, React.ReactElement> = {
  totalClients: <Users className="w-3.5 h-3.5" />,
  avgRfm: <Star className="w-3.5 h-3.5" />,
  avgChurn: <Flame className="w-3.5 h-3.5 text-rose-500" />,
  churnCount: <Flame className="w-3.5 h-3.5 text-rose-500" />,
  ambassadorCount: <Award className="w-3.5 h-3.5 text-amber-500" />,
  avgFrequency: <TrendingUp className="w-3.5 h-3.5" />,
  avgRecency: <TrendingDown className="w-3.5 h-3.5" />,
  avgMontant: <BarChart3 className="w-3.5 h-3.5" />,
};

// For some metrics, lower is "better" (churn, recency)
const LOWER_IS_BETTER = new Set(["avgChurn", "churnCount", "avgRecency"]);

function computeLeaders(metrics: CommerceMetrics[]): Record<string, string> {
  const leaders: Record<string, string> = {};
  METRIC_KEYS.forEach((key) => {
    const sorted = [...metrics].sort((a, b) =>
      LOWER_IS_BETTER.has(key) ? a[key] - b[key] : b[key] - a[key]
    );
    if (sorted.length > 0) leaders[key] = sorted[0].id;
  });
  return leaders;
}

const CHART_COLORS = [
  "rgba(59, 130, 246, 0.85)",
  "rgba(139, 92, 246, 0.85)",
  "rgba(16, 185, 129, 0.85)",
  "rgba(245, 158, 11, 0.85)",
  "rgba(239, 68, 68, 0.85)",
  "rgba(20, 184, 166, 0.85)",
];

export default function GlobalPage() {
  const [loading, setLoading] = useState(true);
  const [commerces, setCommerces] = useState<CommerceMetrics[]>([]);
  const [selectedMetric, setSelectedMetric] = useState<keyof typeof METRIC_LABELS>("avgRfm");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const shopsRes = await fetch("/api/commerces");
        const rawShops = await shopsRes.json();
        const shops: CommerceInfo[] = Array.isArray(rawShops) ? rawShops : [];

        const allPromises = shops.map(async (shop) => {
          const res = await fetch(`/api/data?commerce_id=${encodeURIComponent(shop.id)}`);
          const data = await res.json();
          const clients: any[] = Array.isArray(data) ? data : [];

          if (clients.length === 0) {
            return {
              id: shop.id,
              name: shop.name || shop.id,
              totalClients: 0,
              avgRfm: 0,
              avgChurn: 0,
              churnCount: 0,
              ambassadorCount: 0,
              avgFrequency: 0,
              avgRecency: 0,
              avgMontant: 0,
              topSegment: "N/A",
            } as CommerceMetrics;
          }

          const avg = (field: string) =>
            clients.reduce((acc, c) => acc + (Number(c[field]) || 0), 0) / clients.length;

          const segmentCounts: Record<string, number> = {};
          clients.forEach((c) => {
            const seg = c.segment_gmm || c.segment || "inconnu";
            segmentCounts[seg] = (segmentCounts[seg] || 0) + 1;
          });
          const topSegment = Object.entries(segmentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "N/A";

          return {
            id: shop.id,
            name: shop.name || shop.id,
            totalClients: clients.length,
            avgRfm: Math.round(avg("score_global_sa") * 100) / 100,
            avgChurn: Math.round(avg("churn_score") * 100) / 100,
            churnCount: clients.filter((c) => (c.churn_score || 0) >= 0.55).length,
            ambassadorCount: clients.filter((c) => {
              const infl = c.influence_score !== undefined
                ? c.influence_score
                : Math.round(((c.score_global_sa || 0) * 0.7 + (1.0 - (c.churn_score || 0)) * 0.3) * 100);
              return infl >= 80;
            }).length,
            avgFrequency: Math.round(avg("frequency") * 10) / 10,
            avgRecency: Math.round(avg("recency") * 10) / 10,
            avgMontant: Math.round(avg("monetary") * 10) / 10,
            topSegment,
          } as CommerceMetrics;
        });

        const results = await Promise.all(allPromises);
        setCommerces(results);
      } catch (err) {
        console.error(err);
        setError("Impossible de charger les données multi-boutiques.");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const leaders = computeLeaders(commerces);

  const chartData = {
    labels: commerces.map((c) => c.name),
    datasets: [
      {
        label: METRIC_LABELS[selectedMetric],
        data: commerces.map((c) => c[selectedMetric]),
        backgroundColor: commerces.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]),
        borderRadius: 8,
        borderSkipped: false,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx: any) => ` ${ctx.raw}`,
        },
      },
    },
    scales: {
      x: {
        grid: { display: false },
        ticks: { font: { size: 11 }, color: "#64748b" },
      },
      y: {
        grid: { color: "#f1f5f9" },
        ticks: { font: { size: 10 }, color: "#94a3b8" },
      },
    },
  };

  function formatValue(key: keyof typeof METRIC_LABELS, val: number): string {
    if (key === "avgChurn") return `${(val * 100).toFixed(1)}%`;
    if (key === "avgRfm") return val.toFixed(2);
    if (key === "avgMontant") return `${val.toLocaleString("fr-FR")} DA`;
    if (key === "avgRecency") return `${val.toFixed(1)} j`;
    return String(val);
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center shadow-md">
            <Trophy className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-slate-900 tracking-tight">Vue Globale</h1>
            <p className="text-xs text-slate-400 font-medium mt-0.5">Comparatif performance multi-boutiques — données en temps réel</p>
          </div>
        </div>

        <a
          href="/api/export/global"
          download
          className="bg-white border border-[#e5e5e5] hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          Exporter CSV
        </a>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-40 gap-3 text-slate-400">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <span className="text-sm font-bold">Chargement des boutiques...</span>
        </div>
      ) : error ? (
        <div className="text-center py-20 text-rose-600 font-bold text-sm">{error}</div>
      ) : (
        <>
          {/* Metric Selector for Chart */}
          <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-blue-600" />
                <h2 className="font-extrabold text-slate-800 text-sm">Comparatif par indicateur</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {METRIC_KEYS.map((key) => (
                  <button
                    key={key}
                    onClick={() => setSelectedMetric(key)}
                    className={`text-[10px] font-bold px-3 py-1.5 rounded-lg border transition-all cursor-pointer ${
                      selectedMetric === key
                        ? "bg-blue-600 text-white border-blue-600"
                        : "bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100"
                    }`}
                  >
                    {METRIC_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            <div className="h-56">
              {commerces.length > 0 ? (
                <Bar data={chartData} options={chartOptions} />
              ) : (
                <div className="h-full flex items-center justify-center text-slate-400 text-xs">Aucune donnée.</div>
              )}
            </div>
          </div>

          {/* Comparison Table */}
          <div className="bg-white border border-[#e5e5e5] rounded-2xl overflow-hidden shadow-sm">
            <div className="p-5 border-b border-slate-100 flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              <h2 className="font-extrabold text-slate-800 text-sm">Tableau Comparatif Complet</h2>
              <span className="ml-auto text-[10px] text-slate-400 font-bold">🏆 = leader sur cet indicateur</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100">
                    <th className="text-left px-5 py-3 font-extrabold text-slate-500 uppercase tracking-wider text-[10px] sticky left-0 bg-slate-50">
                      Boutique
                    </th>
                    {METRIC_KEYS.map((key) => (
                      <th key={key} className="text-center px-4 py-3 font-extrabold text-slate-500 uppercase tracking-wider text-[10px] whitespace-nowrap">
                        <div className="flex items-center justify-center gap-1">
                          {METRIC_ICONS[key]}
                          {METRIC_LABELS[key]}
                        </div>
                      </th>
                    ))}
                    <th className="text-center px-4 py-3 font-extrabold text-slate-500 uppercase tracking-wider text-[10px]">
                      Segment Dominant
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {commerces.map((commerce, rowIdx) => (
                    <tr
                      key={commerce.id}
                      className={`border-b border-slate-50 hover:bg-blue-50/20 transition-colors ${
                        rowIdx % 2 === 0 ? "" : "bg-slate-50/30"
                      }`}
                    >
                      <td className="px-5 py-3.5 font-extrabold text-slate-800 sticky left-0 bg-white whitespace-nowrap">
                        {commerce.name}
                      </td>
                      {METRIC_KEYS.map((key) => {
                        const isLeader = leaders[key] === commerce.id;
                        const val = commerce[key];
                        return (
                          <td key={key} className="px-4 py-3.5 text-center">
                            <span
                              className={`inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-lg font-bold text-[11px] ${
                                isLeader
                                  ? "bg-amber-50 text-amber-700 border border-amber-200"
                                  : "text-slate-700"
                              }`}
                            >
                              {isLeader && <span className="text-amber-500">🏆</span>}
                              {formatValue(key, val)}
                            </span>
                          </td>
                        );
                      })}
                      <td className="px-4 py-3.5 text-center">
                        <span className="px-2.5 py-1 bg-indigo-50 border border-indigo-100 text-indigo-700 rounded-lg font-bold text-[10px]">
                          {commerce.topSegment}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
