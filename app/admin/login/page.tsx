import { AuthForm } from "@/components/auth-form";
import { privatePageMetadata } from "@/lib/seo";

export const metadata = privatePageMetadata("Admin-Anmeldung", "Sicherer Zugang zur Splow-Plattformadministration.");

export default function AdminLoginPage() {
  return <main className="auth-page"><AuthForm accountType="admin"/></main>;
}
