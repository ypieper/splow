"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Icon, SplowLogo } from "@/components/ui";
import { MobileMenu, adminNavigation, navigation } from "@/components/mobile-menu";
import { LogoutButton } from "@/components/logout-button";
import { OrganizerAccountMenu } from "@/components/organizer-account-menu";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { clearLegacyBrowserData } from "@/lib/clear-legacy-browser-data";

type UserDisplay = { name: string; initials: string };

const defaultUserDisplay: UserDisplay = { name: "Benutzer", initials: "SP" };

function userDisplayName(firstName: string, lastName: string, email: string) {
  const fullName = [firstName.trim(), lastName.trim()].filter(Boolean).join(" ");
  return fullName || email || "Benutzer";
}

function userInitials(firstName: string, lastName: string, email: string) {
  const initials = [firstName.trim(), lastName.trim()].filter(Boolean).map((part) => part[0]).join("").slice(0, 2);
  return (initials || email.slice(0, 2) || "SP").toLocaleUpperCase("de-DE");
}

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const [userDisplay, setUserDisplay] = useState(defaultUserDisplay);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [isSalesPartner, setIsSalesPartner] = useState(false);
  const adminNavigationOnly = isPlatformAdmin || path.startsWith("/admin");

  useEffect(() => {
    let active = true;
    clearLegacyBrowserData();
    const loadUser = () => {
      if (!isSupabaseConfigured) return;
      void createClient().auth.getUser().then(({ data }) => {
        if (!active) return;
        if (!data.user) return;
        const firstName = String(data.user.user_metadata?.first_name ?? "");
        const lastName = String(data.user.user_metadata?.last_name ?? "");
        const email = data.user.email ?? "";
        setUserDisplay((current) => ({ ...current, name: userDisplayName(firstName, lastName, email), initials: userInitials(firstName, lastName, email) }));
      }).catch(() => undefined);
    };

    loadUser();
    if (isSupabaseConfigured) {
      void fetch("/api/admin/access").then((response) => response.ok ? response.json() : null)
        .then((result) => { if (active) setIsPlatformAdmin(Boolean(result?.isAdmin)); })
        .catch(() => undefined);
      void fetch("/api/partner", { cache: "no-store" }).then((response) => { if (active) setIsSalesPartner(response.ok); }).catch(() => undefined);
    }
    window.addEventListener("sponsorproof:user-account-updated", loadUser);

    return () => {
      active = false;
      window.removeEventListener("sponsorproof:user-account-updated", loadUser);
    };
  }, [path]);

  useEffect(() => {
    const title = path === "/" ? "Sponsoringmanagement für Veranstalter"
      : path === "/dashboard" ? "Übersicht"
      : path === "/events" ? "Events"
      : path.startsWith("/events/") ? "Eventdetails"
      : path === "/aufgaben" ? "Aufgaben"
      : path === "/bausteine" ? "Vertragsbausteine"
      : path === "/sponsors" ? "Sponsoren"
      : path.startsWith("/sponsors/") ? "Sponsorprofil"
      : path.startsWith("/einstellungen") ? "Einstellungen"
      : path === "/event-modus" ? "Nachweise vor Ort"
      : path.startsWith("/login") ? "Anmelden"
      : path === "/landing" ? "Sponsoringmanagement für Veranstalter"
      : path === "/demo" ? "Produktdemo"
      : path === "/passwort-zuruecksetzen" ? "Passwort zurücksetzen"
      : path === "/agb" ? "Allgemeine Geschäftsbedingungen"
      : path === "/impressum" ? "Impressum"
      : path === "/datenschutz" ? "Datenschutzerklärung"
      : path === "/kontakt" ? "Kontakt"
      : path.startsWith("/team/join") ? "Team beitreten"
      : path === "/onboarding" ? "Zugang einrichten"
      : path === "/admin/users" ? "Benutzer"
      : path === "/admin/organizations" ? "Veranstalterbereiche"
      : path === "/admin/codes" ? "Freischaltcodes"
      : path === "/admin/enterprise" ? "Enterprise"
      : path === "/admin/contacts" ? "Kontaktanfragen"
      : path === "/admin/partners" ? "Vertriebspartner"
      : path === "/admin/commissions" ? "Provisionen"
      : path === "/admin/commission-rules" ? "Provisionsregeln"
      : path.startsWith("/admin") ? "Administration"
      : "Sponsoring verwalten";
    document.title = `${title} | Splow`;
  }, [path]);

  if (path.startsWith("/login") || path === "/admin/login" || path === "/onboarding" || path === "/partner" || path === "/sponsor" || path.startsWith("/sponsor/")) return <>{children}</>;
  if (["/", "/demo", "/agb", "/impressum", "/datenschutz", "/kontakt", "/landing"].includes(path)) return <>{children}</>;
  const isMobileMode = path === "/event-modus";
  if (isMobileMode) return <>{children}</>;
  const currentOrganizerPage = navigation.find((item) => path === item.href || path.startsWith(`${item.href}/`))?.label ?? "Übersicht";
  return <div className={`app-frame${adminNavigationOnly ? "" : " organizer-app-frame"}`}>
    {adminNavigationOnly && <aside className="sidebar">
      <Link href="/admin/users" className="brand" aria-label="Splow Administration"><SplowLogo /></Link>
      <div className="nav-label">Plattform</div>
      <nav className="nav-list">{adminNavigation.map((item) => {
        const active = path === item.href || (item.href !== "/admin/users" && path.startsWith(`${item.href}/`));
        return <Link href={item.href} key={item.label} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}><span className="nav-icon"><Icon name={item.icon} size={17}/></span>{item.label}</Link>;
      })}</nav>
    </aside>}
    <div className={`main-area ${path === "/dashboard" ? "dashboard-main-area" : ""}`}>
      {adminNavigationOnly ? <header className="topbar"><MobileMenu isPlatformAdmin/><div className="crumb">Plattform <span style={{padding:"0 7px",color:"#c1c7ce"}}>/</span> <b>{adminNavigation.find((item) => item.href === path)?.label ?? "Benutzer"}</b></div><div className="top-actions"><LogoutButton/></div></header> : <header className="topbar organizer-topbar">
        <div className="organizer-compact-navigation"><MobileMenu isSalesPartner={isSalesPartner}/><span className="organizer-current-page">{currentOrganizerPage}</span></div>
        <Link href="/dashboard" className="brand organizer-topbar-brand" aria-label="Splow Übersicht öffnen"><SplowLogo /></Link>
        <nav className="organizer-top-navigation" aria-label="Hauptnavigation">{[...navigation, ...(isSalesPartner ? [{ label: "Vertriebspartner", href: "/partner", icon: "spark" }] : [])].map((item) => {
          const route = item.href.split("?")[0];
          const active = path === route || (route !== "/" && path.startsWith(`${route}/`));
          return <Link href={item.href} key={item.label} className={`organizer-top-navigation-link${active ? " active" : ""}`} aria-current={active ? "page" : undefined}>{item.label}</Link>;
        })}</nav>
        <div className="top-actions"><Link className="btn top-event-mode-link" href="/event-modus" aria-label="Event-Modus öffnen" title="Event-Modus öffnen"><Icon name="camera" size={15}/><span>Event-Modus öffnen</span></Link><OrganizerAccountMenu initials={userDisplay.initials} name={userDisplay.name}/></div>
      </header>}
      {children}
      <footer className="app-footer"><span>© {new Date().getFullYear()} Splow</span><nav aria-label="Rechtliche Hinweise"><Link href="/agb">AGB</Link><Link href="/impressum">Impressum</Link><Link href="/datenschutz">Datenschutz</Link><Link href="/kontakt">Kontakt</Link></nav></footer>
    </div>
  </div>;
}
