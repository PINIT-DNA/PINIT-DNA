import type { PlatformSummaryReport } from '../api/super-admin.api';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function sectionHeader(doc: any, title: string, y: number) {
  doc.setFillColor(240, 242, 248);
  doc.rect(14, y - 1, 182, 7, 'F');
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(30, 41, 59);
  doc.text(title, 16, y + 4);
}

export async function exportPlatformReportPDF(report: PlatformSummaryReport): Promise<void> {
  const { default: jsPDF } = await import('jspdf');
  const { default: autoTable } = await import('jspdf-autotable');

  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const MARGIN = 14;
  let y = 0;

  doc.setFillColor(79, 70, 229);
  doc.rect(0, 0, 210, 34, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('PinitHUB — Platform Summary Report', MARGIN, 15);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.text(`Period: ${formatDate(report.range.from)} — ${formatDate(report.range.to)}`, MARGIN, 22);
  doc.text(`Generated: ${new Date(report.generatedAt).toLocaleString()}`, MARGIN, 28);

  y = 44;
  doc.setTextColor(30, 30, 30);
  sectionHeader(doc, 'PLATFORM ACTIVITY', y);
  y += 8;

  autoTable(doc, {
    startY: y,
    head: [],
    body: [
      ['New Users', String(report.newUsers)],
      ['New Organizations', String(report.newOrganizations)],
      ['DNA Records Generated', String(report.dnaGenerated)],
      ['Certificates Issued', String(report.certificatesIssued)],
      ['Successful Logins', String(report.successfulLogins)],
      ['Revenue', `INR ${(report.revenueCents / 100).toFixed(2)}`],
    ],
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 70, fillColor: [240, 242, 248] }, 1: { cellWidth: 100 } },
    theme: 'plain',
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  sectionHeader(doc, 'THREAT & INCIDENT ACTIVITY', y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [['Severity', 'Incidents Opened']],
    body: report.incidentsBySeverity.length ? report.incidentsBySeverity.map((r) => [r.severity, String(r.count)]) : [['—', '0']],
    foot: [['Resolved in period', String(report.incidentsResolved)]],
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 3 },
    theme: 'striped',
    headStyles: { fillColor: [79, 70, 229] },
  });
  y = (doc as any).lastAutoTable.finalY + 8;

  sectionHeader(doc, 'ADMIN CONSOLE ACTIVITY', y);
  y += 8;
  autoTable(doc, {
    startY: y,
    head: [],
    body: [['Destructive admin actions recorded', String(report.adminActionsTaken)]],
    margin: { left: MARGIN, right: MARGIN },
    styles: { fontSize: 9, cellPadding: 3 },
    columnStyles: { 0: { fontStyle: 'bold', cellWidth: 100, fillColor: [240, 242, 248] } },
    theme: 'plain',
  });

  doc.setFontSize(7);
  doc.setTextColor(150, 150, 150);
  doc.text('Computed on demand from live platform data — not a stored snapshot.', MARGIN, 287);

  doc.save(`platform-report-${formatDate(report.range.from)}-to-${formatDate(report.range.to)}.pdf`);
}

export function exportPlatformReportCSV(report: PlatformSummaryReport): void {
  const rows = [
    ['Metric', 'Value'],
    ['Period Start', report.range.from],
    ['Period End', report.range.to],
    ['New Users', String(report.newUsers)],
    ['New Organizations', String(report.newOrganizations)],
    ['DNA Records Generated', String(report.dnaGenerated)],
    ['Certificates Issued', String(report.certificatesIssued)],
    ['Successful Logins', String(report.successfulLogins)],
    ['Revenue (INR)', (report.revenueCents / 100).toFixed(2)],
    ['Incidents Opened', String(report.incidentsOpened)],
    ['Incidents Resolved', String(report.incidentsResolved)],
    ['Admin Actions Taken', String(report.adminActionsTaken)],
    ...report.incidentsBySeverity.map((r) => [`Incidents — ${r.severity}`, String(r.count)]),
  ];
  const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `platform-report-${report.range.from.slice(0, 10)}-to-${report.range.to.slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
