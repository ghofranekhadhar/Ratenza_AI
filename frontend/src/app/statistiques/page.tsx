"use client";

import { useEffect, useState, useMemo } from "react";
import {
  BarChart3,
  TrendingUp,
  Send,
  Eye,
  ShoppingCart,
  DollarSign,
  Sparkles,
  RefreshCw,
  Info,
  Calendar,
  Filter,
  CheckCircle,
  ArrowUpRight,
  Users,
  Bot,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Search,
  Award,
  Download,
  ArrowUpDown,
  ChevronUp,
  ChevronDown,
  HelpCircle,
  Layers,
  ArrowRight
} from "lucide-react";

interface GlobalKPIs {
  total_sent: number;
  total_sent_tracked: number;
  total_opened: number;
  total_converted: number;
  total_converted_all: number;
  total_revenue: number;
  open_rate: number;
  conversion_rate: number;
  tracked_batches_count: number;
  top_category: string;
  top_category_revenue_val?: number;
  top_category_efficiency?: string;
  top_category_efficiency_val?: number;
}

interface CategoryStat {
  category: string;
  total_sent: number;
  total_sent_tracked: number;
  total_opened: number;
  total_converted: number;
  revenue_generated: number;
  open_rate: number;
  conversion_rate: number;
  revenue_per_recipient: number;
}

interface CampaignBatch {
  batch_id: string;
  subject: string;
  category: string;
  segment: string;
  sent_at: string;
  total_sent: number;
  total_opened: number;
  total_converted: number;
  open_rate: number;
  conversion_rate: number;
  revenue_generated: number;
  revenue_per_recipient: number;
  is_tracked?: boolean;
}

interface RecommendationData {
  recommended_category: string;
  title: string;
  eligible_count: number;
  reasoning: string;
  sample_clients: { email: string; nom: string }[];
  conversion_rate_estimate: number;
}

type SortColumn =
  | "sent_at"
  | "subject"
  | "category"
  | "total_sent"
  | "open_rate"
  | "conversion_rate"
  | "revenue_generated"
  | "revenue_per_recipient";

type SortDirection = "asc" | "desc";

export default function StatistiquesPage() {
  const [selectedCommerce, setSelectedCommerce] = useState<string>("__all__");
  const [windowDays, setWindowDays] = useState<number>(7);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  const [globalKPIs, setGlobalKPIs] = useState<GlobalKPIs | null>(null);
  const [categoryStats, setCategoryStats] = useState<CategoryStat[]>([]);
  const [batches, setBatches] = useState<CampaignBatch[]>([]);
  const [recommendation, setRecommendation] = useState<RecommendationData | null>(null);

  // Table filters, sorting, pagination
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [sortColumn, setSortColumn] = useState<SortColumn>("sent_at");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [rowsPerPage, setRowsPerPage] = useState<number>(10);

  // Chart mode: "revenue" or "conversion"
  const [chartMetric, setChartMetric] = useState<"revenue" | "conversion">("revenue");

  // Collapsible info banner toggle
  const [showNotes, setShowNotes] = useState<boolean>(false);

  // Load commerce preference
  useEffect(() => {
    const saved = localStorage.getItem("ratenza_commerce_id");
    if (saved) setSelectedCommerce(saved);
  }, []);

  // Fetch statistics & recommendations
  const fetchData = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    else setLoading(true);

    try {
      const statsRes = await fetch(
        `/api/campaigns/advanced-stats?commerce_id=${encodeURIComponent(selectedCommerce)}&window_days=${windowDays}`
      );
      const stats = await statsRes.json();

      if (stats && !stats.error) {
        setGlobalKPIs(stats.global_kpis || null);
        setCategoryStats(stats.category_stats || []);
        setBatches(stats.batches || []);
      }

      const recRes = await fetch(
        `/api/campaigns/recommendations-ai?commerce_id=${encodeURIComponent(selectedCommerce)}`
      );
      const rec = await recRes.json();

      if (rec && !rec.error) {
        setRecommendation(rec);
      }
    } catch (err) {
      console.error("Erreur chargement statistiques :", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchData();
    setCurrentPage(1); // Reset page on filter change
  }, [selectedCommerce, windowDays]);

  // Handle column header click for sorting
  const handleSort = (column: SortColumn) => {
    if (sortColumn === column) {
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    } else {
      setSortColumn(column);
      setSortDirection("desc"); // Default to desc for numeric/dates
    }
  };

  // CSV Export Handler
  const exportToCSV = () => {
    if (!globalKPIs) return;

    const now = new Date();
    const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ""); // YYYYMMDD
    const formattedDate = now.toLocaleDateString("fr-FR");

    const commerceSlug =
      selectedCommerce === "__all__"
        ? "toutes_boutiques"
        : selectedCommerce.toLowerCase().replace(/[^a-z0-9_]/g, "_");

    const filename = `statistiques_${commerceSlug}_${windowDays}j_${dateStr}.csv`;

    let csv = "\uFEFF"; // UTF-8 BOM

    csv += `RÉSUMÉ STATISTIQUES AVANCÉES DES CAMPAGNES;Boutique: ${selectedCommerce === "__all__" ? "Toutes les boutiques" : selectedCommerce};Fenêtre d'attribution: ${windowDays} jours;Exporté le: ${formattedDate}\n\n`;

    csv += "INDICATEURS CLÉS (KPIS GLOBAUX)\n";
    csv += "Indicateur;Valeur;Description / Précision\n";
    csv += `Chiffre d'Affaires Total;${globalKPIs.total_revenue.toFixed(2)} DT;CA attribué via Last-Touch sur la période\n`;
    csv += `Taux d'Ouverture;${(globalKPIs.tracked_batches_count ?? 0) > 0 ? globalKPIs.open_rate.toFixed(1) + "%" : "N/A"};Sur ${globalKPIs.total_sent_tracked} envois trackés avec pixel\n`;
    csv += `Taux de Conversion;${(globalKPIs.tracked_batches_count ?? 0) > 0 ? globalKPIs.conversion_rate.toFixed(1) + "%" : "N/A"};Sur ${globalKPIs.total_sent_tracked} envois trackés avec pixel\n`;
    csv += `Top CA Total (Volume);${getCategoryBadge(globalKPIs.top_category).label};${(globalKPIs.top_category_revenue_val || 0).toFixed(2)} DT\n`;
    csv += `Top Rendement / Client;${getCategoryBadge(globalKPIs.top_category_efficiency || "N/A").label};${(globalKPIs.top_category_efficiency_val || 0).toFixed(2)} DT/client\n`;
    csv += `Total Envois Cumulés;${globalKPIs.total_sent};(dont ${globalKPIs.total_sent_tracked} envois avec tracking actif)\n\n`;

    csv += "FILTRES ACTIFS LORS DE L'EXPORT\n";
    csv += `Filtre Catégorie;${categoryFilter === "all" ? "Toutes catégories" : categoryFilter}\n`;
    csv += `Recherche Sujet;${searchTerm ? `"${searchTerm}"` : "Aucune"}\n`;
    csv += `Lignes exportées;${sortedAndFilteredBatches.length} sur ${batches.length} au total\n\n`;

    csv += "HISTORIQUE DES CAMPAGNES ENVOYÉES (DÉTAIL PAR ENVOI)\n";
    csv += "Date d'Envoi;Sujet de la Campagne;Catégorie / Segment;Destinataires;Ouverts;Convertis;Taux d'Ouverture (%);Taux de Conversion (%);CA Généré (DT);CA par Client (DT)\n";

    sortedAndFilteredBatches.forEach((b) => {
      const sentDate = b.sent_at
        ? new Date(b.sent_at).toLocaleString("fr-FR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit"
          })
        : "N/A";

      const badgeLabel = getCategoryBadge(b.category).label;
      const cleanSubject = `"${(b.subject || "").replace(/"/g, '""')}"`;

      csv += `${sentDate};${cleanSubject};${badgeLabel};${b.total_sent};${b.total_opened};${b.total_converted};${b.open_rate.toFixed(1)};${b.conversion_rate.toFixed(1)};${b.revenue_generated.toFixed(2)};${b.revenue_per_recipient.toFixed(2)}\n`;
    });

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Category badges with curated colors
  const getCategoryBadge = (category: string) => {
    switch (category) {
      case "birthday_gift":
        return { label: "Anniversaire", color: "bg-pink-100 text-pink-700 border-pink-200" };
      case "vip_danger":
        return { label: "Rétention VIP", color: "bg-amber-100 text-amber-700 border-amber-200" };
      case "ambassador_invite":
        return { label: "Ambassadeurs", color: "bg-yellow-100 text-yellow-800 border-yellow-200" };
      case "baisse_frequence":
        return { label: "Baisse Fréquence", color: "bg-red-100 text-red-700 border-red-200" };
      case "lost":
        return { label: "Reconquête", color: "bg-rose-100 text-rose-700 border-rose-200" };
      case "at_risk":
        return { label: "À Risque", color: "bg-orange-100 text-orange-700 border-orange-200" };
      case "vip":
        return { label: "Fidélité VIP", color: "bg-indigo-100 text-indigo-700 border-indigo-200" };
      case "regular":
        return { label: "Offre Régulière", color: "bg-blue-100 text-blue-700 border-blue-200" };
      default:
        return { label: category || "Général", color: "bg-slate-100 text-slate-700 border-slate-200" };
    }
  };

  // Filtered and Sorted batches for table
  const sortedAndFilteredBatches = useMemo(() => {
    const list = batches.filter((b) => {
      if (categoryFilter !== "all" && b.category !== categoryFilter) return false;
      if (
        searchTerm &&
        !b.subject.toLowerCase().includes(searchTerm.toLowerCase()) &&
        !b.batch_id.toLowerCase().includes(searchTerm.toLowerCase())
      ) {
        return false;
      }
      return true;
    });

    list.sort((a, b) => {
      let valA: any = a[sortColumn];
      let valB: any = b[sortColumn];

      if (sortColumn === "sent_at") {
        valA = new Date(a.sent_at).getTime();
        valB = new Date(b.sent_at).getTime();
      } else if (typeof valA === "string") {
        valA = valA.toLowerCase();
        valB = (valB || "").toLowerCase();
      }

      if (valA < valB) return sortDirection === "asc" ? -1 : 1;
      if (valA > valB) return sortDirection === "asc" ? 1 : -1;
      return 0;
    });

    return list;
  }, [batches, categoryFilter, searchTerm, sortColumn, sortDirection]);

  // Paginated batches
  const totalPages = Math.ceil(sortedAndFilteredBatches.length / rowsPerPage) || 1;
  const paginatedBatches = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return sortedAndFilteredBatches.slice(start, start + rowsPerPage);
  }, [sortedAndFilteredBatches, currentPage, rowsPerPage]);

  // Max value for Chart scaling
  const maxChartValue = useMemo(() => {
    if (categoryStats.length === 0) return 1;
    if (chartMetric === "revenue") {
      return Math.max(...categoryStats.map((c) => c.revenue_generated), 1);
    } else {
      return Math.max(...categoryStats.map((c) => c.conversion_rate), 1);
    }
  }, [categoryStats, chartMetric]);

  return (
    <div className="flex-1 p-6 md:p-8 max-w-7xl mx-auto w-full flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 shrink-0">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <BarChart3 className="w-4 h-4" />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 tracking-tight">
              Statistiques Avancées des Campagnes
            </h2>
            <span className="bg-gradient-to-r from-blue-600 to-indigo-600 text-white text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider shadow-sm">
              Attribution CA
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Mesure en temps réel du chiffre d'affaires généré, du taux d'ouverture et de conversion par campagne
          </p>
        </div>

        {/* Filters bar */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Boutique Selector */}
          <select
            value={selectedCommerce}
            onChange={(e) => setSelectedCommerce(e.target.value)}
            className="bg-white border border-slate-200 px-3.5 py-2 rounded-xl text-xs font-bold text-slate-700 outline-none hover:border-slate-300 focus:border-blue-600 transition-all cursor-pointer shadow-sm"
          >
            <option value="__all__">Toutes les boutiques</option>
            <option value="commerce_local_1">Commerce Local 1</option>
            <option value="commerce_local_2">Commerce Local 2</option>
            <option value="boutique_paris">Boutique Paris</option>
            <option value="boutique_tunis">Boutique Tunis</option>
          </select>

          {/* Window Selector */}
          <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 shadow-inner">
            {[7, 14, 30].map((days) => (
              <button
                key={days}
                onClick={() => setWindowDays(days)}
                className={`px-3 py-1 rounded-lg text-xs font-extrabold transition-all ${
                  windowDays === days
                    ? "bg-white text-blue-600 shadow-sm"
                    : "text-slate-500 hover:text-slate-900"
                }`}
              >
                {days} Jours
              </button>
            ))}
          </div>

          {/* Refresh Button */}
          <button
            onClick={() => fetchData(true)}
            disabled={refreshing || loading}
            className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-700 px-3.5 py-2 rounded-xl text-xs font-bold shadow-sm transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin text-blue-600" : ""}`} />
            Actualiser
          </button>

          {/* Export CSV Button */}
          <button
            onClick={exportToCSV}
            disabled={loading || !globalKPIs}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-3.5 py-2 rounded-xl text-xs font-extrabold shadow-md shadow-emerald-600/20 transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50 hover:scale-[1.02] active:scale-[0.98]"
            title="Exporter les statistiques et l'historique au format CSV (UTF-8 avec BOM)"
          >
            <Download className="w-3.5 h-3.5" />
            Exporter CSV
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex-1 flex flex-col items-center justify-center py-28">
          <Loader2 className="w-10 h-10 text-blue-600 animate-spin" />
          <p className="text-xs text-slate-500 font-bold mt-3">Calcul de l'attribution et des statistiques...</p>
        </div>
      ) : (
        <>
          {/* Top 4 KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {/* Card 1: CA Total (Emerald Accent) */}
            <div className="bg-gradient-to-br from-emerald-50/50 via-white to-white border border-emerald-200/80 hover:border-emerald-400 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-emerald-800 uppercase tracking-wider">CA Total Généré</span>
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white shadow-md shadow-emerald-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <DollarSign className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">
                  {(globalKPIs?.total_revenue || 0).toLocaleString("fr-FR", { minimumFractionDigits: 2 })} <span className="text-lg font-bold text-slate-500">DT</span>
                </h3>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-800 border border-emerald-200">
                    Window {windowDays}j
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">Attribution Last-Touch</span>
                </div>
              </div>
            </div>

            {/* Card 2: Taux d'Ouverture (Blue Accent) */}
            <div className="bg-gradient-to-br from-blue-50/50 via-white to-white border border-blue-200/80 hover:border-blue-400 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-blue-800 uppercase tracking-wider">Taux d'Ouverture</span>
                <div className="w-9 h-9 rounded-xl bg-blue-600 text-white shadow-md shadow-blue-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Eye className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">
                  {(globalKPIs?.tracked_batches_count ?? 0) > 0
                    ? `${(globalKPIs?.open_rate || 0).toFixed(1)}%`
                    : <span className="text-xl font-bold text-slate-400">N/A</span>
                  }
                </h3>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-[11px] font-semibold text-slate-600 truncate">
                    {(globalKPIs?.tracked_batches_count ?? 0) > 0
                      ? `${globalKPIs!.total_opened} / ${globalKPIs!.total_sent_tracked} trackés`
                      : "Historique non tracké"}
                  </span>
                  {globalKPIs && globalKPIs.total_sent_tracked > 0 && globalKPIs.total_sent_tracked < 30 && (
                    <span className="text-[9px] font-bold text-amber-700 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded-full">
                      Test
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Card 3: Taux de Conversion (Indigo Accent) */}
            <div className="bg-gradient-to-br from-indigo-50/50 via-white to-white border border-indigo-200/80 hover:border-indigo-400 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-indigo-800 uppercase tracking-wider">Taux de Conversion</span>
                <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white shadow-md shadow-indigo-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <ShoppingCart className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-4">
                <h3 className="text-3xl font-black text-slate-900 tracking-tight">
                  {(globalKPIs?.tracked_batches_count ?? 0) > 0
                    ? `${(globalKPIs?.conversion_rate || 0).toFixed(1)}%`
                    : <span className="text-xl font-bold text-slate-400">N/A</span>
                  }
                </h3>
                <div className="flex items-center gap-1.5 mt-2">
                  <span className="text-[11px] font-semibold text-slate-600">
                    {(globalKPIs?.tracked_batches_count ?? 0) > 0
                      ? `${globalKPIs?.total_converted || 0} / ${globalKPIs?.total_sent_tracked || 0} clients`
                      : `${globalKPIs?.total_converted_all || 0} acheteurs`
                    }
                  </span>
                </div>
              </div>
            </div>

            {/* Card 4: Top Campagnes (Amber/Gold Accent) */}
            <div className="bg-gradient-to-br from-amber-50/50 via-white to-white border border-amber-200/80 hover:border-amber-400 rounded-2xl p-5 shadow-sm hover:shadow-md transition-all flex flex-col justify-between group">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-extrabold text-amber-800 uppercase tracking-wider">Top Campagnes</span>
                <div className="w-9 h-9 rounded-xl bg-amber-500 text-white shadow-md shadow-amber-500/20 flex items-center justify-center group-hover:scale-110 transition-transform">
                  <Award className="w-5 h-5" />
                </div>
              </div>
              <div className="mt-3 space-y-2">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-extrabold text-slate-400 uppercase">Top CA Total :</span>
                    <span className="text-[11px] font-black text-emerald-600">
                      {globalKPIs?.top_category_revenue_val ? `${globalKPIs.top_category_revenue_val.toFixed(2)} DT` : ""}
                    </span>
                  </div>
                  <h3 className="text-sm font-black text-slate-900 truncate">
                    {getCategoryBadge(globalKPIs?.top_category || "N/A").label}
                  </h3>
                </div>

                {globalKPIs?.top_category_efficiency && (
                  <div className="pt-1.5 border-t border-amber-100">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-extrabold text-slate-400 uppercase">Top Rendement/Client :</span>
                      <span className="text-[11px] font-black text-indigo-600">
                        {globalKPIs?.top_category_efficiency_val ? `${globalKPIs.top_category_efficiency_val.toFixed(2)} DT/cli` : ""}
                      </span>
                    </div>
                    <h4 className="text-xs font-extrabold text-slate-800 truncate">
                      {getCategoryBadge(globalKPIs.top_category_efficiency).label}
                    </h4>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Compact Collapsible Info Banner */}
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 shadow-sm transition-all">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-slate-700 text-xs font-bold">
                <Info className="w-4 h-4 text-blue-600 shrink-0" />
                <span>
                  Notes sur la représentativité & le tracking pixel
                  {globalKPIs && globalKPIs.total_sent_tracked > 0 && globalKPIs.total_sent_tracked < 30 && (
                    <span className="ml-2 inline-flex items-center px-2 py-0.5 rounded text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-200">
                      Échantillon réduit ({globalKPIs.total_sent_tracked} envois)
                    </span>
                  )}
                </span>
              </div>
              <button
                onClick={() => setShowNotes(!showNotes)}
                className="text-xs font-extrabold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer transition-colors"
              >
                {showNotes ? "Masquer les détails" : "En savoir plus"}
                {showNotes ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </button>
            </div>

            {showNotes && (
              <div className="mt-3 pt-3 border-t border-slate-200 text-xs text-slate-600 space-y-2 leading-relaxed">
                <p>
                  • <strong>Tracking d'Ouverture :</strong> Le taux d'ouverture est estimé grâce à un pixel transparent 1x1. Certains clients mail (Gmail, Apple Mail) bloquent les images automatiques, ce qui peut sous-évaluer le taux d'ouverture réel.
                </p>
                <p>
                  • <strong>Taille de l'Échantillon :</strong> Les taux d'ouverture et de conversion sont calculés exclusivement sur les envois possédant un suivi pixel actif (hors données historiques). Les pourcentages se stabiliseront après ~30 envois réels.
                </p>
              </div>
            )}
          </div>

          {/* AI Recommendation Assistant Section */}
          {recommendation && (
            <div className="bg-gradient-to-br from-slate-950 via-indigo-950 to-slate-900 text-white rounded-3xl p-6 md:p-8 shadow-xl relative overflow-hidden border border-indigo-900/60">
              <div className="absolute -right-12 -bottom-12 w-72 h-72 bg-indigo-500/15 rounded-full blur-3xl pointer-events-none"></div>

              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                <div className="space-y-4 max-w-2xl">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className="bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-indigo-400" />
                      Assistant IA de Recommandation
                    </span>
                    <span className="bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 px-3 py-1 rounded-full text-xs font-black flex items-center gap-1.5 shadow-sm">
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-400" />
                      Potentiel estimé : <strong className="text-sm text-emerald-300">{recommendation.conversion_rate_estimate}% Conversion</strong>
                    </span>
                  </div>

                  <div>
                    <h3 className="text-xl font-black tracking-tight text-white">
                      Recommandation Stratégique : {recommendation.title}
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed mt-2 font-medium">
                      {recommendation.reasoning}
                    </p>
                  </div>

                  {/* Sample target preview */}
                  {recommendation.sample_clients && recommendation.sample_clients.length > 0 && (
                    <div className="flex items-center gap-2 pt-1 flex-wrap">
                      <span className="text-[11px] font-bold text-slate-400">Exemples de cibles :</span>
                      {recommendation.sample_clients.map((c, i) => (
                        <span key={i} className="bg-white/10 text-slate-200 text-[10px] font-bold px-2.5 py-1 rounded-lg border border-white/10">
                          {c.nom} ({c.email})
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-start lg:items-end gap-3 border-t lg:border-t-0 lg:border-l border-white/10 pt-4 lg:pt-0 lg:pl-8">
                  <div className="text-left lg:text-right">
                    <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider block">Audience Éligible Non-Contactée</span>
                    <strong className="text-3xl font-black text-emerald-400">{recommendation.eligible_count} Clients</strong>
                  </div>

                  <a
                    href={`/campaigns?target_category=${recommendation.recommended_category}`}
                    className="bg-gradient-to-r from-indigo-500 via-indigo-600 to-purple-600 hover:from-indigo-400 hover:to-purple-500 text-white px-6 py-3.5 rounded-2xl text-xs font-black shadow-lg shadow-indigo-600/30 hover:shadow-indigo-500/50 transition-all hover:scale-[1.02] active:scale-[0.98] flex items-center gap-2.5 cursor-pointer"
                  >
                    <Send className="w-4 h-4" />
                    Lancer cette campagne ({recommendation.eligible_count} cibles)
                    <ArrowRight className="w-4 h-4 ml-1" />
                  </a>
                </div>
              </div>
            </div>
          )}

          {/* Section 2: Proportional Performance Chart by Category */}
          <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base flex items-center gap-2">
                  <Layers className="w-4 h-4 text-blue-600" />
                  Comparaison des Performances par Type de Campagne
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">Échelle proportionnelle commune pour comparer équitablement chaque catégorie</p>
              </div>

              {/* Chart Metric Switcher */}
              <div className="flex items-center bg-slate-100 p-1 rounded-xl border border-slate-200 self-start sm:self-auto">
                <button
                  onClick={() => setChartMetric("revenue")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    chartMetric === "revenue"
                      ? "bg-white text-emerald-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  CA Généré (DT)
                </button>
                <button
                  onClick={() => setChartMetric("conversion")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition-all ${
                    chartMetric === "conversion"
                      ? "bg-white text-indigo-600 shadow-sm"
                      : "text-slate-500 hover:text-slate-900"
                  }`}
                >
                  Taux de Conversion (%)
                </button>
              </div>
            </div>

            {categoryStats.length === 0 ? (
              <div className="py-12 text-center text-slate-400 text-xs font-bold">
                Aucune donnée de campagne enregistrée pour cette période.
              </div>
            ) : (
              <div className="space-y-4 pt-2">
                {categoryStats.map((cat, idx) => {
                  const badge = getCategoryBadge(cat.category);
                  const metricValue = chartMetric === "revenue" ? cat.revenue_generated : cat.conversion_rate;
                  const barPct = (metricValue / maxChartValue) * 100;

                  return (
                    <div key={idx} className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs font-bold">
                        <div className="flex items-center gap-2.5">
                          <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-extrabold border ${badge.color}`}>
                            {badge.label}
                          </span>
                          <span className="text-slate-500 font-medium">
                            {cat.total_sent} destinataires {cat.total_sent_tracked > 0 ? `(${cat.total_sent_tracked} trackés)` : ""}
                          </span>
                        </div>
                        <div className="flex items-center gap-4 text-slate-600">
                          {chartMetric === "revenue" ? (
                            <span className="font-black text-emerald-600 text-sm">
                              {cat.revenue_generated.toFixed(2)} DT
                              <span className="text-[10px] font-normal text-slate-400 ml-1">({cat.revenue_per_recipient.toFixed(2)} DT/cli)</span>
                            </span>
                          ) : (
                            <span className="font-black text-indigo-600 text-sm">
                              {cat.conversion_rate}%
                              <span className="text-[10px] font-normal text-slate-400 ml-1">({cat.total_converted} conv.)</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Proportional Visual Bar */}
                      <div className="w-full h-4 bg-slate-100 rounded-full overflow-hidden flex p-0.5">
                        <div
                          className={`h-full rounded-full transition-all duration-700 ${
                            chartMetric === "revenue"
                              ? "bg-gradient-to-r from-emerald-500 to-teal-600"
                              : "bg-gradient-to-r from-indigo-500 to-purple-600"
                          }`}
                          style={{ width: `${Math.max(barPct, metricValue > 0 ? 4 : 0)}%` }}
                        ></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Section 3: Detailed Campaign Batches Table */}
          <div className="bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-4 bg-slate-50/60">
              <div>
                <h3 className="font-extrabold text-slate-900 text-base">Historique des Campagnes Envoyées</h3>
                <p className="text-xs text-slate-400 mt-0.5">Consultez, triez et filtrait chaque envoi collectif ou automatique</p>
              </div>

              {/* Table search & category filter */}
              <div className="flex items-center gap-2.5 flex-wrap">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Rechercher sujet..."
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:border-blue-600 w-44 font-semibold text-slate-700 shadow-sm"
                  />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(e) => {
                    setCategoryFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="bg-white border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 outline-none focus:border-blue-600 cursor-pointer shadow-sm"
                >
                  <option value="all">Toutes catégories</option>
                  <option value="birthday_gift">Anniversaire</option>
                  <option value="vip_danger">Rétention VIP</option>
                  <option value="ambassador_invite">Ambassadeurs</option>
                  <option value="baisse_frequence">Baisse Fréquence</option>
                  <option value="lost">Reconquête</option>
                  <option value="at_risk">À Risque</option>
                  <option value="vip">Fidélité VIP</option>
                  <option value="regular">Offre Régulière</option>
                </select>

                <button
                  onClick={exportToCSV}
                  disabled={loading || !globalKPIs || sortedAndFilteredBatches.length === 0}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200 px-3 py-1.5 rounded-xl text-xs font-extrabold transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  title="Exporter ce tableau filtré au format CSV"
                >
                  <Download className="w-3.5 h-3.5 text-slate-600" />
                  Exporter
                </button>
              </div>
            </div>

            {sortedAndFilteredBatches.length === 0 ? (
              <div className="py-16 text-center text-slate-400 text-xs font-bold">
                Aucun envoi de campagne ne correspond aux filtres.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead className="bg-slate-50 border-b border-slate-200 font-extrabold text-slate-500 uppercase tracking-wider select-none">
                      <tr>
                        <th
                          onClick={() => handleSort("sent_at")}
                          className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>Date d'Envoi</span>
                            {sortColumn === "sent_at" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("subject")}
                          className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>Sujet de la Campagne</span>
                            {sortColumn === "subject" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("category")}
                          className="px-6 py-4 cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center gap-1">
                            <span>Catégorie</span>
                            {sortColumn === "category" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("total_sent")}
                          className="px-6 py-4 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>Destinataires</span>
                            {sortColumn === "total_sent" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("open_rate")}
                          className="px-6 py-4 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>Ouverture</span>
                            {sortColumn === "open_rate" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("conversion_rate")}
                          className="px-6 py-4 text-center cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1">
                            <span>Conversion</span>
                            {sortColumn === "conversion_rate" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("revenue_generated")}
                          className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>CA Généré</span>
                            {sortColumn === "revenue_generated" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                        <th
                          onClick={() => handleSort("revenue_per_recipient")}
                          className="px-6 py-4 text-right cursor-pointer hover:bg-slate-100 transition-colors"
                        >
                          <div className="flex items-center justify-end gap-1">
                            <span>CA / Client</span>
                            {sortColumn === "revenue_per_recipient" ? (
                              sortDirection === "asc" ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />
                            ) : <ArrowUpDown className="w-3 h-3 text-slate-300" />}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 font-semibold text-slate-700">
                      {paginatedBatches.map((b) => {
                        const badge = getCategoryBadge(b.category);
                        const hasResults = b.revenue_generated > 0 || b.conversion_rate > 0;
                        const dateFormatted = b.sent_at
                          ? new Date(b.sent_at).toLocaleString("fr-FR", {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                              hour: "2-digit",
                              minute: "2-digit"
                            })
                          : "N/A";

                        return (
                          <tr
                            key={b.batch_id}
                            className={`transition-colors ${
                              hasResults
                                ? "bg-emerald-50/30 border-l-4 border-l-emerald-500 hover:bg-emerald-50/60 font-bold"
                                : "hover:bg-slate-50/80 text-slate-500"
                            }`}
                          >
                            <td className="px-6 py-3.5 whitespace-nowrap text-slate-500 font-medium">
                              {dateFormatted}
                            </td>
                            <td className="px-6 py-3.5 max-w-xs truncate text-slate-900" title={b.subject}>
                              {b.subject}
                            </td>
                            <td className="px-6 py-3.5 whitespace-nowrap">
                              <span className={`px-2.5 py-0.5 rounded-md text-[10px] font-extrabold border ${badge.color}`}>
                                {badge.label}
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-center font-bold text-slate-700">
                              {b.total_sent}
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={b.open_rate > 0 ? "font-bold text-slate-900" : "text-slate-400"}>
                                {b.open_rate}%
                              </span>
                              <span className="text-[10px] text-slate-400 block font-normal">({b.total_opened} ouverts)</span>
                            </td>
                            <td className="px-6 py-3.5 text-center">
                              <span className={`font-black ${b.conversion_rate > 0 ? "text-emerald-600 text-sm" : "text-slate-400"}`}>
                                {b.conversion_rate}%
                              </span>
                              <span className="text-[10px] text-slate-400 block font-normal">({b.total_converted} ach.)</span>
                            </td>
                            <td className="px-6 py-3.5 text-right">
                              <span className={b.revenue_generated > 0 ? "font-black text-emerald-600 text-sm" : "text-slate-400 font-normal"}>
                                {b.revenue_generated.toFixed(2)} DT
                              </span>
                            </td>
                            <td className="px-6 py-3.5 text-right font-bold text-slate-600">
                              {b.revenue_per_recipient > 0 ? `${b.revenue_per_recipient.toFixed(2)} DT` : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination Controls */}
                <div className="px-6 py-4 bg-slate-50/60 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs font-semibold text-slate-600">
                  <div className="flex items-center gap-2">
                    <span>
                      Affichage de <strong>{((currentPage - 1) * rowsPerPage) + 1}</strong> à <strong>{Math.min(currentPage * rowsPerPage, sortedAndFilteredBatches.length)}</strong> sur <strong>{sortedAndFilteredBatches.length}</strong> envois
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 hover:bg-slate-50 transition-all flex items-center gap-1 font-bold shadow-sm"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                      Précédent
                    </button>

                    <span className="px-3 py-1 bg-white border border-slate-200 rounded-xl font-black text-slate-800">
                      {currentPage} / {totalPages}
                    </span>

                    <button
                      onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1.5 bg-white border border-slate-200 rounded-xl text-slate-700 disabled:opacity-40 hover:bg-slate-50 transition-all flex items-center gap-1 font-bold shadow-sm"
                    >
                      Suivant
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
