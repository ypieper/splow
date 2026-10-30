type CompletionReportPdfInput = {
  sponsorName: string;
  eventTitle: string;
  contractValue: string;
  tasks: { title: string; evidence: string }[];
  organizerLogoUrl?: string;
};

async function imageAsPngDataUrl(url?: string) {
  if (!url) return null;
  try {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.src = url;
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Logo konnte nicht geladen werden."));
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    canvas.getContext("2d")?.drawImage(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  }
}

function fileNamePart(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "Sponsor";
}

export async function createCompletionReportPdf({ sponsorName, eventTitle, contractValue, tasks, organizerLogoUrl }: CompletionReportPdfInput) {
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const pageWidth = 210;
  const pageHeight = 297;
  const left = 18;
  const right = 192;
  const width = right - left;
  const logo = await imageAsPngDataUrl(organizerLogoUrl);
  const createdAt = new Intl.DateTimeFormat("de-DE", { dateStyle: "long" }).format(new Date());

  function drawHeader(isFirstPage: boolean) {
    pdf.setFillColor(239, 112, 83);
    pdf.rect(0, 0, pageWidth, 3, "F");
    pdf.setTextColor(28, 48, 68);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(17);
    pdf.roundedRect(left, 12, 9, 9, 2, 2, "F");
    pdf.setFillColor(239, 112, 83);
    pdf.roundedRect(left, 12, 9, 9, 2, 2, "F");
    pdf.setTextColor(255, 255, 255);
    pdf.setFontSize(12);
    pdf.text("s", left + 4.5, 18.2, { align: "center" });
    pdf.setTextColor(28, 48, 68);
    pdf.setFontSize(13);
    pdf.text("Splow", left + 12, 18.5);
    if (logo) {
      pdf.addImage(logo, "PNG", right - 42, 11, 42, 16, undefined, "FAST");
    } else {
      pdf.setTextColor(101, 119, 136);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.text(eventTitle, right, 18, { align: "right", maxWidth: 100 });
    }
    pdf.setDrawColor(229, 235, 240);
    pdf.line(left, 26, right, 26);
    if (isFirstPage) return 34;
    pdf.setTextColor(198, 90, 64);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text("LEISTUNGSNACHWEIS · SPONSORING", left, 36);
    pdf.setTextColor(44, 65, 85);
    pdf.setFontSize(12);
    pdf.text(sponsorName, left, 43, { maxWidth: width });
    return 51;
  }

  let y = drawHeader(true);
  pdf.setTextColor(198, 90, 64);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(8);
  pdf.text("LEISTUNGSNACHWEIS · SPONSORING", left, y);
  y += 12;
  pdf.setTextColor(28, 48, 68);
  pdf.setFontSize(25);
  const sponsorLines = pdf.splitTextToSize(sponsorName, width);
  pdf.text(sponsorLines, left, y);
  y += sponsorLines.length * 9 + 2;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(10);
  pdf.setTextColor(112, 128, 144);
  pdf.text("Dokumentation der vereinbarten Sponsoringleistungen", left, y);
  y += 11;

  pdf.setFillColor(247, 249, 251);
  pdf.roundedRect(left, y, width, 17, 2, 2, "F");
  pdf.setFillColor(237, 118, 88);
  pdf.rect(left, y, 1.2, 17, "F");
  pdf.setTextColor(133, 147, 160);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.text("VERANSTALTUNG", left + 6, y + 6);
  pdf.setTextColor(43, 64, 84);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(11);
  pdf.text(eventTitle, left + 6, y + 12.5, { maxWidth: width - 12 });
  y += 23;

  const stats = [
    ["VERTRAGSWERT NETTO", contractValue],
    ["LEISTUNGEN NACHGEWIESEN", `${tasks.length} von ${tasks.length}`],
    ["ERSTELLT AM", createdAt],
  ];
  const gap = 3;
  const cardWidth = (width - gap * 2) / 3;
  stats.forEach(([label, value], index) => {
    const x = left + index * (cardWidth + gap);
    pdf.setDrawColor(230, 235, 239);
    pdf.setFillColor(255, 255, 255);
    pdf.roundedRect(x, y, cardWidth, 22, 2, 2, "FD");
    pdf.setTextColor(133, 145, 157);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6.5);
    pdf.text(label, x + 4, y + 7);
    pdf.setTextColor(35, 57, 78);
    pdf.setFontSize(index === 2 ? 8 : 10);
    pdf.setFont("helvetica", "bold");
    pdf.text(pdf.splitTextToSize(value, cardWidth - 8).slice(0, 2), x + 4, y + 15);
  });
  y += 34;

  pdf.setTextColor(133, 147, 160);
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.text("LEISTUNGSÜBERSICHT", left, y);
  y += 7;
  pdf.setTextColor(35, 57, 78);
  pdf.setFontSize(14);
  pdf.text("Vereinbarte Leistungen", left, y);
  pdf.setTextColor(135, 147, 160);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.text(`${tasks.length} Nachweise`, right, y, { align: "right" });
  y += 7;
  pdf.setDrawColor(231, 237, 241);
  pdf.line(left, y, right, y);
  y += 3;

  for (const [index, task] of tasks.entries()) {
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    const titleLines = pdf.splitTextToSize(task.title, width - 18);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    const evidenceLines = pdf.splitTextToSize(task.evidence || "Nachweis erbracht", width - 23);
    const rowHeight = Math.max(20, 5 + titleLines.length * 4.8 + 3 + evidenceLines.length * 4.1);
    if (y + rowHeight > 270) {
      pdf.addPage();
      y = drawHeader(false) + 3;
      pdf.setDrawColor(231, 237, 241);
      pdf.line(left, y, right, y);
      y += 3;
    }
    pdf.setTextColor(195, 99, 78);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(8);
    pdf.text(String(index + 1).padStart(2, "0"), left + 1, y + 7);
    pdf.setTextColor(44, 65, 85);
    pdf.setFontSize(10);
    pdf.text(titleLines, left + 13, y + 7);
    const evidenceY = y + 7 + titleLines.length * 4.8 + 2;
    pdf.setFillColor(234, 246, 241);
    pdf.circle(right - 2.5, y + 6, 2.4, "F");
    pdf.setTextColor(37, 128, 95);
    pdf.setFontSize(6);
    pdf.text("✓", right - 2.5, y + 7.1, { align: "center" });
    pdf.setTextColor(133, 146, 158);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(6);
    pdf.text("NACHWEIS", left + 13, evidenceY);
    pdf.setTextColor(98, 116, 134);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(8);
    pdf.text(evidenceLines, left + 31, evidenceY, { maxWidth: width - 55 });
    y += rowHeight;
    pdf.setDrawColor(231, 237, 241);
    pdf.line(left, y, right, y);
    y += 2;
  }

  const pageCount = pdf.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page);
    pdf.setDrawColor(232, 237, 241);
    pdf.line(left, 281, right, 281);
    pdf.setTextColor(138, 150, 162);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(7);
    pdf.text("Erstellt mit Splow", left, 286);
    pdf.text(`${sponsorName} · ${eventTitle}`, pageWidth / 2, 286, { align: "center", maxWidth: 100 });
    pdf.text(`${page} / ${pageCount}`, right, 286, { align: "right" });
  }

  const safeName = `${fileNamePart(sponsorName)}-${fileNamePart(eventTitle)}-Abschlussreport.pdf`;
  return new File([pdf.output("blob")], safeName, { type: "application/pdf" });
}
