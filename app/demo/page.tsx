import type { Metadata } from "next";
import { PublicPageFrame } from "@/components/public-page-frame";
import { ProductDemo } from "@/components/product-demo";

export const metadata: Metadata = {
  title: "Splow live erleben – Produktdemo",
  description: "Entdecke den Sponsoringablauf in Splow anhand eines interaktiven, schreibgeschützten Beispiel-Events.",
  alternates: { canonical: "/demo" },
  robots: { index: false, follow: false },
};

export default function DemoPage() {
  return <PublicPageFrame brandHref="/">
    <ProductDemo />
  </PublicPageFrame>;
}
