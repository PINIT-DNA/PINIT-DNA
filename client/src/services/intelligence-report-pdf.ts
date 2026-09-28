import { format } from 'date-fns';
import type { IntelView } from '../lib/intelligence-bundle';

function safeName(name: string) {
  return name.replace(/[^\w.\-]+/g, '_').slice(0, 60);
}

export async function downloadIntelligenceReportPdf(view: IntelView) {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const date = format(new Date(view.generatedAt), 'yyyy-MM-dd');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('PinIT Intelligence Report', 14, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(80);
  doc.text(view.filename, 14, 25);
  doc.text(`Generated ${format(new Date(view.generatedAt), 'd MMM yyyy, h:mm a')}`, 14, 30);
  doc.setTextColor(20);

  const addFacts = (title: string, rows: Array<{ label: string; value: string; source?: string }>) => {
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY
        ? (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8
        : 36,
      head: [[title, '', '']],
      body: rows.map((r) => [r.label, r.value, r.source ? r.source.toUpperCase() : '']),
      theme: 'plain',
      styles: { fontSize: 8, cellPadding: 1.4 },
      headStyles: { fillColor: [245, 243, 255], textColor: 30, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 45 }, 1: { cellWidth: 105 }, 2: { cellWidth: 30 } },
    });
  };

  addFacts('Asset intelligence', [
    { label: 'Owner', value: view.ownerName || view.ownerShortId || 'Unavailable' },
    { label: 'First seen', value: view.firstSeen },
    { label: 'Last activity', value: view.lastActivity || 'None recorded' },
    { label: 'Protection', value: view.dnaStatus },
    { label: 'Authenticity', value: view.authenticityLabel },
    { label: 'Tamper', value: view.tamperLabel },
    { label: 'AI check', value: view.aiLabel },
  ]);
  addFacts('Identity', view.identity.map((f) => ({ label: f.label, value: f.value, source: f.source })));
  addFacts('Original capture', view.capture.map((f) => ({ label: f.label, value: f.value, source: f.source })));
  addFacts('Camera forensics', [
    { label: 'Conclusion', value: view.camera.conclusion },
    ...view.camera.facts.map((f) => ({ label: f.label, value: f.value, source: f.source })),
    { label: 'Note', value: view.camera.disclaimer },
  ]);
  addFacts('Environment', view.environment.map((f) => ({ label: f.label, value: f.value, source: f.source })));
  addFacts('Protection', view.protection.map((f) => ({ label: f.label, value: f.value, source: f.source })));

  autoTable(doc, {
    startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
    head: [['Exposure', 'Count']],
    body: [
      ['Views', String(view.exposure.views)],
      ['Shares', String(view.exposure.shares)],
      ['Downloads', String(view.exposure.downloads)],
      ['Verifications', String(view.exposure.verifications)],
      ['Online matches', String(view.exposure.matches)],
    ],
    theme: 'plain',
    styles: { fontSize: 8, cellPadding: 1.4 },
    headStyles: { fillColor: [245, 243, 255], textColor: 30, fontStyle: 'bold' },
  });

  if (view.journey.length) {
    autoTable(doc, {
      startY: (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8,
      head: [['When', 'What happened', 'Detail']],
      body: view.journey.slice(0, 40).map((e) => [
        format(new Date(e.at), 'd MMM yyyy HH:mm'),
        e.title,
        e.detail,
      ]),
      theme: 'plain',
      styles: { fontSize: 7, cellPadding: 1.2 },
      headStyles: { fillColor: [245, 243, 255], textColor: 30, fontStyle: 'bold' },
    });
  }

  const y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10;
  doc.setFontSize(9);
  const snapshot = doc.splitTextToSize(view.snapshot, 182);
  doc.text(snapshot, 14, y);

  doc.save(`pinit-intelligence-${safeName(view.filename)}-${date}.pdf`);
}
