# Splow – Projektleitlinien

## Produkt

Splow ist eine einfache Sponsoring-Management-Web-App für kleine und mittelgroße Veranstalter. Sie soll den bislang über Excel, Word, E-Mail und Handyfotos verteilten Ablauf an einem Ort unterstützen.

Das Kernziel umfasst:

- Sponsoren und ihre Vereinbarungen verwalten.
- Sponsoringverträge aus wiederverwendbaren Vertrags- und Leistungsbausteinen erstellen.
- Aus vereinbarten Leistungen automatisch Aufgaben zur Erfüllung ableiten.
- Nachweise, insbesondere Fotos, dokumentieren.
- Nach der Veranstaltung für jeden Sponsor einen professionellen Leistungsnachweis erzeugen.

Die Zielgruppe sind insbesondere kleinere Festivals, Open-Air-Kinos, Stadtfeste, Weihnachtsmärkte sowie Vereins- und Sportveranstaltungen. Gehe davon aus, dass viele Nutzerinnen und Nutzer keine IT-Kenntnisse haben.

## Produktprinzipien

- Bedienung muss einfach, klar und ohne Einweisung verständlich sein.
- Gestalte die Oberfläche als modernes, reduziertes SaaS-Produkt.
- Entwickle responsive und Mobile First. Event-Modus und das Erfassen von Fotonachweisen müssen auf Smartphones besonders leicht bedienbar sein.
- Vermeide unnötige Enterprise-Funktionen und unnötige Komplexität.
- Entwickle Funktionen schrittweise und im Rahmen des konkreten Auftrags.
- Erfinde keine zusätzlichen Produktfunktionen, die nicht beauftragt wurden.
- Ändere funktionierende Features nur, wenn es für den Auftrag erforderlich ist. Bewahre bestehendes Verhalten und den vorhandenen Stil, sofern nichts anderes verlangt wird.

## Geplanter Tech-Stack

- Next.js
- TypeScript
- Supabase
- Vercel
- OpenAI API für spätere KI-Funktionen

Orientiere neue Implementierungen an der bestehenden Projektstruktur und den bereits verwendeten Konventionen. Führe keine Stack-Komponenten oder Abhängigkeiten ein, die für den konkreten Auftrag nicht benötigt werden. KI-Funktionen sind Zukunftsplanung und kein Auftrag, sie vorzeitig einzubauen.

## Arbeitsweise

- Lies vor Änderungen die relevanten Dateien und beachte weitere `AGENTS.md`-Dateien in betroffenen Verzeichnissen.
- Setze nur den beauftragten Umfang um und halte Änderungen möglichst klein und nachvollziehbar.
- Frage bei unklaren Anforderungen nach, statt wichtige Produktentscheidungen zu erfinden. Triff kleine, reversible Implementierungsentscheidungen selbst.
- Behaupte keine Tests oder Prüfungen, die nicht ausgeführt wurden.
- Ändere oder lösche keine Nutzerdaten oder Projektdateien außerhalb des angefragten Umfangs.

