# Event-Produktpakete

## Katalog und Berechtigungen

Die Migration `20261101000000_event_product_tiers.sql` erweitert `event_plans` zum zentralen Produktkatalog. Paketpreis, Kontingent und Feature-Flags liegen dort; UI-Bezeichnungen sind in `lib/event-plan-labels.ts` und `components/event-entitlements.tsx` definiert.

| Paket | Einmalpreis pro Event | Inklusive Sponsoren | Zusätzliche Funktionen |
| --- | ---: | ---: | --- |
| Starter | 49 € | 3 | Sponsorenverwaltung, manuelle Leistungen, Vertragsupload, internes Aufgabenmanagement, Standardreporting |
| Professional | 99 € | 3 | Leistungsbibliothek, automatische Vertragsgenerierung, Sponsorportal mit Aufgaben und Nachweisen |
| Business | 149 € | 3 | Erweiterte Auswertungen, Reports-Reiter und Abschlussreports |

Jedes Event hat eine eigene aktive Entitlement-Zeile. Die kostenlose Variante und die bestehenden Event-Erstellungsregeln bleiben unangetastet. Die früheren Paketzeilen und Codes bleiben in der Migration kompatibel; neue Buchungen bieten ausschließlich die drei neuen Pakete an.

## Sponsorenpreise und Paketwechsel

Die ersten drei Sponsorenplätze sind enthalten. Weitere Plätze werden einmalig und progressiv berechnet: Plätze 4–10 kosten je 6 €, 11–20 je 4 €, ab Platz 21 je 3 €. Die Preisfunktion `sponsor_slot_price_cents` wird serverseitig beim Reservieren der Stripe-Zahlung ausgeführt. Die UI-Funktion in `lib/event-pricing.ts` zeigt dieselbe Staffelung an.

Ein Upgrade kostet die Preisdifferenz zum Zielpaket plus 20 €. `reserve_event_product_payment` prüft Eventmitgliedschaft, Paket, Preis, Kontingent und offene Zahlung in einer Event-Zeilensperre. Der Webhook und die Bestätigungsroute aktivieren ein Paket erst nach bezahlter Stripe-Checkout-Session. Wiederholte Bestätigungen sind idempotent; fehlgeschlagene oder abgelaufene Zahlungen schalten nichts frei.

`add_sponsor_to_event` prüft das aktuelle Kontingent erneut und sperrt das Event während der Änderung. So können gleichzeitige Requests keine Plätze überbuchen.

## Durchsetzung pro Event

`event_feature_enabled(event_id, feature)` ist der gemeinsame serverseitige Berechtigungscheck. Die Event-ID ist Bestandteil aller Berechtigungsprüfungen, da eine Organisation verschiedene Paketstufen für verschiedene Events buchen kann.

Die Migration ergänzt Event-Feature-Prüfungen in RLS für Verträge, Leistungen, Aufgaben, Nachweise, Vertragsdokumente, Reportmetriken und Abschlussreport-Status. Vertrags- und Leistungswrites erhalten zusätzlich Trigger-Prüfungen. Die organisationsweite Bausteinbibliothek ist nur verfügbar, wenn mindestens ein Event dieser Organisation Professional oder Business nutzt; die Zuordnung eines Bausteins wird weiterhin für das konkrete Event geprüft. Sponsorportal-Daten sowie Sponsor-Aufgaben und Uploads gehen über serverseitige Routen, die die Eventberechtigung vor dem Zugriff prüfen. Der PDF-Abschlussreport wird ebenfalls nur nach serverseitiger Berechtigungsprüfung erstellt.

Der Reports-Reiter bleibt in der Navigation sichtbar. In Starter und Professional zeigt er die Paket-Sperre; Supabase-RLS und die Reports-API sperren zugleich Lese- und Schreibzugriffe auf Reportdaten.

## Implementierung und Prüfung

- `app/api/events/[id]/package-payment/route.ts` reserviert serverseitig Paket-, Upgrade- und Kontingent-Zahlungen und erstellt Stripe Checkout.
- `app/api/webhooks/stripe/route.ts` bestätigt bezahlte Paket- und Kontingentbuchungen idempotent.
- `components/event-entitlements.tsx` zeigt Eventpaket, Kontingent und Upgrade-/Kontingentkauf direkt im eingebetteten Checkout.
- `components/event-reports.tsx` und `app/api/events/[id]/reports/route.ts` schützen die Reports-Funktion im Client und auf dem Server.
- `supabase/tests/event_product_tiers.test.sql` enthält Datenbanktests zu Tarifen, Mandantentrennung, Featurezugriff, Preisstaffel, Kontingent, Upgrades, Bestätigung und fehlgeschlagenen Zahlungen.
- `tests/event-pricing.test.ts` prüft Preisstaffelung und Upgradegebühr.

Die Migration ist lokal angelegt, aber noch nicht auf Supabase ausgeführt. Dafür ist ein separater Migrationsauftrag nötig.
