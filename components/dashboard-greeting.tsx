"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function DashboardGreeting() {
  const [firstName, setFirstName] = useState("Benutzer");

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let active = true;
    const loadFirstName = () => {
      void createClient().auth.getUser().then(({ data }) => {
        if (!active || !data.user) return;
        const name = String(data.user.user_metadata?.first_name ?? "").trim();
        setFirstName(name || "Benutzer");
      }).catch(() => undefined);
    };
    loadFirstName();
    window.addEventListener("sponsorproof:user-account-updated", loadFirstName);
    return () => {
      active = false;
      window.removeEventListener("sponsorproof:user-account-updated", loadFirstName);
    };
  }, []);

  return <div className="page-heading dashboard-greeting"><div><div className="eyebrow">DASHBOARD</div><h1>Guten Tag, {firstName}</h1><p className="subtitle">Dein aktueller Stand und die nächsten Schritte auf einen Blick.</p></div></div>;
}
