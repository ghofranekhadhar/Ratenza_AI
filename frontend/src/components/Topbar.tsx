"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  X,
  Crown,
  Flame,
  ShieldAlert,
  MessageSquare,
  Unlock,
  CheckCircle,
  Eye,
  Loader2
} from "lucide-react";

interface ClientData {
  client_db_id: string;
  nom: string;
  email: string;
  commerce_id: string;
  segment_gmm?: string;
  churn_score?: number;
  churn_risk_label?: string;
  influence_score?: number;
  score_global_sa?: number;
}

interface BlockedClient {
  nom: string;
  email: string;
  commerce_id: string;
  block_reason: string;
  blocked_at: string;
}

interface ChatbotMessage {
  sender: "user" | "bot" | "agent";
  text: string;
  timestamp: string;
}

export default function Topbar() {
  const router = useRouter();
  const [selectedCommerce, setSelectedCommerce] = useState<string>("commerce_local");

  // Notification lists
  const [churnAlerts, setChurnAlerts] = useState<ClientData[]>([]);
  const [ambassadorAlerts, setAmbassadorAlerts] = useState<ClientData[]>([]);
  const [blockedAlerts, setBlockedAlerts] = useState<BlockedClient[]>([]);

  // Open/Close states
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [activeTab, setActiveTab] = useState<"churn" | "ambassador" | "chatbot">("churn");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Read state persistence in localStorage
  const [viewedChurnIds, setViewedChurnIds] = useState<string[]>([]);
  const [viewedAmbassadorIds, setViewedAmbassadorIds] = useState<string[]>([]);

  // Chatbot conversation modal states
  const [isChatbotModalOpen, setIsChatbotModalOpen] = useState<boolean>(false);
  const [activeChatbotClient, setActiveChatbotClient] = useState<{ email: string; nom: string; commerce_id: string; reason: string } | null>(null);
  const [chatbotConversation, setChatbotConversation] = useState<ChatbotMessage[]>([]);
  const [chatbotLoading, setChatbotLoading] = useState<boolean>(false);

  // Load viewed state
  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedChurn = localStorage.getItem("viewedAlertIds");
      const savedAmb = localStorage.getItem("viewedAmbassadorIds");
      const savedComm = localStorage.getItem("ratenza_commerce_id");
      if (savedChurn) setViewedChurnIds(JSON.parse(savedChurn));
      if (savedAmb) setViewedAmbassadorIds(JSON.parse(savedAmb));
      if (savedComm && savedComm !== "__all__") setSelectedCommerce(savedComm);
    }
  }, []);

  // Poll notifications every 10 seconds
  useEffect(() => {
    async function fetchAlerts() {
      try {
        const commerceId = localStorage.getItem("ratenza_commerce_id") || "commerce_local";
        const targetId = commerceId === "__all__" ? "commerce_local" : commerceId;

        // 1. Fetch chatbot blocks
        const botRes = await fetch(`/api/chatbot/blocks?commerce_id=${encodeURIComponent(targetId)}`);
        const botJson = await botRes.json();
        if (botJson.status === "success") {
          setBlockedAlerts(botJson.data || []);
        }

        // 2. Fetch clients data to compute churn/ambassador alerts
        let merged: ClientData[] = [];
        if (commerceId === "__all__") {
          const shopsRes = await fetch("/api/commerces");
          const shops = await shopsRes.json();
          const allPromises = shops.map((c: any) =>
            fetch(`/api/data?commerce_id=${encodeURIComponent(c.id)}`).then((r) => r.json())
          );
          const results = await Promise.all(allPromises);
          merged = results.flat().filter((d: any) => !d.error);
        } else {
          const res = await fetch(`/api/data?commerce_id=${encodeURIComponent(commerceId)}`);
          const data = await res.json();
          merged = Array.isArray(data) ? data : [];
        }

        // Compute churn alerts (churn_score >= 0.55)
        const churns = merged.filter((c) => (c.churn_score || 0) >= 0.55);
        churns.sort((a, b) => (b.churn_score || 0) - (a.churn_score || 0));
        setChurnAlerts(churns);

        // Compute ambassador alerts (influence_score >= 80)
        const ambassadors = merged.filter((c) => {
          const score = c.influence_score !== undefined
            ? c.influence_score
            : Math.round(((c.score_global_sa || 0) * 0.7 + (1.0 - (c.churn_score || 0)) * 0.3) * 100);
          return score >= 80;
        });
        ambassadors.sort((a, b) => {
          const scoreA = a.influence_score !== undefined ? a.influence_score : 0;
          const scoreB = b.influence_score !== undefined ? b.influence_score : 0;
          return scoreB - scoreA;
        });
        setAmbassadorAlerts(ambassadors);

      } catch (err) {
        console.error("Failed to load notifications:", err);
      }
    }

    fetchAlerts();
    const interval = setInterval(fetchAlerts, 10000);
    return () => clearInterval(interval);
  }, [selectedCommerce]);

  // Click outside close
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Compute unread counts
  const unreadChurnCount = churnAlerts.filter(a => !viewedChurnIds.includes(a.client_db_id || a.email)).length;
  const unreadAmbCount = ambassadorAlerts.filter(a => !viewedAmbassadorIds.includes(a.client_db_id || a.email)).length;
  const blockedCount = blockedAlerts.length;

  const markChurnAsRead = (id: string) => {
    if (!viewedChurnIds.includes(id)) {
      const updated = [...viewedChurnIds, id];
      setViewedChurnIds(updated);
      localStorage.setItem("viewedAlertIds", JSON.stringify(updated));
    }
  };

  const markAmbAsRead = (id: string) => {
    if (!viewedAmbassadorIds.includes(id)) {
      const updated = [...viewedAmbassadorIds, id];
      setViewedAmbassadorIds(updated);
      localStorage.setItem("viewedAmbassadorIds", JSON.stringify(updated));
    }
  };

  const handleAlertClick = (client: ClientData, type: "churn" | "ambassador") => {
    const id = client.client_db_id || client.email;
    if (type === "churn") markChurnAsRead(id);
    else markAmbAsRead(id);
    setIsOpen(false);

    // Redirect to clients page and open drawer via query params
    router.push(`/clients?openEmail=${encodeURIComponent(client.email)}`);
  };

  // Chatbot blocks unblocking action
  const handleUnblock = async (email: string, commerceId: string) => {
    if (!confirm(`Voulez-vous vraiment débloquer l'accès pour le client ${email} ?`)) {
      return;
    }

    try {
      const res = await fetch("/api/chatbot/unblock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, commerce_id: commerceId })
      });
      const data = await res.json();
      if (data.status === "success") {
        alert(data.message || "Client débloqué avec succès !");
        setBlockedAlerts(prev => prev.filter(c => c.email !== email));
        setIsChatbotModalOpen(false);
      } else {
        alert(data.error || "Erreur de déblocage.");
      }
    } catch (err) {
      console.error(err);
      alert("Erreur de connexion.");
    }
  };

  // View chatbot conversation in details modal
  const handleViewConversation = async (email: string, nom: string, commerceId: string, reason: string) => {
    setIsChatbotModalOpen(true);
    setActiveChatbotClient({ email, nom, commerce_id: commerceId, reason });
    setChatbotLoading(true);
    setChatbotConversation([]);

    try {
      const res = await fetch(`/api/chatbot/conversation/${encodeURIComponent(email)}?commerce_id=${encodeURIComponent(commerceId)}`);
      const data = await res.json();
      if (data.status === "success") {
        setChatbotConversation(data.data?.history || []);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setChatbotLoading(false);
    }
  };

  return (
    <header className="bg-white border-b border-[#e5e5e5] h-16 px-8 flex items-center justify-end shrink-0 relative z-50">
      <div className="relative" ref={dropdownRef}>
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-10 h-10 rounded-xl hover:bg-slate-50 flex items-center justify-center text-slate-500 hover:text-slate-800 transition-colors relative border border-slate-100 shadow-sm cursor-pointer"
        >
          <Bell className="w-5 h-5" />

          {/* Badges container */}
          <div className="absolute -top-1.5 -right-1.5 flex gap-0.5">
            {unreadChurnCount > 0 && (
              <span className="w-4 h-4 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border border-white animate-pulse">
                {unreadChurnCount}
              </span>
            )}
            {unreadAmbCount > 0 && (
              <span className="w-4 h-4 bg-amber-500 text-white text-[8px] font-black rounded-full flex items-center justify-center border border-white">
                {unreadAmbCount}
              </span>
            )}
            {blockedCount > 0 && (
              <span className="w-4 h-4 bg-purple-600 text-white text-[8px] font-black rounded-full flex items-center justify-center border border-white">
                {blockedCount}
              </span>
            )}
          </div>
        </button>

        {/* Dropdown Panel */}
        {isOpen && (
          <div className="absolute right-0 top-12 w-[380px] bg-white border border-[#e5e5e5] rounded-2xl shadow-xl p-4 flex flex-col gap-3 animate-fade-in max-h-[500px] z-[60]">
            {/* Tabs */}
            <div className="flex gap-1.5 border-b border-slate-100 pb-3">
              <button
                onClick={() => setActiveTab("churn")}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  activeTab === "churn"
                    ? "bg-rose-500 text-white"
                    : "bg-rose-50 text-rose-600 hover:bg-rose-100"
                }`}
              >
                <span>🔴 Churn</span>
                {unreadChurnCount > 0 && <span className="bg-white/30 px-1.5 rounded-full text-[9px]">{unreadChurnCount}</span>}
              </button>

              <button
                onClick={() => setActiveTab("ambassador")}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  activeTab === "ambassador"
                    ? "bg-amber-500 text-white"
                    : "bg-amber-50 text-amber-700 hover:bg-amber-100"
                }`}
              >
                <span>👑 Ambass.</span>
                {unreadAmbCount > 0 && <span className="bg-white/30 px-1.5 rounded-full text-[9px]">{unreadAmbCount}</span>}
              </button>

              <button
                onClick={() => setActiveTab("chatbot")}
                className={`flex-1 py-1.5 rounded-lg text-[10px] font-extrabold flex items-center justify-center gap-1 transition-all cursor-pointer ${
                  activeTab === "chatbot"
                    ? "bg-purple-600 text-white"
                    : "bg-purple-50 text-purple-700 hover:bg-purple-100"
                }`}
              >
                <span>🚨 SAV</span>
                {blockedCount > 0 && <span className="bg-white/30 px-1.5 rounded-full text-[9px]">{blockedCount}</span>}
              </button>
            </div>

            {/* List Contents */}
            <div className="flex-1 overflow-y-auto max-h-[350px] space-y-2">
              {/* CHURN TAB */}
              {activeTab === "churn" && (
                <>
                  {churnAlerts.length === 0 ? (
                    <div className="text-center py-8 text-xs font-bold text-slate-400">Aucune alerte churn active.</div>
                  ) : (
                    churnAlerts.map((client) => {
                      const id = client.client_db_id || client.email;
                      const isRead = viewedChurnIds.includes(id);
                      const isCritical = (client.churn_score || 0) >= 0.75;
                      return (
                        <div
                          key={id}
                          onClick={() => handleAlertClick(client, "churn")}
                          className={`p-2.5 rounded-xl border text-xs flex justify-between items-center transition-all cursor-pointer ${
                            isRead
                              ? "bg-white border-slate-100 opacity-60"
                              : isCritical
                              ? "bg-rose-50/50 border-rose-200 hover:bg-rose-50"
                              : "bg-slate-50 border-slate-200/50 hover:bg-slate-100"
                          }`}
                        >
                          <div className="flex flex-col gap-0.5 max-w-[70%]">
                            <span className="font-bold text-slate-800 truncate">{client.nom}</span>
                            <span className="text-[10px] text-slate-400 truncate">{client.email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className={`font-black px-2 py-0.5 rounded-full text-[9px] ${
                              isCritical ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-700"
                            }`}>
                              {((client.churn_score || 0) * 100).toFixed(0)}%
                            </span>
                            <div className="w-6 h-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                              {isRead ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Eye className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {/* AMBASSADOR TAB */}
              {activeTab === "ambassador" && (
                <>
                  {ambassadorAlerts.length === 0 ? (
                    <div className="text-center py-8 text-xs font-bold text-slate-400">Aucun ambassadeur détecté.</div>
                  ) : (
                    ambassadorAlerts.map((client) => {
                      const id = client.client_db_id || client.email;
                      const isRead = viewedAmbassadorIds.includes(id);
                      const influence = client.influence_score !== undefined
                        ? client.influence_score
                        : Math.round(((client.score_global_sa || 0) * 0.7 + (1.0 - (client.churn_score || 0)) * 0.3) * 100);

                      return (
                        <div
                          key={id}
                          onClick={() => handleAlertClick(client, "ambassador")}
                          className={`p-2.5 rounded-xl border text-xs flex justify-between items-center transition-all cursor-pointer ${
                            isRead
                              ? "bg-white border-slate-100 opacity-60"
                              : "bg-amber-50/30 border-amber-200 hover:bg-amber-50"
                          }`}
                        >
                          <div className="flex flex-col gap-0.5 max-w-[70%]">
                            <span className="font-bold text-slate-800 truncate">👑 {client.nom}</span>
                            <span className="text-[10px] text-slate-400 truncate">{client.email}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="bg-amber-100 text-amber-700 font-black px-2 py-0.5 rounded-full text-[9px]">
                              {influence}%
                            </span>
                            <div className="w-6 h-6 rounded bg-white border border-slate-200 flex items-center justify-center text-slate-400">
                              {isRead ? <CheckCircle className="w-3.5 h-3.5 text-emerald-500" /> : <Eye className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}

              {/* CHATBOT TAB */}
              {activeTab === "chatbot" && (
                <>
                  {blockedAlerts.length === 0 ? (
                    <div className="text-center py-8 text-xs font-bold text-slate-400">Aucun client bloqué SAV.</div>
                  ) : (
                    blockedAlerts.map((client) => (
                      <div
                        key={client.email}
                        className="p-3 bg-slate-50 border border-slate-200 rounded-xl text-xs flex flex-col gap-2 shadow-sm"
                      >
                        <div className="flex justify-between items-start">
                          <div className="max-w-[70%]">
                            <span className="font-extrabold text-slate-800 truncate block">👤 {client.nom || "Client"}</span>
                            <span className="text-[10px] text-slate-400 font-medium truncate block">{client.email}</span>
                          </div>
                          <span className="bg-rose-100 border border-rose-200 text-rose-700 font-extrabold px-1.5 py-0.5 rounded text-[8px] flex-shrink-0 animate-pulse">
                            🚨 BLOQUÉ
                          </span>
                        </div>
                        <div className="bg-white border border-slate-100 p-2 rounded text-[10px] text-slate-500 leading-normal font-semibold">
                          <strong>Motif:</strong> {client.block_reason || "Warnings multiples"}
                        </div>
                        <div className="flex gap-1.5 mt-1">
                          <button
                            onClick={() => handleViewConversation(client.email, client.nom, client.commerce_id, client.block_reason)}
                            className="flex-1 py-1.5 rounded-lg bg-indigo-50 border border-indigo-100 text-indigo-700 text-[10px] font-bold hover:bg-indigo-100 transition-all flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <MessageSquare className="w-3 h-3" /> Discuss.
                          </button>
                          <button
                            onClick={() => handleUnblock(client.email, client.commerce_id)}
                            className="py-1.5 px-2.5 rounded-lg bg-emerald-600 text-white text-[10px] font-bold hover:bg-emerald-700 transition-all flex items-center justify-center gap-1 cursor-pointer"
                          >
                            <Unlock className="w-3 h-3" /> Débloquer
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chatbot conversation History Modal */}
      {isChatbotModalOpen && activeChatbotClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
          <div className="bg-white border border-[#e5e5e5] rounded-2xl w-[500px] max-w-full p-6 shadow-2xl flex flex-col gap-4 max-h-[85vh]">
            <div className="flex justify-between items-center pb-3 border-b border-slate-100">
              <div>
                <h3 className="font-extrabold text-slate-800 text-base">Discussion de {activeChatbotClient.nom}</h3>
                <p className="text-[10px] text-slate-400 font-bold mt-0.5">{activeChatbotClient.email} | Boutique: {activeChatbotClient.commerce_id}</p>
              </div>
              <button
                onClick={() => setIsChatbotModalOpen(false)}
                className="w-8 h-8 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="bg-red-50 border border-red-100 rounded-xl p-3 text-[11px] text-red-800 font-semibold leading-normal">
              ⚠️ <strong>Raison du blocage :</strong> {activeChatbotClient.reason}
            </div>

            {/* Conversation Area */}
            <div className="flex-1 overflow-y-auto bg-slate-50 border border-slate-100 rounded-xl p-4 space-y-3 min-h-[250px] max-h-[400px]">
              {chatbotLoading ? (
                <div className="h-full flex flex-col items-center justify-center py-20 text-slate-400">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="text-[10px] font-bold mt-2">Chargement de l'historique...</span>
                </div>
              ) : chatbotConversation.length === 0 ? (
                <div className="text-center py-20 text-xs font-bold text-slate-400">Aucun message dans l'historique.</div>
              ) : (
                chatbotConversation.map((msg, idx) => {
                  const isUser = msg.sender === "user";
                  return (
                    <div
                      key={idx}
                      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                    >
                      <div className={`p-3 rounded-xl max-w-[85%] text-xs shadow-sm font-medium ${
                        isUser
                          ? "bg-blue-600 text-white rounded-tr-none"
                          : "bg-white text-slate-800 border border-slate-100 rounded-tl-none"
                      }`}>
                        <p className="leading-relaxed">{msg.text}</p>
                        <span className={`text-[8px] font-bold block text-right mt-1.5 ${
                          isUser ? "text-blue-200" : "text-slate-400"
                        }`}>
                          {msg.timestamp ? new Date(msg.timestamp).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="flex gap-3 pt-3 border-t border-slate-100 shrink-0">
              <button
                onClick={() => setIsChatbotModalOpen(false)}
                className="flex-1 border border-slate-200 hover:bg-slate-50 text-slate-600 font-extrabold text-xs py-2.5 rounded-lg transition-all"
              >
                Fermer
              </button>
              <button
                onClick={() => handleUnblock(activeChatbotClient.email, activeChatbotClient.commerce_id)}
                className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white font-extrabold text-xs py-2.5 rounded-lg shadow-sm transition-all"
              >
                🔓 Débloquer le Client
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
