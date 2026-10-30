# Testumgebungen

## Zuordnung

| Umgebung | Datenbank | Zweck |
| --- | --- | --- |
| localhost:3000 | `Splow - test` (`nwlapyarlpaztpdouyxm`) | Entwicklung und Refactoring |
| Vercel Preview | Dasselbe Testprojekt, sobald Preview konfiguriert ist | Änderungen vor Veröffentlichung ansehen |
| Vercel Production | Bestehendes Produktivprojekt (`qnbqbnbdhjvocxycnnwm`) | Livebetrieb |

Das Testprojekt ist ein eigenständiges Supabase-Projekt. Es enthält die
Migrationen und ausschließlich neu angelegte, fiktive Testdaten. Produktive
Nutzer und Dateien wurden nicht kopiert. Produktive Einstellungen und Daten
wurden nicht verändert.

## Lokale Konfiguration

- `.env.local` verwendet jetzt das Testprojekt.
- `.env.test.local` enthält dessen Schlüssel für gezielte Testwerkzeuge.
- `.env.local.production-backup` sichert die vorherige lokale Konfiguration.
  Der Dateiname ist absichtlich keine automatisch geladene Next.js-Umgebung.
- `.env.test-accounts.local` enthält die Testzugänge und IDs des Testevents.

Diese Dateien sind durch `.gitignore` ausgeschlossen und lokal nur für den
Benutzer lesbar. Niemals Schlüssel, Passwörter oder die Sicherung committen.
Ein Wechsel der lokalen Umgebung erfordert einen Neustart des Dev-Servers.

Testkonten:

- Veranstalter: `organizer@sponsorproof.test`
- Sponsor: `sponsor@sponsorproof.test`
- Event: **Testfestival 2027 – Sandbox**

Die Passwörter stehen ausschließlich in `.env.test-accounts.local`. Der Sponsor
wurde über einen neuen Einladungscode mit dem Testevent verknüpft. Das Event
hat eine administrative Testfreischaltung ohne Zahlung. Der Vertrag bleibt
ein unsignierter Entwurf. Aufgaben und Event-Kennzahlen können damit bereits
getestet werden. Leistungen, deren Anzeige einen unterschriebenen Vertrag
voraussetzt, sind entsprechend noch gesperrt.

Nur im Testprojekt ist die E-Mail-Bestätigung deaktiviert. Als Auth-Redirects
sind localhost und 127.0.0.1 auf Port 3000 zugelassen.

## Prüfungen

```sh
pnpm test
pnpm typecheck
pnpm test:sandbox
```

`test:sandbox` nutzt die angemeldete Supabase CLI und die öffentliche
Projekt-Allowlist in `supabase/test-project.json`. Ein abweichender
`SPONSO_TEST_PROJECT_REF` wird vor dem CLI-Aufruf abgewiesen. Jeder SQL-Test
läuft in einer Transaktion mit `ROLLBACK`; die Testdaten daraus bleiben nicht
gespeichert. Die vier SQL-Dateien enthalten zusammen 103 Prüfungen.

Der alternative Befehl `pnpm test:db` ist ausschließlich für einen lokalen
Supabase-Stack gedacht und benötigt Docker oder eine unterstützte Alternative.

Am 21.10.2026 tatsächlich geprüft:

- 26 Unit-Tests erfolgreich.
- 103 SQL-Prüfungen im freigegebenen Testprojekt erfolgreich.
- TypeScript-Prüfung (`tsc --noEmit`) und `git diff --check` erfolgreich.
- Chrome: Anmeldung beider Testkonten, gespeicherte Kennzahlen im
  Veranstalterbereich, grüne Leistung ohne Aufgaben samt Fortschrittshinweis,
  aktive Sponsor-Aufgabe bei ausgeblendeter wartender Freigabe,
  schreibgeschützte formatierte Sponsor-Kennzahlen, mobile Ansicht mit 390 px
  und Aufruf des Brand-Kits erfolgreich.
- Keine Browser-Ausnahmen, HTTP-5xx-Antworten oder Browser-Zugriffe auf das
  Produktivprojekt in dieser Prüfung. localhost antwortet mit HTTP 200.

Dateiübertragung, Vertragsunterzeichnung, Zahlungsabläufe, E-Mail-Zustellung und
Vercel Preview wurden in diesem Durchlauf nicht vollständig durchgespielt.

## GitHub und Vercel

Ein GitHub-Repository und ein Vercel-Projekt reichen aus. Eine Arbeitsbranch
(beispielsweise `codex/refactoring`) kann eine Preview-Bereitstellung erzeugen.
`main` bleibt die Produktionsbranch, sofern es so in Vercel eingestellt ist.

Vor einer Preview-Bereitstellung im bestehenden Vercel-Projekt die folgenden
Variablen ausschließlich für **Preview** auf die Werte aus `.env.test.local`
setzen:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY` (nur serverseitig; niemals mit `NEXT_PUBLIC_`)

Variablen mit Branch-Override ebenfalls prüfen. Production muss seine
bisherigen Werte behalten. Die konkrete Preview-Adresse zusätzlich in der
Auth-Redirect-Allowlist des Testprojekts hinterlegen und anschließend die
Preview neu bereitstellen. Auch andere aktivierte externe Dienste müssen
Testzugänge verwenden, bevor dort echte Aktionen ausprobiert werden.

Vercel wurde im Rahmen der lokalen Einrichtung noch nicht umkonfiguriert und
es wurde keine neue Bereitstellung ausgelöst.
