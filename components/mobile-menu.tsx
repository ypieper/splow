"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon, SplowLogo } from "@/components/ui";

export const navigation = [
  { label: "Dashboard", href: "/dashboard", icon: "grid" },
  { label: "Events", href: "/events", icon: "calendar" },
  { label: "Sponsoren", href: "/sponsors", icon: "users" },
  { label: "Aufgaben", href: "/aufgaben", icon: "check" },
  { label: "Vertragsbausteine", href: "/bausteine", icon: "layers" },
  { label: "Einstellungen", href: "/einstellungen", icon: "settings" },
];

export const adminNavigation = [
  { label: "Veranstalterbereiche", href: "/admin/organizations", icon: "users" },
  { label: "Benutzer", href: "/admin/users", icon: "users" },
  { label: "Transaktionen", href: "/admin/transactions", icon: "file" },
  { label: "Freischaltcodes", href: "/admin/codes", icon: "file" },
  { label: "Enterprise", href: "/admin/enterprise", icon: "layers" },
  { label: "Kontaktanfragen", href: "/admin/contacts", icon: "spark" },
  { label: "Vertriebspartner", href: "/admin/partners", icon: "users" },
  { label: "Provisionen", href: "/admin/commissions", icon: "file" },
  { label: "Provisionsregeln", href: "/admin/commission-rules", icon: "settings" },
];

export function MobileMenu({ isPlatformAdmin = false, isSalesPartner = false }: { isPlatformAdmin?: boolean; isSalesPartner?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        toggleRef.current?.focus();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("a[href], button:not([disabled])");
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => setOpen(false), [path]);

  return <>
    <button
      ref={toggleRef}
      className="icon-button menu-toggle"
      type="button"
      aria-label={open ? "Menü schließen" : "Menü öffnen"}
      aria-expanded={open}
      aria-controls="mobile-primary-navigation"
      onClick={() => setOpen((value) => !value)}
    ><Icon name="menu" size={18}/></button>
    {open && createPortal(<dialog className="mobile-menu-layer" aria-label="Hauptmenü" ref={dialogRef} onCancel={(event) => { event.preventDefault(); setOpen(false); toggleRef.current?.focus(); }}>
      <div className="mobile-menu-backdrop" aria-hidden="true" onClick={() => { setOpen(false); toggleRef.current?.focus(); }}/>
      <div className="mobile-drawer" id="mobile-primary-navigation">
        <div className="mobile-drawer-head">
          <Link href={isPlatformAdmin ? "/admin/users" : "/dashboard"} className="brand" aria-label={isPlatformAdmin ? "Splow Administration" : "Splow Dashboard öffnen"}><SplowLogo /></Link>
          <button ref={closeRef} className="icon-button" type="button" aria-label="Menü schließen" onClick={() => { setOpen(false); toggleRef.current?.focus(); }}><Icon name="close" size={17}/></button>
        </div>
        <div className="nav-label">{isPlatformAdmin ? "Plattform" : "Veranstalterbereich"}</div>
        <nav className="nav-list" aria-label="Hauptnavigation">{isPlatformAdmin ? adminNavigation.map((item) => {
          const active = path === item.href || (item.href !== "/admin/users" && path.startsWith(`${item.href}/`));
          return <Link href={item.href} key={item.label} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><span className="nav-icon"><Icon name={item.icon} size={17}/></span>{item.label}</Link>;
        }) : [...navigation, ...(isSalesPartner ? [{ label: "Vertriebspartner", href: "/partner", icon: "spark" }] : [])].map((item) => {
          const route = item.href.split("?")[0];
          const active = path === route || (route !== "/" && path.startsWith(`${route}/`));
          return <Link href={item.href} key={item.label} className={`nav-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined} onClick={() => setOpen(false)}><span className="nav-icon"><Icon name={item.icon} size={17}/></span>{item.label}</Link>;
        })}</nav>
      </div>
    </dialog>, document.body)}
  </>;
}
