"use client";

import { useEffect, useState } from "react";
import { Calendar, Store, Loader2, Sparkles, Check, Tag, Percent } from "lucide-react";

interface Commerce {
  id: string;
  label: string;
}

export default function AnniversaireBoutiquePage() {
  const [commerces, setCommerces] = useState<Commerce[]>([]);
  const [selectedCommerce, setSelectedCommerce] = useState<string>("__all__");

  // Anniversary states
  const [shopAnniversaryMode, setShopAnniversaryMode] = useState<"global" | "par_boutique">("global");
  const [shopAnniversaryDate, setShopAnniversaryDate] = useState<string>("");
  const [shopAnniversaryByBoutique, setShopAnniversaryByBoutique] = useState<Record<string, string>>({});
  const [shopAnniversaryDiscountPercent, setShopAnniversaryDiscountPercent] = useState<number>(15);
  const [shopAnniversaryPromoCode, setShopAnniversaryPromoCode] = useState<string>("ANNIVBOUTIQUE");

  const [anniversarySaved, setAnniversarySaved] = useState<boolean>(false);
  const [anniversaryLoading, setAnniversaryLoading] = useState<boolean>(false);
  const [cooldownDays, setCooldownDays] = useState<number>(30);
  const [pageLoading, setPageLoading] = useState<boolean>(true);

  // Load commerces list
  useEffect(() => {
    async function loadCommerces() {
      try {
        const res = await fetch("/api/commerces");
        const data = await res.json();
        setCommerces(Array.isArray(data) ? data : []);
      } catch {
        setCommerces([]);
      }
    }
    loadCommerces();
  }, []);

  // Load settings when selected commerce changes
  useEffect(() => {
    async function loadSettings() {
      setPageLoading(true);
      try {
        const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;
        const res = await fetch(`/api/commerces/settings?commerce_id=${encodeURIComponent(targetId)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (json.status === "success" && json.data) {
          setCooldownDays(json.data.cooldown_days || 30);
          setShopAnniversaryMode(json.data.shop_anniversary_mode || "global");
          setShopAnniversaryDate(json.data.shop_anniversary_date || "");
          setShopAnniversaryByBoutique(json.data.shop_anniversary_by_boutique || {});
          if (json.data.shop_anniversary_discount_percent !== undefined) {
            setShopAnniversaryDiscountPercent(Number(json.data.shop_anniversary_discount_percent) || 15);
          }
          if (json.data.shop_anniversary_promo_code) {
            setShopAnniversaryPromoCode(json.data.shop_anniversary_promo_code);
          }
        }
      } catch {
        /* ignore */
      } finally {
        setPageLoading(false);
      }
    }
    loadSettings();
  }, [selectedCommerce]);

  // Validation helpers
  const handleDiscountChange = (val: string) => {
    const num = parseInt(val, 10);
    if (isNaN(num)) {
      setShopAnniversaryDiscountPercent(1);
    } else {
      const clamped = Math.min(100, Math.max(1, num));
      setShopAnniversaryDiscountPercent(clamped);
    }
  };

  const handlePromoCodeChange = (val: string) => {
    // Only allow alphanumeric characters and hyphens, uppercase
    const cleaned = val.toUpperCase().replace(/[^A-Z0-9\-]/g, "").substring(0, 30);
    setShopAnniversaryPromoCode(cleaned);
  };

  // Save settings
  const handleSave = async () => {
    const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;
    
    // Ensure discount is clamped between 1 and 100
    const finalDiscount = Math.min(100, Math.max(1, shopAnniversaryDiscountPercent || 15));
    // Ensure promo code is not empty
    const finalPromoCode = shopAnniversaryPromoCode.trim() || "ANNIVBOUTIQUE";
    
    setShopAnniversaryDiscountPercent(finalDiscount);
    setShopAnniversaryPromoCode(finalPromoCode);

    setAnniversaryLoading(true);
    try {
      const res = await fetch("/api/commerces/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          commerce_id: targetId,
          cooldown_days: cooldownDays,
          shop_anniversary_mode: shopAnniversaryMode,
          shop_anniversary_date: shopAnniversaryDate,
          shop_anniversary_by_boutique: shopAnniversaryByBoutique,
          shop_anniversary_discount_percent: finalDiscount,
          shop_anniversary_promo_code: finalPromoCode,
        }),
      });
      const json = await res.json();
      if (json.status === "success") {
        setAnniversarySaved(true);
        setTimeout(() => setAnniversarySaved(false), 3000);
      } else {
        alert(json.error || "Erreur lors de l'enregistrement.");
      }
    } catch {
      alert("Erreur réseau lors de l'enregistrement.");
    } finally {
      setAnniversaryLoading(false);
    }
  };

  // Manual trigger (test)
  const handleTriggerTest = async () => {
    const targetId = selectedCommerce === "__all__" ? "commerce_local" : selectedCommerce;
    setAnniversaryLoading(true);
    try {
      const res = await fetch("/api/campaigns/trigger-shop-anniversary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commerce_id: targetId }),
      });
      const json = await res.json();
      if (json.status === "success" || json.status === "skip") {
        const stagesInfo = json.stats
          ? Object.entries(json.stats)
              .map(([k, v]) => `${k} : ${v}`)
              .join("  |  ")
          : json.message;
        alert(`Campagne anniversaire boutique déclenchée.\n\n${stagesInfo}`);
      } else {
        alert(json.error || "Erreur lors du déclenchement.");
      }
    } catch (err: any) {
      alert(`Erreur réseau : ${err.message}`);
    } finally {
      setAnniversaryLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col min-h-screen">
      {/* Page Header */}
      <header className="bg-white border-b border-[#e5e5e5] px-8 py-5 flex items-center justify-between sticky top-0 z-40">
        <div>
          <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Store className="w-5 h-5 text-blue-600" />
            Anniversaire de la boutique
          </h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Configurez les campagnes anniversaire boutique — envoi progressif à J&#8209;7, J&#8209;3 et J&#8209;1
          </p>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 px-8 py-8">
        {pageLoading ? (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="w-6 h-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="w-full flex flex-col gap-6">

            {/* Ultra-compact Timeline Banner */}
            <div className="bg-white border border-[#e5e5e5] rounded-2xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 shadow-sm w-full">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-600 animate-pulse"></span>
                  <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">
                    Séquence Automatique
                  </span>
                </div>
                <div className="h-4 w-[1px] bg-slate-200 hidden md:block"></div>
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg border border-blue-100/60">
                    J‑7 · Annonce
                  </span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-blue-50 text-blue-700 px-3 py-1 rounded-lg border border-blue-100/60">
                    J‑3 · Rappel
                  </span>
                  <span className="text-slate-300">→</span>
                  <span className="bg-blue-600 text-white px-3 py-1 rounded-lg shadow-sm">
                    J‑1 · Dernier rappel
                  </span>
                </div>
              </div>

              <div className="bg-slate-50 border border-slate-200/80 px-3.5 py-1.5 rounded-xl text-xs font-semibold text-slate-600 shrink-0">
                Offre : <strong className="text-blue-600 font-extrabold">{shopAnniversaryDiscountPercent}%</strong> avec le code <strong className="text-slate-800 tracking-wider font-extrabold uppercase">{shopAnniversaryPromoCode || "ANNIVBOUTIQUE"}</strong>
              </div>
            </div>

            {/* Settings card */}
            <div className="bg-white border border-[#e5e5e5] rounded-2xl p-6 shadow-sm flex flex-col gap-6 w-full">
              <div className="flex items-center justify-between border-b border-[#e5e5e5] pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-800">Configuration des paramètres</h3>
                  <p className="text-xs text-slate-400 mt-0.5">Gestion des dates et des avantages de la campagne anniversaire</p>
                </div>
                {anniversarySaved && (
                  <span className="flex items-center gap-1.5 text-xs text-emerald-600 font-bold bg-emerald-50 border border-emerald-200 px-3 py-1.5 rounded-xl">
                    <Check className="w-4 h-4" />
                    Enregistré avec succès
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left Column: Mode & Date */}
                <div className="flex flex-col gap-6">
                  {/* Mode selection */}
                  <div className="flex flex-col gap-3">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      Mode de gestion des dates
                    </span>
                    <div className="flex flex-col gap-3">
                      {[
                        {
                          value: "global" as const,
                          label: "Une seule date pour toute la marque",
                          desc: "Idéal si vous avez une date d'anniversaire de marque commune à toutes vos boutiques.",
                        },
                        {
                          value: "par_boutique" as const,
                          label: "Une date différente par boutique",
                          desc: "Chaque point de vente a sa propre date d'ouverture.",
                        },
                      ].map(({ value, label, desc }) => (
                        <label
                          key={value}
                          className={`flex items-start gap-3 p-4 rounded-xl border cursor-pointer transition-all ${
                            shopAnniversaryMode === value
                              ? "border-blue-500 bg-blue-50/60 ring-1 ring-blue-500"
                              : "border-[#e5e5e5] hover:border-slate-300 hover:bg-slate-50"
                          }`}
                        >
                          <input
                            type="radio"
                            name="shopAnnivMode"
                            value={value}
                            checked={shopAnniversaryMode === value}
                            onChange={() => setShopAnniversaryMode(value)}
                            className="accent-blue-600 mt-0.5 shrink-0"
                          />
                          <div>
                            <p className="text-sm font-semibold text-slate-800">{label}</p>
                            <p className="text-xs text-slate-500 mt-0.5">{desc}</p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Date input(s) */}
                  <div className="flex flex-col gap-3">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                      {shopAnniversaryMode === "global" ? "Date d'anniversaire (format MM-JJ)" : "Dates par boutique (format MM-JJ)"}
                    </span>

                    {shopAnniversaryMode === "global" ? (
                      <div className="flex items-center gap-3">
                        <Calendar className="w-4 h-4 text-slate-400 shrink-0" />
                        <input
                          type="text"
                          placeholder="ex: 03-15  pour le 15 mars"
                          value={shopAnniversaryDate}
                          onChange={(e) => setShopAnniversaryDate(e.target.value)}
                          maxLength={5}
                          className="bg-[#f8fafc] border border-[#e5e5e5] px-4 py-2.5 rounded-xl text-sm font-semibold text-slate-700 outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all w-full"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-col gap-3 max-h-60 overflow-y-auto pr-1">
                        {commerces.length === 0 ? (
                          <p className="text-xs text-slate-400 italic">
                            Aucune boutique chargée — vérifiez la connexion au backend.
                          </p>
                        ) : (
                          commerces.map((c) => (
                            <div key={c.id} className="flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-100 bg-slate-50/50">
                              <span className="text-xs font-semibold text-slate-700 truncate">{c.label}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <Calendar className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <input
                                  type="text"
                                  placeholder="MM-JJ"
                                  value={shopAnniversaryByBoutique[c.id] || ""}
                                  onChange={(e) =>
                                    setShopAnniversaryByBoutique((prev) => ({
                                      ...prev,
                                      [c.id]: e.target.value,
                                    }))
                                  }
                                  maxLength={5}
                                  className="bg-white border border-[#e5e5e5] px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 outline-none hover:border-slate-300 focus:border-blue-600 transition-all w-28 text-center"
                                />
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right Column: Promotional Offer & Actions */}
                <div className="flex flex-col justify-between gap-6 border-t lg:border-t-0 lg:border-l border-[#e5e5e5] pt-6 lg:pt-0 lg:pl-8">
                  {/* Promotional Offer Section */}
                  <div className="flex flex-col gap-4">
                    <div>
                      <span className="text-xs font-bold text-slate-500 uppercase tracking-wider block">
                        Offre Promotionnelle
                      </span>
                      <p className="text-xs text-slate-400 mt-0.5">
                        Cette réduction et ce code promo seront appliqués de façon identique aux 3 relances (J‑7, J‑3, J‑1)
                      </p>
                    </div>

                    <div className="flex flex-col gap-4">
                      {/* Discount percentage input */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <Percent className="w-3.5 h-3.5 text-slate-400" />
                          Réduction (%)
                        </label>
                        <div className="relative">
                          <input
                            type="number"
                            min={1}
                            max={100}
                            value={shopAnniversaryDiscountPercent}
                            onChange={(e) => handleDiscountChange(e.target.value)}
                            className="w-full bg-[#f8fafc] border border-[#e5e5e5] px-4 py-2.5 rounded-xl text-sm font-bold text-slate-800 outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all pr-8"
                          />
                          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-extrabold text-slate-400">
                            %
                          </span>
                        </div>
                      </div>

                      {/* Promo code input */}
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                          <Tag className="w-3.5 h-3.5 text-slate-400" />
                          Code Promo
                        </label>
                        <input
                          type="text"
                          placeholder="ex: ANNIVBOUTIQUE"
                          value={shopAnniversaryPromoCode}
                          onChange={(e) => handlePromoCodeChange(e.target.value)}
                          maxLength={30}
                          className="bg-[#f8fafc] border border-[#e5e5e5] px-4 py-2.5 rounded-xl text-sm font-bold text-slate-800 tracking-wider uppercase outline-none hover:border-slate-300 focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Action buttons */}
                  <div className="flex flex-col gap-3 pt-6 border-t border-[#e5e5e5]">
                    <div className="flex flex-wrap items-center gap-3">
                      <button
                        onClick={handleSave}
                        disabled={anniversaryLoading}
                        className="flex-1 bg-slate-800 hover:bg-slate-900 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {anniversaryLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Calendar className="w-4 h-4" />
                        )}
                        Enregistrer les paramètres
                      </button>

                      <button
                        onClick={handleTriggerTest}
                        disabled={anniversaryLoading}
                        title="Déclencher manuellement les paliers J‑7/J‑3/J‑1 sans attendre le scheduler (test)"
                        className="bg-amber-500 hover:bg-amber-600 text-white px-5 py-3 rounded-xl text-sm font-bold shadow-sm transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2 cursor-pointer"
                      >
                        {anniversaryLoading ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Sparkles className="w-4 h-4" />
                        )}
                        Tester maintenant
                      </button>
                    </div>

                    <p className="text-[11px] text-slate-400 text-center">
                      Le bouton &quot;Tester maintenant&quot; déclenche immédiatement les campagnes correspondant à la date du jour.
                    </p>
                  </div>
                </div>
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}

