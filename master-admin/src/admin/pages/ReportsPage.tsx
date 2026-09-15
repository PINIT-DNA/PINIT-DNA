import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { Download, FileText, RefreshCw } from 'lucide-react';
import { LightStatCard } from '../components/LightStatCard';
import { fetchPlatformSummaryReport } from '../api/super-admin.api';
import type { PlatformSummaryReport } from '../api/super-admin.api';
import { exportPlatformReportPDF, exportPlatformReportCSV } from '../lib/platform-report-export';
import { Users, Building2, Dna, Award, ShieldAlert, IndianRupee } from 'lucide-react';

function toDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function ReportsPage() {
  const [from, setFrom] = useState(() => toDateInput(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [report, setReport] = useState<PlatformSummaryReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = () => {
    setLoading(true);
    setError(null);
    fetchPlatformSummaryReport({ from: new Date(from).toISOString(), to: new Date(`${to}T23:59:59`).toISOString() })
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to generate report'))
      .finally(() => setLoading(false));
  };

  useEffect(generate, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePdf = async () => {
    if (!report) return;
    setExportingPdf(true);
    try {
      await exportPlatformReportPDF(report);
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-gray-500 mb-1">From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400" />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="px-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400" />
        </div>
        <button type="button" onClick={generate} className="px-3 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg flex items-center gap-1.5">
          <RefreshCw size={14} /> Generate
        </button>
        {report && (
          <div className="flex gap-2 ml-auto">
            <button type="button" onClick={handlePdf} disabled={exportingPdf} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 flex items-center gap-1.5 disabled:opacity-50">
              {exportingPdf ? <RefreshCw size={14} className="animate-spin" /> : <FileText size={14} />} PDF
            </button>
            <button type="button" onClick={() => exportPlatformReportCSV(report)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 flex items-center gap-1.5">
              <Download size={14} /> CSV
            </button>
          </div>
        )}
      </div>

      {error && <div className="px-4 py-3 rounded-lg border border-red-200 bg-red-50 text-sm text-red-700">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-16"><div className="w-8 h-8 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" /></div>
      ) : report ? (
        <div className="space-y-6">
          <p className="text-xs text-gray-400">
            Computed on demand from live data — {format(new Date(report.range.from), 'MMM d, yyyy')} to {format(new Date(report.range.to), 'MMM d, yyyy')}, generated {format(new Date(report.generatedAt), 'MMM d, yyyy HH:mm')}
          </p>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <LightStatCard label="New Users" value={report.newUsers} icon={Users} />
            <LightStatCard label="New Organizations" value={report.newOrganizations} icon={Building2} />
            <LightStatCard label="DNA Generated" value={report.dnaGenerated} icon={Dna} />
            <LightStatCard label="Certificates Issued" value={report.certificatesIssued} icon={Award} />
            <LightStatCard label="Incidents Opened" value={report.incidentsOpened} sub={`${report.incidentsResolved} resolved`} icon={ShieldAlert} />
            <LightStatCard label="Revenue" value={`₹${(report.revenueCents / 100).toFixed(2)}`} icon={IndianRupee} />
          </div>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-900 mb-3">Incidents by Severity</h2>
            {report.incidentsBySeverity.length === 0 ? (
              <p className="text-sm text-gray-500">No incidents opened in this period</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {report.incidentsBySeverity.map((r) => (
                  <span key={r.severity} className="px-3 py-1.5 rounded-lg bg-gray-50 border border-gray-200 text-sm text-gray-700">
                    {r.severity}: <span className="font-semibold text-gray-900">{r.count}</span>
                  </span>
                ))}
              </div>
            )}
          </section>

          <section className="bg-white border border-gray-200 rounded-xl p-5">
            <h2 className="text-sm font-medium text-gray-900 mb-3">Platform Access</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Successful logins</span><p className="text-gray-900 font-medium">{report.successfulLogins}</p></div>
              <div><span className="text-gray-500">Admin actions recorded</span><p className="text-gray-900 font-medium">{report.adminActionsTaken}</p></div>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
