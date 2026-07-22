"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, Users, Send, BarChart3, Globe, Calendar, Shield } from "lucide-react";

export default function Sidebar() {
  const pathname = usePathname();

  const links = [
    { href: "/", label: "Dashboard", icon: LayoutDashboard },
    { href: "/clients", label: "Clients", icon: Users },
    { href: "/campaigns", label: "Campagnes", icon: Send },
    { href: "/statistiques", label: "Statistiques", icon: BarChart3 },
    { href: "/global", label: "Vue Globale", icon: Globe },
    { href: "/parametres/anniversaire-boutique", label: "Anniversaire Boutique", icon: Calendar },
    { href: "/administration/securite", label: "Sécurité & Fraude", icon: Shield },
  ];

  return (
    <aside className="w-64 bg-white border-r border-[#e5e5e5] flex flex-col h-screen sticky top-0 shrink-0">
      <div className="p-6 border-b border-[#e5e5e5]">
        <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-cyan-500 bg-clip-text text-transparent tracking-tight">
          Retenza AI
        </h1>
        <p className="text-xs text-slate-400 font-medium mt-0.5">Console d'Administration</p>
      </div>
      
      <nav className="flex-1 px-4 py-6 space-y-1.5">
        {links.map((link) => {
          const Icon = link.icon;
          const isActive = pathname === link.href;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-200 group ${
                isActive
                  ? "bg-blue-50 text-blue-600"
                  : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`w-5 h-5 transition-transform duration-200 group-hover:scale-105 ${
                isActive ? "text-blue-600" : "text-slate-400 group-hover:text-slate-600"
              }`} />
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div className="p-4 border-t border-[#e5e5e5] bg-slate-50/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-xs">
            M
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-800">Mon Commerce</p>
            <p className="text-[10px] text-slate-400">Mode Connecté</p>
          </div>
        </div>
      </div>
    </aside>
  );
}
