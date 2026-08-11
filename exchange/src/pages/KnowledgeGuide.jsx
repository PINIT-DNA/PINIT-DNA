import React, { useState } from 'react';
import { BookOpen, Search, ShieldCheck, Award, Lock, FileText, ChevronDown, ChevronUp } from 'lucide-react';

export default function KnowledgeGuide() {
  const [searchTerm, setSearchTerm] = useState('');
  const [openFaq, setOpenFaq] = useState(null);

  const faqs = [
    {
      q: 'How does Pinit Exchange connect to Pinit HUB?',
      a: 'Pinit HUB is the private vault app where creators generate file DNA and encrypt master files. Pinit Exchange is the public marketplace where creators list selected works. Buyers purchase verified licenses on Exchange, while Pinit HUB continues monitoring sold assets for leaks behind the scenes.'
    },
    {
      q: 'What happens if an asset has more than 80% AI-generated content?',
      a: 'Per Section 9 of the Builder Guide, any asset exceeding 80% AI content is strictly blocked from publishing on Pinit Exchange. The backend server evaluates the AI ratio and rejects listing attempts with an HTTP 400 error.'
    },
    {
      q: 'What do Gold, Silver, and Bronze Authenticity Badges mean?',
      a: 'Gold Badge = 90–100% manual/human originality (highest trust). Silver Badge = 60–80% manual/human originality (assisted/mixed). Bronze Badge = below Silver but under the 80% AI rejection threshold.'
    },
    {
      q: 'Do I need special hardware chips to use Pinit?',
      a: 'No. Pinit HUB creates software-based digital DNA fingerprints from your files. There are no hardware chips or camera sensors required — protection runs through the Pinit HUB vault and DNA engine.'
    },
    {
      q: 'What is a Sealed Sale Record?',
      a: 'Every purchase mints an append-only seal record (SEAL-XXXXXXXX) binding the seller’s verified Exchange ID, buyer identity snapshot, SHA-256 DNA hash summary, and license terms version into a verifiable digital License Certificate.'
    }
  ];

  const filteredFaqs = faqs.filter(f => f.q.toLowerCase().includes(searchTerm.toLowerCase()) || f.a.toLowerCase().includes(searchTerm.toLowerCase()));

  return (
    <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '32px 24px' }}>
      <div style={{ textAlign: 'center', marginBottom: '40px' }}>
        <div style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(59, 130, 246, 0.15)',
          padding: '6px 16px',
          borderRadius: '99px',
          color: 'var(--primary)',
          fontSize: '0.85rem',
          fontWeight: 700,
          marginBottom: '16px'
        }}>
          <BookOpen size={16} /> KNOWLEDGE BASE &amp; BUILDER GUIDE
        </div>

        <h1 style={{ fontSize: '2.5rem', color: '#fff', marginBottom: '16px' }}>
          Pinit Exchange Help &amp; Knowledge Guide
        </h1>

        <p style={{ color: 'var(--text-muted)', fontSize: '1.05rem', maxWidth: '700px', margin: '0 auto' }}>
          Learn about provenance licensing tiers, Section 9 AI policy guard rules, and Pinit HUB vault integration.
        </p>
      </div>

      {/* Search Bar */}
      <div style={{ position: 'relative', maxWidth: '600px', margin: '0 auto 40px auto' }}>
        <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '16px', top: '50%', transform: 'translateY(-50%)' }} />
        <input 
          type="text" 
          className="form-input" 
          placeholder="Search guide by keyword, AI policy, license tiers, or Pinit HUB vault..."
          value={searchTerm}
          onChange={e => setSearchTerm(e.target.value)}
          style={{ paddingLeft: '44px' }}
        />
      </div>

      {/* License Comparison Table */}
      <div className="glass-panel" style={{ padding: '28px', marginBottom: '40px' }}>
        <h3 style={{ fontSize: '1.3rem', color: '#fff', marginBottom: '16px' }}>Licensing Tier Comparison Table</h3>
        <table className="ledger-table">
          <thead>
            <tr>
              <th>License Tier</th>
              <th>Allowed Use Cases</th>
              <th>Resale Rights</th>
              <th>RAW Master Access</th>
              <th>License protection</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ color: 'var(--primary)', fontWeight: 700 }}>Personal</td>
              <td>Single user, non-monetized portfolio</td>
              <td>❌ No</td>
              <td>Watermarked / High-Res</td>
              <td>Standard license terms</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--emerald)', fontWeight: 700 }}>Commercial</td>
              <td>Client deliverables, digital ads, social media</td>
              <td>❌ No</td>
              <td>Full High-Res Package</td>
              <td>Commercial protection coverage*</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--badge-gold)', fontWeight: 700 }}>Exclusive Buyout</td>
              <td>Full exclusive ownership, asset delisted</td>
              <td>✅ Transferable</td>
              <td>Licensed delivery from Hub</td>
              <td>Exclusive protection coverage*</td>
            </tr>
            <tr>
              <td style={{ color: 'var(--indigo)', fontWeight: 700 }}>Enterprise Seat</td>
              <td>Multi-seat corporate deployment</td>
              <td>✅ Enterprise SLA</td>
              <td>Licensed delivery from Hub</td>
              <td>Enterprise license protection*</td>
            </tr>
          </tbody>
        </table>
        <p style={{ color: 'var(--text-dim)', fontSize: '0.78rem', marginTop: 12 }}>
          * Protection coverage describes product licensing terms — not a contractual insurance or legal indemnity guarantee. Sample comparison for product education.
        </p>
      </div>

      {/* FAQs */}
      <div className="glass-panel" style={{ padding: '28px' }}>
        <h3 style={{ fontSize: '1.3rem', color: '#fff', marginBottom: '20px' }}>Frequently Asked Questions</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {filteredFaqs.map((faq, i) => (
            <div 
              key={i} 
              style={{
                background: 'rgba(0,0,0,0.3)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '16px 20px',
                cursor: 'pointer'
              }}
              onClick={() => setOpenFaq(openFaq === i ? null : i)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, color: '#fff', fontSize: '0.98rem' }}>
                <span>{faq.q}</span>
                {openFaq === i ? <ChevronUp size={18} color="var(--primary)" /> : <ChevronDown size={18} color="var(--text-muted)" />}
              </div>
              {openFaq === i && (
                <p style={{ marginTop: '12px', fontSize: '0.88rem', color: 'var(--text-muted)', lineHeight: '1.6', paddingTop: '12px', borderTop: '1px solid var(--border-subtle)' }}>
                  {faq.a}
                </p>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
