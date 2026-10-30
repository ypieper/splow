"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

export default function ResetPasswordPage() {
  const router = useRouter();
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
      const { error } = await createClient().auth.updateUser({ password });
      if (error) throw error;
      setUpdated(true);
    } catch {
      setMessage("Das Passwort konnte nicht geändert werden. Bitte fordere einen neuen Reset-Link an.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="content password-reset-content">
    <section className="panel password-reset-card">
      <span className="settings-section-icon"><Icon name="settings" size={17}/></span>
      {updated ? <>
        <h1>Passwort geändert</h1>
        <p>Dein neues Passwort ist gespeichert. Du kannst Splow jetzt öffnen.</p>
        <button className="btn btn-primary" type="button" onClick={() => router.replace("/dashboard")}>Weiter zu Splow</button>
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
