import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/app-shell";
import { EventEntitlementsProvider } from "@/components/event-entitlements";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sponsor-proof.vercel.app";
const appEnvironment = process.env.NEXT_PUBLIC_APP_ENV?.toLowerCase();
const isTestEnvironment =
  process.env.NODE_ENV !== "production" ||
  process.env.VERCEL_ENV === "preview" ||
  process.env.NEXT_PUBLIC_SUPABASE_URL?.includes("nwlapyarlpaztpdouyxm") === true ||
  appEnvironment === "test" ||
  appEnvironment === "demo";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Splow",
  title: { default: "Splow – Sponsoring einfach im Blick", template: "%s | Splow" },
  description: "Verwalte Sponsoren, Vereinbarungen, Leistungen, Aufgaben und Nachweise für deine Veranstaltungen an einem Ort.",
  keywords: ["Sponsoring verwalten", "Sponsorenmanagement", "Event-Sponsoring", "Sponsoring-Nachweise", "Festival organisieren"],
  icons: { icon: "/splow-icon.svg" },
  openGraph: {
    type: "website",
    locale: "de_DE",
    siteName: "Splow",
    title: "Splow – Sponsoring einfach im Blick",
    description: "Sponsoren, Vereinbarungen, Leistungen und Nachweise für Veranstaltungen zentral verwalten.",
    url: "/",
  },
  twitter: {
    card: "summary",
    title: "Splow – Sponsoring einfach im Blick",
    description: "Sponsoren, Vereinbarungen, Leistungen und Nachweise für Veranstaltungen zentral verwalten.",
  },
  robots: { index: false, follow: true, googleBot: { index: false, follow: true } },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="de">
      <body>
        {isTestEnvironment && (
          <div
            role="status"
            aria-label="Testumgebung"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 10000,
              display: "flex",
              minHeight: 40,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              padding: "6px 16px",
              background: "#fff0e8",
              borderBottom: "1px solid #f0b59d",
              color: "#9f351f",
              fontSize: 13,
              lineHeight: 1.3,
            }}
          >
            <strong style={{ letterSpacing: ".08em" }}>TESTUMGEBUNG</strong>
            <span style={{ color: "#754b40" }}>Du arbeitest in der Testversion.</span>
          </div>
        )}
        <EventEntitlementsProvider><AppShell>{children}</AppShell></EventEntitlementsProvider>
      </body>
    </html>
  );
}
