"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

type Audience = "organizer" | "sponsor";

const walkthroughs = {
  organizer: {
    title: "Dein Start mit Splow",
    intro: "In drei kurzen Schritten findest du dich in deinem Veranstalterbereich zurecht.",
    steps: [
      { title: "Event anlegen", text: "Lege eine Veranstaltung an. Dort bündelst du Sponsoren, Vereinbarungen und den Fortschritt.", href: "/events", link: "Zu den Events", icon: "calendar" },
      { title: "Sponsoren und Verträge", text: "Ordne Sponsoren deinem Event zu und vervollständige Vereinbarungen mit Vertragsvorlagen und Leistungen.", href: "/sponsors", link: "Zu den Sponsoren", icon: "users" },
      { title: "Aufgaben und Nachweise", text: "Leite Aufgaben aus Leistungen ab, dokumentiere die Umsetzung und erstelle danach den Abschlussreport.", href: "/aufgaben", link: "Zu den Aufgaben", icon: "check" },
    ],
  },
  sponsor: {
    title: "Dein Start im Sponsor-Bereich",
    intro: "So findest du die wichtigsten Informationen zu deinen Partnerschaften.",
    steps: [
      { title: "Deine Events", text: "Verknüpfe dein Sponsor-Konto mit einem Event über den Einladungscode des Veranstalters.", href: "/sponsor", link: "Zur Event-Übersicht", icon: "calendar" },
      { title: "Vertrag und Leistungen", text: "Öffne ein Event, um Vereinbarung, vereinbarte Leistungen und den aktuellen Stand zu sehen.", href: "/sponsor", link: "Zu deinen Events", icon: "file" },
      { title: "Dokumente und Aufgaben", text: "Lade angeforderte Unterlagen hoch und gib Aufgaben oder Nachweise direkt im Event frei.", href: "/sponsor", link: "Zum Sponsor-Bereich", icon: "check" },
    ],
  },
} satisfies Record<Audience, { title: string; intro: string; steps: { title: string; text: string; href: string; link: string; icon: string }[] }>;

export function FirstLoginWalkthrough({ audience }: { audience: Audience }) {
  const [visible, setVisible] = useState(false);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const content = walkthroughs[audience];
  const metadataKey = `sponso_${audience}_walkthrough_completed`;
  const current = content.steps[step];

  useEffect(() => {
    let active = true;
    void createClient().auth.getUser().then(({ data, error }) => {
      if (active && !error && data.user?.user_metadata?.[metadataKey] !== true) setVisible(true);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [metadataKey]);

  async function finish() {
    if (saving) return;
    setSaving(true);
    setSaveError("");
    try {
      const supabase = createClient();
      const { data: { user }, error: userError } = await supabase.auth.getUser();
      if (userError || !user) throw new Error("Profil nicht verfügbar");
      const { error } = await supabase.auth.updateUser({ data: { ...user.user_metadata, [metadataKey]: true } });
      if (error) throw error;
      setVisible(false);
    } catch {
      setSaveError("Der Abschluss konnte nicht gespeichert werden. Bitte versuche es erneut.");
    } finally {
      setSaving(false);
    }
  }

  if (!visible) return null;

  return <section className="panel first-login-walkthrough" aria-labelledby="first-login-walkthrough-title">
    <div className="first-login-walkthrough-top"><span className="first-login-walkthrough-icon"><Icon name={current.icon} size={18}/></span><span className="first-login-walkthrough-count">Schritt {step + 1} von {content.steps.length}</span><button className="first-login-walkthrough-close" type="button" onClick={() => void finish()} disabled={saving} aria-label="Einführung schließen"><Icon name="close" size={15}/></button></div>
    <div className="first-login-walkthrough-copy"><span className="eyebrow">KURZE EINFÜHRUNG</span><h2 id="first-login-walkthrough-title">{step === 0 ? content.title : current.title}</h2><p>{step === 0 ? content.intro : current.text}</p>{step === 0 && <p className="first-login-walkthrough-step-copy"><b>{current.title}</b> · {current.text}</p>}</div>
    {saveError && <p className="field-message error" role="alert">{saveError}</p>}
    <div className="first-login-walkthrough-actions"><Link className="btn" href={current.href}>{current.link}<Icon name="arrow" size={13}/></Link><div>{step > 0 && <button className="btn" type="button" onClick={() => setStep((value) => value - 1)}>Zurück</button>}{step < content.steps.length - 1 ? <button className="btn btn-primary" type="button" onClick={() => setStep((value) => value + 1)}>Weiter<Icon name="arrow" size={13}/></button> : <button className="btn btn-primary" type="button" onClick={() => void finish()} disabled={saving}>{saving ? "Wird gespeichert …" : "Einführung abschließen"}</button>}</div></div>
  </section>;
}
