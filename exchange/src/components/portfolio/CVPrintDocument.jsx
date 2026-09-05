import React from 'react';
import { createPortal } from 'react-dom';

const asArray = (v) => (Array.isArray(v) ? v : []);

function labelOf(item, ...keys) {
  if (typeof item === 'string') return item;
  for (const k of keys) {
    if (typeof item?.[k] === 'string' && item[k].trim()) return item[k];
  }
  return '';
}

function flatten(list, ...keys) {
  return asArray(list).flatMap((s) => {
    if (typeof s === 'string') return [s];
    if (Array.isArray(s?.items)) return s.items.filter((i) => typeof i === 'string' && i);
    const one = labelOf(s, ...keys);
    return one ? [one] : [];
  }).filter(Boolean);
}

function kindOf(item) {
  const raw = String(item?.kind || item?.relatedSkill || '').toLowerCase();
  if (raw === 'license' || raw === 'course' || raw === 'workshop' || raw === 'award') return raw;
  return 'certificate';
}

function coverOf(project) {
  if (project?.cover_url) return project.cover_url;
  const gallery = asArray(project?.gallery);
  const first = gallery[0];
  if (typeof first === 'string') return first;
  return first?.url || first?.src || '';
}

function Section({ title, children }) {
  if (!children) return null;
  return (
    <section className="cv-sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/**
 * Print-only résumé. Portaled to document.body so Exchange print CSS that
 * hides `body *` cannot leave it nested inside a hidden #root ancestor, and
 * so `display:none` on the live portfolio never hides the CV.
 */
export default function CVPrintDocument({ portfolio }) {
  if (!portfolio || typeof document === 'undefined') return null;

  const id = portfolio.identity || {};
  const contact = portfolio.contact || {};
  const experience = asArray(portfolio.experience);
  const projects = asArray(portfolio.projects);
  const skills = flatten(portfolio.skills, 'name', 'title', 'label');
  const services = flatten(portfolio.services, 'title', 'name', 'label');
  const awards = asArray(portfolio.awards);
  const creds = asArray(portfolio.certifications);
  const licenses = creds.filter((c) => kindOf(c) === 'license');
  const certificates = creds.filter((c) => kindOf(c) !== 'license');
  const collabs = flatten(portfolio.collaborations, 'with', 'name', 'title');
  const socials = asArray(portfolio.social_links).filter((s) => s?.url);
  const human = portfolio.verified?.summary?.avg_human_percent;
  const path = portfolio.public_path || (portfolio.slug ? `/p/${portfolio.slug}` : '');
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const pageUrl = path && origin ? `${origin}${path}` : path;

  const doc = (
    <div className="cv-print" id="cv-print-document">
      <header className="cv-head">
        <div>
          <p className="cv-kicker">Curriculum Vitae</p>
          <h1>{id.name || 'Portfolio'}</h1>
          {id.headline ? <p className="cv-title">{id.headline}</p> : null}
          <p className="cv-meta">
            {[id.location, contact.email, pageUrl].filter(Boolean).join('  ·  ')}
          </p>
          {socials.length ? (
            <p className="cv-meta">
              {socials.map((s) => s.label ? `${s.label}: ${s.url}` : s.url).join('  ·  ')}
            </p>
          ) : null}
        </div>
        {Number.isFinite(human) ? (
          <aside className="cv-review" aria-label="Pinit human review">
            <span>Pinit</span>
            <b>{human}%</b>
            <em>human, on average, on sealed files</em>
          </aside>
        ) : null}
      </header>

      {id.about ? (
        <Section title="Profile">
          <p className="cv-prose">{id.about}</p>
        </Section>
      ) : null}

      {experience.length ? (
        <Section title="Experience">
          <ol className="cv-jobs">
            {experience.map((job, i) => {
              const org = labelOf(job, 'company', 'org');
              const role = labelOf(job, 'role', 'title');
              const when = [job.start, job.end].filter(Boolean).join(' — ') || job.year || '';
              return (
                <li key={job.id || i} className="cv-block">
                  <div className="cv-block__top">
                    <h3>{role || org}</h3>
                    {when ? <span>{when}</span> : null}
                  </div>
                  {org && role ? <p className="cv-org">{org}{job.location ? ` · ${job.location}` : ''}</p> : null}
                  {!role && job.location ? <p className="cv-org">{job.location}</p> : null}
                  {job.summary ? <p className="cv-prose">{job.summary}</p> : null}
                </li>
              );
            })}
          </ol>
        </Section>
      ) : null}

      {projects.length ? (
        <Section title="Selected work">
          <ul className="cv-work">
            {projects.map((p) => {
              const thumb = coverOf(p);
              return (
                <li key={p.id || p.title} className="cv-block cv-work__item">
                  {thumb ? <img src={thumb} alt="" className="cv-thumb" /> : null}
                  <div>
                    <div className="cv-block__top">
                      <h3>{p.title}</h3>
                      {p.year ? <span>{p.year}</span> : null}
                    </div>
                    <p className="cv-org">
                      {[p.category, p.role, p.client].filter(Boolean).join(' · ')}
                    </p>
                    {p.description ? <p className="cv-prose">{p.description}</p> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>
      ) : null}

      {skills.length ? (
        <Section title="Skills">
          <p className="cv-tags">{skills.join('  ·  ')}</p>
        </Section>
      ) : null}

      {services.length ? (
        <Section title="Services">
          <p className="cv-tags">{services.join('  ·  ')}</p>
        </Section>
      ) : null}

      {awards.length ? (
        <Section title="Awards & recognition">
          <ul className="cv-creds">
            {awards.map((a, i) => (
              <li key={a.id || i} className="cv-block">
                <div className="cv-block__top">
                  <h3>{labelOf(a, 'title', 'name')}</h3>
                  {a.year ? <span>{a.year}</span> : null}
                </div>
                <p className="cv-org">{[labelOf(a, 'issuer', 'org', 'body'), a.note].filter(Boolean).join(' — ')}</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {certificates.length ? (
        <Section title="Certifications">
          <ul className="cv-creds">
            {certificates.map((c, i) => (
              <li key={c.id || i} className="cv-block">
                <div className="cv-block__top">
                  <h3>{labelOf(c, 'title', 'name')}</h3>
                  <span className="cv-kind">{kindOf(c)}</span>
                </div>
                <p className="cv-org">
                  {[labelOf(c, 'issuer', 'org') || null, c.year ? `Issued ${c.year}` : null]
                    .filter(Boolean)
                    .join('  ·  ')}
                </p>
                {c.preview_url ? <img src={c.preview_url} alt="" className="cv-thumb cv-thumb--cred" /> : null}
                {c.credential_id ? <p className="cv-id">Credential ID {c.credential_id}</p> : null}
                {c.expires_on ? <p className="cv-id">Expires {c.expires_on}</p> : null}
                <p className="cv-verify">
                  {c.hub_protected
                    ? 'Document stored in Pinit vault — not independently verified by Pinit.'
                    : 'Issuer credential — not independently verified by Pinit.'}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {licenses.length ? (
        <Section title="Licenses">
          <ul className="cv-creds">
            {licenses.map((c, i) => (
              <li key={c.id || i} className="cv-block cv-license">
                <p className="cv-kicker">Professional license</p>
                <div className="cv-block__top">
                  <h3>{labelOf(c, 'title', 'name')}</h3>
                  {c.year ? <span>{c.year}</span> : null}
                </div>
                <p className="cv-org">{labelOf(c, 'issuer', 'org') || 'Issuer not listed'}</p>
                {c.preview_url ? <img src={c.preview_url} alt="" className="cv-thumb cv-thumb--cred" /> : null}
                {c.credential_id ? <p className="cv-id">License ID {c.credential_id}</p> : null}
                {c.expires_on ? <p className="cv-id">Valid until {c.expires_on}</p> : null}
                <p className="cv-verify">Issuer credential — not independently verified by Pinit unless a Hub verification workflow has run.</p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {collabs.length ? (
        <Section title="Collaborations">
          <p className="cv-tags">{collabs.join('  ·  ')}</p>
        </Section>
      ) : null}

      <footer className="cv-foot">Generated from the public Pinit portfolio{pageUrl ? ` · ${pageUrl}` : ''}.</footer>
    </div>
  );

  return createPortal(doc, document.body);
}

export async function downloadPortfolioCv(portfolio) {
  if (typeof window === 'undefined') return;
  const { jsPDF } = await import('jspdf');
  const name = portfolio?.identity?.name || 'Portfolio';
  const id = portfolio?.identity || {};
  const contact = portfolio?.contact || {};
  const experience = asArray(portfolio?.experience);
  const projects = asArray(portfolio?.projects);
  const skills = flatten(portfolio?.skills, 'name', 'title', 'label');
  const services = flatten(portfolio?.services, 'title', 'name', 'label');
  const awards = asArray(portfolio?.awards);
  const creds = asArray(portfolio?.certifications);
  const licenses = creds.filter((c) => kindOf(c) === 'license');
  const certificates = creds.filter((c) => kindOf(c) !== 'license');
  const collabs = flatten(portfolio?.collaborations, 'with', 'name', 'title');
  const socials = asArray(portfolio?.social_links).filter((s) => s?.url);
  const human = portfolio?.verified?.summary?.avg_human_percent;
  const path = portfolio?.public_path || (portfolio?.slug ? `/p/${portfolio.slug}` : '');
  const pageUrl = path ? `${window.location.origin}${path}` : '';

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  const ink = [22, 24, 29];
  const mute = [90, 97, 106];
  const teal = [14, 122, 95];
  const left = 16;
  const right = 194;
  const width = right - left;
  let y = 18;

  const ensure = (need) => {
    if (y + need > 281) {
      doc.addPage();
      y = 18;
    }
  };

  const section = (title) => {
    ensure(14);
    y += 4;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...teal);
    doc.text(String(title).toUpperCase(), left, y);
    y += 2;
    doc.setDrawColor(216, 221, 217);
    doc.setLineWidth(0.2);
    doc.line(left, y, right, y);
    y += 6;
    doc.setTextColor(...ink);
  };

  const wrap = (text, size = 10, color = ink, leading = 5) => {
    if (!text) return;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...color);
    const lines = doc.splitTextToSize(String(text), width);
    for (const line of lines) {
      ensure(leading);
      doc.text(line, left, y);
      y += leading;
    }
  };

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...teal);
  doc.text('CURRICULUM VITAE', left, y);
  y += 8;
  doc.setFontSize(22);
  doc.setTextColor(...ink);
  doc.text(name, left, y);
  y += 7;
  if (id.headline) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(12);
    doc.setTextColor(58, 64, 72);
    doc.text(id.headline, left, y);
    y += 6;
  }
  const meta = [id.location, contact.email, pageUrl].filter(Boolean).join('  ·  ');
  if (meta) {
    doc.setFontSize(9);
    doc.setTextColor(...mute);
    wrap(meta, 9, mute, 4.5);
  }
  if (socials.length) {
    wrap(socials.map((s) => (s.label ? `${s.label}: ${s.url}` : s.url)).join('  ·  '), 8, mute, 4.2);
  }
  if (Number.isFinite(human)) {
    y += 2;
    wrap(`Pinit human review: ${human}% human, on average, on sealed files`, 8, teal, 4.2);
  }
  y += 2;
  doc.setDrawColor(...teal);
  doc.setLineWidth(0.6);
  doc.line(left, y, right, y);
  y += 6;

  if (id.about) {
    section('Profile');
    wrap(id.about, 10, ink, 5);
  }

  if (experience.length) {
    section('Experience');
    experience.forEach((job) => {
      const org = labelOf(job, 'company', 'org');
      const role = labelOf(job, 'role', 'title');
      const when = [job.start, job.end].filter(Boolean).join(' — ') || job.year || '';
      ensure(16);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...ink);
      doc.text(role || org || 'Role', left, y);
      if (when) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...mute);
        doc.text(String(when), right, y, { align: 'right' });
      }
      y += 5;
      if (org && role) wrap([org, job.location].filter(Boolean).join(' · '), 10, [58, 64, 72], 4.5);
      else if (job.location) wrap(job.location, 10, [58, 64, 72], 4.5);
      if (job.summary) wrap(job.summary, 10, ink, 5);
      y += 3;
    });
  }

  if (projects.length) {
    section('Selected work');
    projects.forEach((p) => {
      ensure(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...ink);
      doc.text(p.title || 'Project', left, y);
      if (p.year) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...mute);
        doc.text(String(p.year), right, y, { align: 'right' });
      }
      y += 5;
      const sub = [p.category, p.role, p.client].filter(Boolean).join(' · ');
      if (sub) wrap(sub, 10, [58, 64, 72], 4.5);
      if (p.description) wrap(p.description, 10, ink, 5);
      y += 3;
    });
  }

  if (skills.length) {
    section('Skills');
    wrap(skills.join('  ·  '), 10, ink, 5);
  }
  if (services.length) {
    section('Services');
    wrap(services.join('  ·  '), 10, ink, 5);
  }
  if (awards.length) {
    section('Awards & recognition');
    awards.forEach((a) => {
      ensure(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...ink);
      doc.text(labelOf(a, 'title', 'name') || 'Award', left, y);
      if (a.year) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(...mute);
        doc.text(String(a.year), right, y, { align: 'right' });
      }
      y += 5;
      wrap([labelOf(a, 'issuer', 'org', 'body'), a.note].filter(Boolean).join(' — '), 10, [58, 64, 72], 4.5);
      y += 2;
    });
  }
  if (certificates.length) {
    section('Certifications');
    certificates.forEach((c) => {
      ensure(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.setTextColor(...ink);
      doc.text(labelOf(c, 'title', 'name') || 'Certificate', left, y);
      y += 5;
      wrap(
        [labelOf(c, 'issuer', 'org'), c.year ? `Issued ${c.year}` : '', c.credential_id ? `ID ${c.credential_id}` : '']
          .filter(Boolean)
          .join('  ·  '),
        9,
        mute,
        4.5,
      );
      wrap(
        c.hub_protected
          ? 'Document stored in Pinit vault — not independently verified by Pinit.'
          : 'Issuer credential — not independently verified by Pinit.',
        8,
        mute,
        4,
      );
      y += 2;
    });
  }
  if (licenses.length) {
    section('Licenses');
    licenses.forEach((c) => {
      ensure(14);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11);
      doc.text(labelOf(c, 'title', 'name') || 'License', left, y);
      y += 5;
      wrap([labelOf(c, 'issuer', 'org'), c.year, c.credential_id ? `License ID ${c.credential_id}` : '', c.expires_on ? `Valid until ${c.expires_on}` : ''].filter(Boolean).join('  ·  '), 9, mute, 4.5);
      wrap('Issuer credential — not independently verified by Pinit unless a Hub verification workflow has run.', 8, mute, 4);
      y += 2;
    });
  }
  if (collabs.length) {
    section('Collaborations');
    wrap(collabs.join('  ·  '), 10, ink, 5);
  }

  y += 6;
  ensure(8);
  doc.setFontSize(8);
  doc.setTextColor(...mute);
  doc.text(`Generated from the public Pinit portfolio${pageUrl ? ` · ${pageUrl}` : ''}.`, left, y);

  const safe = String(name).replace(/[^\w]+/g, '-').replace(/^-|-$/g, '') || 'Portfolio';
  doc.save(`${safe}-CV.pdf`);
}

/** @deprecated use downloadPortfolioCv — kept so older imports do not break */
export const printPortfolioCv = downloadPortfolioCv;

