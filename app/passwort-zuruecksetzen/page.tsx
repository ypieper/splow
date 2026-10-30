"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Icon } from "@/components/ui";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (password.length < 8) {
      setMessage("Das Passwort muss mindestens 8 Zeichen lang sein.");
      return;
    }
    if (password !== confirmation) {
      setMessage("Die Passwörter stimmen nicht überein.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Der Reset-Link ist ungültig oder abgelaufen.");
      setUpdated(true);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Das Passwort konnte nicht geändert werden. Bitte fordere einen neuen Reset-Link an.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="content password-reset-content">
    <section className="panel password-reset-card">
      <span className="settings-section-icon"><Icon name="settings" size={17}/></span>
      {updated ? <>
        <h1>Passwort geändert</h1>
        <p>Dein neues Passwort ist gespeichert. Melde dich jetzt damit an.</p>
        <Link className="btn btn-primary" href="/login">Zur Anmeldung</Link>
      </> : <>
        <h1>Neues Passwort festlegen</h1>
        <p>Wähle ein neues Passwort für dein Konto.</p>
        <form className="auth-form" onSubmit={submit}>
          <label className="settings-field"><span>Neues Passwort</span><input type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Mindestens 8 Zeichen" /></label>
          <label className="settings-field"><span>Passwort wiederholen</span><input type="password" autoComplete="new-password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="Passwort erneut eingeben" /></label>
          {message && <p className="auth-message" role="status">{message}</p>}
          <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>{busy ? "Wird gespeichert …" : "Neues Passwort speichern"}</button>
        </form>
      </>}
      {!updated && <Link className="auth-mode-switch" href="/login">Zurück zur Anmeldung</Link>}
    </section>
  </main>;
}
