# Splow E-Mail-Vorlagen

| Datei | Betreff | Einsatz |
| --- | --- | --- |
| `registrierung.html` | Bestätige deine E-Mail-Adresse bei Splow | Supabase Auth → Confirm sign up |
| `passwort-zuruecksetzen.html` | Setze dein Splow-Passwort zurück | Supabase Auth → Reset password |
| `update.html` | Neuigkeiten bei Splow | Allgemeine Aktualisierungen über einen separaten Versanddienst |

Die ersten beiden Dateien können in **Supabase → Authentication → Email Templates**
als HTML-Inhalt eingefügt werden. `{{ .ConfirmationURL }}` ist ein Platzhalter
von Supabase Auth und führt über den bereits konfigurierten Bestätigungsablauf
der Anwendung. Jede der beiden Vorlagen enthält denselben Link im Button und
als lesbare Alternative. Der Betreff wird in Supabase separat gesetzt.

In `update.html` müssen `{{UPDATE_TITLE}}`, `{{UPDATE_MESSAGE}}`,
`{{BUTTON_LABEL}}` und `{{ACTION_URL}}` vom gewählten Versandprozess ersetzt
werden. Diese vier Platzhalter gehören nicht zu Supabase Auth. Texte vor dem
Einfügen als HTML maskieren; die Zieladresse auf eine erlaubte HTTPS-Adresse
der Anwendung beschränken. Der Betreff wird ebenfalls im Versandprozess gesetzt.

Die Dateien sind Vorlagen im Repository. Sie ändern keine aktiven Einstellungen
in Supabase oder einem E-Mail-Dienst.
