"use client";

import { useState, type FormEvent } from "react";
import { Icon, SplowLogo } from "@/components/ui";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export function AuthForm({ initialMode = "login", invitation = false, accountType = "organizer", initialMessage = "" }: { initialMode?: "login" | "signup"; invitation?: boolean; accountType?: "organizer" | "sponsor" | "admin"; initialMessage?: string }) {
  const [mode, setMode] = useState<"login" | "signup" | "recovery">(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [accountName, setAccountName] = useState("");
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [awaitingEmailConfirmation, setAwaitingEmailConfirmation] = useState(false);
  const [registrationIntent, setRegistrationIntent] = useState<"join" | "create" | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinCodeVerified, setJoinCodeVerified] = useState(false);
  const [checkingJoinCode, setCheckingJoinCode] = useState(false);
  const showOrganizerRegistrationChoice = accountType === "organizer" && mode === "signup" && !invitation && registrationIntent === null;

  function postAuthPath() {
    if (accountType === "sponsor") return "/login/sponsor?setup=1";
    if (accountType === "admin") return "/admin";
    const query = new URLSearchParams(window.location.search);
    const next = query.get("next");
    if (next?.startsWith("/") && !next.startsWith("//")) return next;
    const token = query.get("token");
    return token ? `/team/join?token=${encodeURIComponent(token)}` : "/dashboard";
  }

  async function verifyJoinCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured || checkingJoinCode || !joinCode.trim()) return;
    setCheckingJoinCode(true);
    setMessage("");
    try {
      const { data, error } = await createClient().rpc("validate_organization_join_code", { join_code: joinCode.trim() });
      if (error || data !== true) {
        setJoinCodeVerified(false);
        setMessage("Der Code ist ungültig oder abgelaufen. Bitte prüfe ihn oder lass dir den aktuellen Code aus dem Team-Bereich geben.");
      } else {
        setJoinCodeVerified(true);
        setMessage("");
      }
    } catch {
      setJoinCodeVerified(false);
      setMessage("Der Code konnte gerade nicht geprüft werden. Bitte versuche es erneut.");
    } finally {
      setCheckingJoinCode(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isSupabaseConfigured) return;

    setBusy(true);
    setMessage("");
    const supabase = createClient();

    if (mode === "recovery") {
      const redirectTo = `${window.location.origin}/auth/confirm?next=${encodeURIComponent("/passwort-zuruecksetzen")}`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      setMessage(error
        ? "Die E-Mail konnte nicht angefordert werden. Bitte versuche es später erneut."
        : "Wenn ein Konto mit dieser E-Mail-Adresse besteht, erhältst du in Kürze einen Link zum Zurücksetzen des Passworts.");
      setBusy(false);
      return;
    }

    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const authError = error as { code?: string; message?: string; status?: number };
        const errorCode = authError.code?.toLocaleLowerCase("en-US") ?? "";
        const errorText = authError.message?.toLocaleLowerCase("en-US") ?? "";
        const accountInactive = errorCode === "user_banned"
          || errorText.includes("user is banned")
          || errorText.includes("user banned")
          || errorText.includes("account is inactive");
        setMessage(accountInactive
          ? "Dein Account ist inaktiv. Bitte wende dich an den Splow-Administrator."
          : "Anmeldung fehlgeschlagen. Bitte prüfe E-Mail-Adresse und Passwort.");
        setBusy(false);
        return;
      }
      if (accountType === "admin") {
        try {
          const response = await fetch("/api/admin/access", { cache: "no-store" });
          const result = await response.json();
          if (!response.ok || result?.isAdmin !== true) {
            await supabase.auth.signOut();
            setMessage("Dieses Konto ist nicht für die Plattform-Administration freigeschaltet.");
            setBusy(false);
            return;
          }
        } catch {
          await supabase.auth.signOut();
          setMessage("Der Adminzugang konnte nicht geprüft werden. Bitte versuche es erneut.");
          setBusy(false);
          return;
        }
        window.location.assign("/admin");
        return;
      }
      if (accountType === "sponsor") {
        window.location.assign("/sponsor");
        return;
      }
      window.location.assign(postAuthPath());
      return;
    }

    const sponsorAccountName = accountName.trim();
    if (accountType === "organizer" && !invitation && registrationIntent === "join" && !joinCodeVerified) {
      setMessage("Gib zuerst einen gültigen Beitrittscode ein.");
      setBusy(false);
      return;
    }
    if (accountType === "organizer" && !invitation && registrationIntent !== "create" && registrationIntent !== "join") {
      setMessage("Wähle zuerst aus, ob du einen neuen Veranstalterbereich erstellen oder einem bestehenden beitreten möchtest.");
      setBusy(false);
      return;
    }
    const referralClickId = accountType === "organizer" && registrationIntent === "create"
      ? new URLSearchParams(window.location.search).get("referral_click")
      : null;
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/confirm?next=${encodeURIComponent(postAuthPath())}`,
        ...(accountType === "sponsor" ? { data: { account_type: "sponsor", sponsor_company_name: sponsorAccountName } } : accountType === "organizer" ? { data: { account_type: "organizer", onboarding_completed: false, ...(registrationIntent === "join" && !invitation ? { organization_join_code: joinCode.trim() } : {}), ...(referralClickId ? { partner_referral_click_id: referralClickId } : {}) } } : {}),
      },
    });
    if (error) {
      setMessage(accountType === "organizer" && registrationIntent === "join"
        ? "Das Konto konnte nicht mit dem Veranstalterbereich verknüpft werden. Der Beitrittscode könnte inzwischen abgelaufen sein. Bitte lass dir einen neuen Code geben und versuche es erneut."
        : "Das Konto konnte nicht erstellt werden. Prüfe die Angaben oder versuche es später erneut.");
    } else if (data.session) {
      if (accountType === "sponsor") {
        const { error: accountError } = await supabase.rpc("create_sponsor_account", { account_name: sponsorAccountName });
        if (accountError) {
          setMessage("Dein Login wurde erstellt, aber das Sponsor-Konto konnte nicht eingerichtet werden. Bitte versuche es später erneut.");
          setBusy(false);
          return;
        }
        window.location.assign("/sponsor");
        return;
      }
      window.location.assign(postAuthPath());
      return;
    } else if (accountType === "sponsor") {
      setMessage("Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Danach richten wir dein Sponsor-Konto ein.");
    } else if (registrationIntent === "join" && !invitation) {
      setMessage("Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Danach ergänzt du im Wizard nur noch deinen Vor- und Nachnamen.");
    } else {
      setMessage(invitation
        ? "Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link in deinem Postfach. Danach wirst du automatisch zum Veranstalterbereich weitergeleitet."
        : "Fast geschafft: Bitte bestätige deine E-Mail-Adresse über den Link, den Supabase dir geschickt hat.");
    }
    setAwaitingEmailConfirmation(true);
    setBusy(false);
  }

  return <section className={`auth-layout auth-layout-${mode} auth-layout-${accountType}`}>
    <aside className="auth-intro">
      <div className="auth-brand" aria-label="Splow"><SplowLogo /></div>
      <div className="auth-intro-copy">
        <span className="auth-kicker">SPONSORING. EINFACH IM BLICK.</span>
        <h2>{accountType === "admin" ? "Die Plattform sicher verwalten." : mode === "login" ? accountType === "sponsor" ? "Deine Partnerschaften an einem Ort." : "Deine Events. Deine Sponsoren. Alles an einem Ort." : mode === "signup" ? accountType === "sponsor" ? "Lege dein Sponsor-Konto an." : "Mach den nächsten Schritt für deine Veranstaltung." : "Wir helfen dir zurück in dein Konto."}</h2>
        <p>{accountType === "admin" ? "Melde dich mit einem freigeschalteten Plattform-Admin-Konto an." : mode === "login" ? accountType === "sponsor" ? "Melde dich mit dem Konto an, das mit deiner Sponsoring-Partnerschaft verknüpft ist." : "Verträge, vereinbarte Leistungen und Nachweise übersichtlich verwalten." : mode === "signup" ? accountType === "sponsor" ? "Registriere dein Unternehmen einmal und verknüpfe es später mit Event-Einladungen." : "Erstelle dein Konto und bringe deine Sponsoring-Verwaltung an einem Ort zusammen." : "Fordere einen sicheren Link an und vergib anschließend ein neues Passwort."}</p>
      </div>
      {accountType === "organizer" && <div className="auth-flow" aria-label="Ablauf in Splow">
        <span>Event</span><i aria-hidden="true"/><span>Sponsoren</span><i aria-hidden="true"/><span>Nachweise</span>
      </div>}
      {accountType !== "admin" && (accountType === "organizer" || mode !== "recovery") && <div className="auth-register-prompt">
        <div><strong>{accountType === "sponsor" ? mode === "login" ? "Neu als Sponsor?" : "Du hast schon ein Konto?" : mode === "login" ? "Neu bei Splow?" : mode === "signup" ? "Du hast schon ein Konto?" : "Zurück zur Anmeldung?"}</strong><p>{accountType === "sponsor" ? mode === "login" ? "Erstelle ein Konto für dein Unternehmen." : "Melde dich mit deinen Zugangsdaten an." : mode === "login" ? "Erstelle jetzt dein Konto." : "Du kannst dich jederzeit anmelden."}</p></div>
        <button className="auth-register-button" type="button" onClick={() => { setMode((current) => current === "login" ? "signup" : "login"); setRegistrationIntent(null); setJoinCode(""); setJoinCodeVerified(false); setAwaitingEmailConfirmation(false); setMessage(""); }}>
          {accountType === "sponsor" ? mode === "login" ? "Sponsor-Konto erstellen" : "Zum Login" : mode === "login" ? "Kostenlos registrieren" : "Anmelden"}<span aria-hidden="true">→</span>
        </button>
      </div>}
    </aside>
    <div className="auth-card">
      <div className="auth-heading"><span className="auth-form-eyebrow">{awaitingEmailConfirmation ? "REGISTRIERUNG ABGESCHLOSSEN" : accountType === "admin" ? mode === "recovery" ? "ADMIN-KONTOZUGANG" : "PLATTFORM-ADMINISTRATION" : mode === "login" ? accountType === "sponsor" ? "SPONSOR-ZUGANG" : "DEIN VERANSTALTERBEREICH" : mode === "signup" ? accountType === "sponsor" ? "SPONSOR-KONTO ERSTELLEN" : registrationIntent === "join" ? "VERANSTALTERBEREICH BEITRETEN" : showOrganizerRegistrationChoice ? "REGISTRIERUNG" : "KOSTENLOS STARTEN" : "KONTOZUGANG"}</span><h1>{awaitingEmailConfirmation ? "Bitte bestätige deine E-Mail-Adresse" : accountType === "admin" ? mode === "recovery" ? "Passwort zurücksetzen" : "Admin-Anmeldung" : mode === "login" ? invitation ? "Einladung annehmen" : "Willkommen zurück" : mode === "signup" ? accountType === "sponsor" ? "Als Sponsor registrieren" : invitation ? "Konto für die Einladung erstellen" : registrationIntent === "join" ? joinCodeVerified ? "Persönliche Daten eingeben" : "Beitrittscode eingeben" : showOrganizerRegistrationChoice ? "Wie möchtest du starten?" : "Neuen Bereich erstellen" : "Passwort zurücksetzen"}</h1><p>{awaitingEmailConfirmation ? `Wir haben einen Bestätigungslink an ${email} gesendet. Bitte öffne die E-Mail und bestätige deine Adresse. Falls nichts ankommt, prüfe auch deinen Spam-Ordner.` : accountType === "admin" ? mode === "recovery" ? "Wir senden einen sicheren Link an deine Admin-E-Mail-Adresse." : "Dieser Login ist nur für freigeschaltete Plattform-Admins." : mode === "login" ? invitation ? "Melde dich mit der eingeladenen E-Mail-Adresse an, um dem Veranstalterbereich beizutreten." : accountType === "sponsor" ? "Melde dich mit deinem Sponsor-Konto an." : "Melde dich an, um deine Events zu verwalten." : mode === "signup" ? accountType === "sponsor" ? "Erstelle ein Sponsor-Konto für dein Unternehmen. Danach kannst du Event-Einladungen annehmen." : invitation ? "Lege mit der eingeladenen E-Mail-Adresse ein eigenes Konto an. Danach erhältst du Zugriff auf den gemeinsamen Veranstalterbereich." : registrationIntent === "join" ? joinCodeVerified ? "Der Code ist bestätigt. Nach der Registrierung wird dein Konto direkt dem Veranstalterbereich zugeordnet." : "Gib den Beitrittscode ein, den du vom Veranstalter erhalten hast. Er ist eine Stunde gültig." : showOrganizerRegistrationChoice ? "Wähle zuerst aus, ob du einem bestehenden Veranstalterbereich beitreten oder einen neuen Bereich erstellen möchtest." : "Erstelle dein Veranstalterkonto für Splow." : "Wir senden dir einen Link an deine E-Mail-Adresse."}</p></div>
    {!isSupabaseConfigured ? <div className="auth-setup-message"><b>Supabase-Verbindung noch unvollständig</b><p>Ergänze Projekt-URL und Publishable Key in der lokalen Datei <code>.env.local</code>. Danach den Entwicklungsserver neu starten.</p></div> : awaitingEmailConfirmation ? <div className="auth-confirmation-notice" role="status" aria-live="polite"><span><Icon name="check" size={18}/></span><p>{message}</p></div> : showOrganizerRegistrationChoice ? <div className="auth-registration-choice-list" aria-label="Registrierungsart auswählen">
      <button className="auth-registration-choice-card" type="button" onClick={() => setRegistrationIntent("join")}><span className="auth-registration-choice-icon"><Icon name="users" size={18}/></span><span><strong>Bestehendem Bereich beitreten</strong><small>Gib den aktuellen Beitrittscode aus dem Team-Bereich ein.</small></span><Icon name="arrow" size={15}/></button>
      <button className="auth-registration-choice-card" type="button" onClick={() => setRegistrationIntent("create")}><span className="auth-registration-choice-icon"><Icon name="stack" size={18}/></span><span><strong>Neuen Bereich erstellen</strong><small>Richte einen eigenen Veranstalterbereich ein.</small></span><Icon name="arrow" size={15}/></button>
    </div> : mode === "signup" && accountType === "organizer" && !invitation && registrationIntent === "join" && !joinCodeVerified ? <div className="auth-join-instructions"><form className="auth-join-code-form" onSubmit={verifyJoinCode}><label className="settings-field"><span>Beitrittscode</span><input autoComplete="off" required value={joinCode} onChange={(event) => { setJoinCode(event.target.value); setJoinCodeVerified(false); }} placeholder="SP-XXXXX-XXXXX-XXXXX-XXXXX" /></label>{message && <p className="auth-message" role="status">{message}</p>}<button className="btn btn-primary auth-submit" type="submit" disabled={checkingJoinCode || !joinCode.trim()}>{checkingJoinCode ? "Code wird geprüft …" : "Code prüfen"}</button></form><button className="auth-mode-switch" type="button" onClick={() => { setRegistrationIntent(null); setJoinCode(""); setJoinCodeVerified(false); setMessage(""); }}>Zurück zur Auswahl</button></div> : <form className="auth-form" onSubmit={submit}>
      {mode === "signup" && accountType === "organizer" && registrationIntent === "join" && joinCodeVerified && <div className="auth-join-code-confirmed"><Icon name="check" size={16}/><span>Beitrittscode bestätigt</span><button type="button" className="auth-mode-switch" onClick={() => { setJoinCodeVerified(false); setMessage(""); }}>Ändern</button></div>}
      {mode === "signup" && accountType === "sponsor" && <label className="settings-field"><span>Unternehmen</span><input type="text" autoComplete="organization" required value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Name deines Unternehmens" /></label>}
      <label className="settings-field"><span>E-Mail-Adresse</span><input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder={accountType === "admin" ? "admin@unternehmen.de" : accountType === "sponsor" ? "name@unternehmen.de" : "name@veranstalter.de"} /></label>
      {mode !== "recovery" && <label className="settings-field"><span>Passwort</span><input type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mindestens 8 Zeichen" /></label>}
      {message && <p className="auth-message" role="status">{message}</p>}
      <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>{busy ? "Einen Moment …" : mode === "login" ? accountType === "admin" ? "Zum Adminbereich" : "Anmelden" : mode === "signup" ? accountType === "sponsor" ? "Sponsor-Konto erstellen" : invitation ? "Konto erstellen und beitreten" : "Konto erstellen" : "Reset-Link anfordern"}</button>
      {mode === "login" && <button className="auth-mode-switch" type="button" onClick={() => { setMode("recovery"); setMessage(""); }}>Passwort vergessen?</button>}
      {mode === "recovery" && <button className="auth-mode-switch" type="button" onClick={() => { setMode("login"); setMessage(""); }}>Zurück zur Anmeldung</button>}
    </form>}
    </div>
    <nav className="auth-legal-links" aria-label="Rechtliche Hinweise"><Link href="/agb">AGB</Link><Link href="/impressum">Impressum</Link><Link href="/datenschutz">Datenschutz</Link><Link href="/kontakt">Kontakt</Link></nav>
  </section>;
}
