# Firma.dev-Webhooks

## Ablauf

`POST /api/webhooks/firma` prüft zuerst die HMAC-Signatur und schreibt unterstützte Ereignisse mit der Firma-Ereignis-ID in `firma_webhook_jobs`. Die Ereignis-ID ist eindeutig; wiederholte Zustellungen erzeugen keinen zweiten Auftrag. Die Antwort an Firma erfolgt nach erfolgreichem Speichern. Anschließend verarbeitet Next.js den Auftrag im Hintergrund.

Wenn die Hintergrundverarbeitung fehlschlägt, bleibt der Auftrag mit Fehler, Versuchszahl und nächstem Ausführungszeitpunkt in der Queue. Nach fünf fehlgeschlagenen Verarbeitungsversuchen wird er als `failed` markiert. Payloads werden nach Abschluss oder nach dem letzten Fehlversuch gelöscht; Ereignis- und Request-ID bleiben zur Deduplizierung erhalten. Eine erneute Zustellung von Firma füllt einen fehlgeschlagenen Auftrag neu und setzt seine Versuche zurück.

Der Worker `GET /api/cron/firma-webhooks` verarbeitet fällige Aufträge. Er benötigt `Authorization: Bearer <CRON_SECRET>` und gibt keine Job-Payloads zurück. Datenbanktabelle und Funktionen sind für `service_role` reserviert; normale Nutzer erhalten keinen Zugriff.

## Vercel-Konfiguration

- `CRON_SECRET` als serverseitige Environment Variable hinterlegen; einen zufälligen Wert mit mindestens 16 Zeichen verwenden. Den Wert nicht ins Repository schreiben.
- Vercel Cron führt nur Production-Deployments aus. Preview verarbeitet Webhooks unmittelbar über `after()`; der geplante Worker läuft dort nicht.
- Vercel Hobby erlaubt Cron-Ausführungen höchstens einmal täglich. Der konfigurierte Lauf um 03:00 UTC ist daher nur ein Wiederherstellungs-Backstop; neu eingegangene Webhooks werden direkt nach dem Empfang verarbeitet. Für häufigere geplante Wiederholungen begrenzt der Hobby-Tarif die Frequenz.
- Die Migration `20261031120000_firma_webhook_jobs.sql` muss in einer Zielumgebung angewendet sein, bevor die Queue dort aktiv ist. Sie wurde lokal erstellt, aber nicht auf Supabase angewendet.

## Tests

`supabase/tests/firma_webhook_jobs.test.sql` prüft Zugriffsschutz, Deduplizierung, Claims, Leases, Backoff und die Begrenzung auf fünf Versuche. Der Test läuft ausschließlich in einer lokalen Supabase-Datenbank oder über das ausdrücklich konfigurierte Sandbox-Testprojekt.
