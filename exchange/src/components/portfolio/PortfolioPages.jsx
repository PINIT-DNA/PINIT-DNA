import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, BadgeCheck, Download, FileText, Globe, ImagePlus,
  Languages, Mail, MapPin, Send, Share2, X,
} from 'lucide-react';
import { listingPreviewUrl } from '../../lib/listing-preview.js';
import LicensesCertificates from './LicensesCertificates.jsx';
import CVPrintDocument, { printPortfolioCv } from './CVPrintDocument.jsx';

/**
 * The public portfolio.
 *
 * One continuous editorial page. The six headings are the agreed information
 * architecture and they anchor down this scroll rather than splitting it into
 * views — six near-empty pages read as slides, which is what they were.
 *
 * A section with nothing in it is not rendered and not in the nav. A heading
 * that opens onto an empty shelf costs more than it gives, so Shop disappears
 * for someone with nothing listed and Certificates for someone with none.
 * Nothing here invents content to fill a layout.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);

function labelOf(item, ...keys) {
  if (typeof item === 'string') return item;
  for (const k of keys) {
    if (typeof item?.[k] === 'string' && item[k].trim()) return item[k];
  }
  return '';
}

/** Values arrive as strings, as {name}, or grouped as {items:[]}. */
function flatten(list, ...keys) {
  return asArray(list).flatMap((s) => {
    if (typeof s === 'string') return [s];
    if (Array.isArray(s?.items)) return s.items.filter((i) => typeof i === 'string' && i);
    const one = labelOf(s, ...keys);
    return one ? [one] : [];
  }).filter(Boolean);
}

function Media({ src, alt = '', className = '', kind = 'work' }) {
  const [failed, setFailed] = useState(false);
  if (src && !failed) {
    if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
      return <video className={`pf-media ${className}`} src={src} muted playsInline loop />;
    }
    return (
      <img
        className={`pf-media ${className}`}
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
      />
    );
  }
  const letter = (alt || 'P').trim().charAt(0).toUpperCase() || 'P';
  return (
    <span className={`pf-media pf-media--dummy pf-media--${kind} ${className}`} role="img" aria-label={alt || 'Placeholder'}>
      {kind === 'portrait'
        ? <em>{letter}</em>
        : <span>Work in progress</span>}
    </span>
  );
}

function isPdfUrl(src) {
  return /\.pdf(\?|$)/i.test(String(src || ''));
}

function namedItems(list, ...keys) {
  return asArray(list).map((item, i) => {
    if (typeof item === 'string') {
      return { id: `${item}-${i}`, title: item, url: '', logo: '', description: '' };
    }
    const title = labelOf(item, ...keys);
    return {
      id: item.id || `${title}-${i}`,
      title,
      url: item.url || item.website || '',
      logo: item.logo || item.logoUrl || '',
      description: item.description || item.note || '',
    };
  }).filter((item) => item.title);
}

function serviceItems(list) {
  return asArray(list).map((item, i) => {
    if (typeof item === 'string') return { id: `${item}-${i}`, title: item, description: '' };
    const title = labelOf(item, 'title', 'name', 'label');
    return { id: item.id || `${title}-${i}`, title, description: item.description || item.note || '' };
  }).filter((item) => item.title);
}

/* ── sections ───────────────────────────────────────────────────────────── */

function Hero({ portfolio, onContact, onDownloadCv }) {
  const id = portfolio.identity || {};
  const stats = portfolio.verified?.summary;
  const available = flatten(portfolio.available_for, 'label', 'name');
  const languages = flatten(portfolio.languages, 'label', 'name');
  const kicker = asArray(id.categories).join(' · ');

  return (
    <header className="pf-hero" id="pf-overview">
      <div className="pf-hero__inner">
        <div className="pf-portrait">
          <Media src={id.photo_url} alt={id.name} kind="portrait" />
          <span className="pf-portrait__mark">Create<br />Protect<br />Share</span>
        </div>

        <div className="pf-hero__copy">
          {kicker ? <p className="pf-kicker">{kicker}</p> : null}
          <h1 className="pf-name">{id.name}</h1>
          {id.headline ? <p className="pf-tagline">{id.headline}</p> : null}

          <div className="pf-meta">
            {id.location ? <span><MapPin size={13} /> {id.location}</span> : null}
            {available.length
              ? <span><Globe size={13} /> Available for {available.join(', ').toLowerCase()}</span>
              : null}
            {languages.length ? <span><Languages size={13} /> {languages.join(', ')}</span> : null}
          </div>

          {stats?.assets_protected ? (
            <div className="pf-stats">
              <div><b>{stats.assets_protected}</b><span>Assets Protected</span></div>
              {stats.since ? <div><b>{stats.since}</b><span>Protecting Since</span></div> : null}
              {Number.isFinite(stats.avg_human_percent)
                ? <div><b>{stats.avg_human_percent}%</b><span>Human, on Average</span></div>
                : null}
            </div>
          ) : null}

          <div className="pf-hero__cta">
            <button type="button" className="pf-btn" onClick={onDownloadCv}>
              <Download size={14} /> Download CV
            </button>
            <button type="button" className="pf-btn pf-btn--go" onClick={onContact}>
              <Send size={14} /> Let&rsquo;s Collaborate
            </button>
          </div>
        </div>

        {portfolio.contact?.note ? (
          <aside className="pf-quote">
            <p>&ldquo;{String(portfolio.contact.note).split('.')[0].trim()}.&rdquo;</p>
            <span className="pf-quote__sign">{(id.name || '').split(' ')[0]}</span>
          </aside>
        ) : null}
      </div>
    </header>
  );
}

function SectionHead({ title, sub }) {
  return (
    <div className="pf-head">
      <h2>{title}</h2>
      {sub ? <p>{sub}</p> : null}
    </div>
  );
}

function coverOf(collection) {
  if (collection?.cover_url) return collection.cover_url;
  const gallery = asArray(collection?.gallery);
  const first = gallery[0];
  if (typeof first === 'string') return first;
  return first?.url || first?.src || '';
}

function FeaturedWork({ portfolio, openCollection, sealed, ownerView }) {
  const collections = asArray(portfolio.projects);
  if (collections.length === 0) return null;

  return (
    <section className="pf-section" id="pf-work">
      <SectionHead
        title="Featured Work"
        sub="A selection of recent projects across photography, design and brand collaborations."
      />
      <div className="pf-work">
        {collections.map((c) => {
          const tags = [c.category, ...asArray(c.tools)].filter(Boolean).slice(0, 3);
          const cover = coverOf(c);
          const empty = !cover && asArray(c.gallery).length === 0;
          return (
            <article key={c.id} className="pf-card">
              <button type="button" className="pf-card__img" onClick={() => openCollection(c.id)}>
                <Media src={cover} alt={c.title} kind="work" />
                {sealed && c.hub_protected
                  ? <span className="pf-sealed"><BadgeCheck size={11} /> Sealed</span>
                  : null}
                <span className="pf-card__go"><ArrowUpRight size={15} /></span>
                {empty && ownerView ? (
                  <span className="pf-card__add">
                    <ImagePlus size={14} /> Add pictures
                  </span>
                ) : null}
              </button>
              <div className="pf-card__body">
                <div className="pf-card__top">
                  <h3>{c.title}</h3>
                  {c.year ? <span className="pf-year">{c.year}</span> : null}
                </div>
                {tags.length ? (
                  <div className="pf-pills">{tags.map((t) => <span key={t}>{t}</span>)}</div>
                ) : null}
                {c.description ? <p>{c.description}</p> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RecognitionList({ awards, onOpen }) {
  if (!awards.length) return null;
  return (
    <div>
      <p className="pf-about__label">Recognition</p>
      <ul className="pf-about__awards">
        {awards.map((a, i) => {
          const title = labelOf(a, 'title', 'name');
          const issuer = labelOf(a, 'issuer', 'org', 'body');
          const cred = {
            kind: 'Award',
            title,
            issuer,
            year: a.year || '',
            note: a.note || a.description || '',
            credential_id: a.credential_id || '',
            preview_url: a.preview_url || '',
            pinit_verified: false,
          };
          return (
            <li key={a.id || i}>
              {a.year ? <span className="pf-about__year">{a.year}</span> : null}
              <p className="pf-about__org">{title}</p>
              {issuer ? <p className="pf-about__role">{issuer}</p> : null}
              {cred.note ? <p className="pf-about__copy">{cred.note}</p> : null}
              <button type="button" className="pf-about__textlink" onClick={() => onOpen(cred)}>
                View credential
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function NameRow({ title, items }) {
  if (!items.length) return null;
  return (
    <div>
      <p className="pf-about__label">{title}</p>
      <ul className="pf-about__names">
        {items.map((c) => (
          <li key={c.id}>
            {c.logo ? <img src={c.logo} alt="" className="pf-about__logo" /> : null}
            {c.url
              ? <a href={c.url} target="_blank" rel="noreferrer">{c.title}</a>
              : <span>{c.title}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AboutMe({ portfolio, openCollection, onShare }) {
  const id = portfolio.identity || {};
  const available = flatten(portfolio.available_for, 'label', 'name');
  const languages = flatten(portfolio.languages, 'label', 'name');
  const focus = asArray(id.categories).filter((c) => typeof c === 'string' && c.trim());
  const experience = asArray(portfolio.experience);
  const awards = asArray(portfolio.awards);
  const services = serviceItems(portfolio.services);
  const skills = flatten(portfolio.skills, 'name', 'title', 'label');
  const certs = asArray(portfolio.certifications);
  const collabs = namedItems(portfolio.collaborations, 'with', 'name', 'title');
  const clients = namedItems(portfolio.clients, 'name', 'title');
  const human = portfolio.verified?.summary?.avg_human_percent;
  const featured = asArray(portfolio.projects).filter((p) => p.featured).slice(0, 4);
  const [openCred, setOpenCred] = useState(null);

  useEffect(() => {
    if (!openCred) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setOpenCred(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openCred]);

  const hasIntro = Boolean(id.about || id.location || available.length || languages.length || focus.length || Number.isFinite(human));
  if (!hasIntro && !experience.length && !awards.length && !services.length && !skills.length
    && !certs.length && !collabs.length && !clients.length && !featured.length) {
    return null;
  }

  const expertise = skills.length || services.length;
  const pairExp = experience.length && expertise;
  const storyGrid = Boolean(skills.length && services.length && awards.length && !certs.length && experience.length);

  const shareCred = () => {
    if (onShare) { onShare(); return; }
    try { navigator.clipboard.writeText(window.location.href); } catch { /* ignore */ }
  };

  return (
    <section className="pf-about" id="pf-about">
      <div className="pf-about__inner">
        {hasIntro ? (
          <header className="pf-about__intro">
            <p className="pf-about__label">About</p>
            {id.about ? <p className="pf-about__prose">{id.about}</p> : null}
            <dl className="pf-about__meta">
              {id.location ? <div><dt>Based in</dt><dd>{id.location}</dd></div> : null}
              {available.length ? <div><dt>Available for</dt><dd>{available.join(' · ')}</dd></div> : null}
              {focus.length ? <div><dt>Focus</dt><dd>{focus.join(' · ')}</dd></div> : null}
              {languages.length ? <div><dt>Languages</dt><dd>{languages.join(', ')}</dd></div> : null}
              {Number.isFinite(human) ? (
                <div className="pf-about__human">
                  <dt>Pinit human review</dt>
                  <dd>
                    <span className="pf-about__seal" aria-hidden="true">Pinit</span>
                    {human}% human, on average, on sealed files
                  </dd>
                </div>
              ) : null}
            </dl>
          </header>
        ) : null}

        {(experience.length || expertise) ? (
          <div className={storyGrid ? 'pf-about__pair pf-about__quad' : (pairExp ? 'pf-about__pair pf-about__pair--8-4' : 'pf-about__block')}>
            {experience.length ? (
              <div className="pf-about__exp">
                <p className="pf-about__label">Experience</p>
                <ol className="pf-about__timeline">
                  {experience.map((job, i) => {
                    const org = labelOf(job, 'company', 'org');
                    const role = labelOf(job, 'role', 'title');
                    const when = [job.start, job.end].filter(Boolean).join(' — ') || job.year || '';
                    const href = job.url || job.website || '';
                    return (
                      <li key={job.id || i}>
                        {when ? <span className="pf-about__year">{when}</span> : null}
                        {org ? (
                          href
                            ? <a className="pf-about__org" href={href} target="_blank" rel="noreferrer">{org}</a>
                            : <p className="pf-about__org">{org}</p>
                        ) : null}
                        {role ? <p className="pf-about__role">{role}</p> : null}
                        {job.location ? <p className="pf-about__place">{job.location}</p> : null}
                        {job.summary ? <p className="pf-about__copy">{job.summary}</p> : null}
                      </li>
                    );
                  })}
                </ol>
              </div>
            ) : null}

            {expertise && storyGrid ? (
              <>
                {skills.length ? (
                  <div className="pf-about__skillscol">
                    <p className="pf-about__label">Expertise</p>
                    <ul className="pf-about__skills">
                      {skills.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}
                {services.length ? (
                  <div className="pf-about__servicecol">
                    <p className="pf-about__label">Services</p>
                    <ol className="pf-about__services">
                      {services.map((s, i) => (
                        <li key={s.id}>
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <div>
                            <strong>{s.title}</strong>
                            {s.description ? <p>{s.description}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </>
            ) : expertise ? (
              <div className="pf-about__aside">
                {skills.length ? (
                  <div>
                    <p className="pf-about__label">Expertise</p>
                    <ul className="pf-about__skills">
                      {skills.map((s) => <li key={s}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}
                {services.length ? (
                  <div>
                    <p className="pf-about__label">Services</p>
                    <ol className="pf-about__services">
                      {services.map((s, i) => (
                        <li key={s.id}>
                          <span>{String(i + 1).padStart(2, '0')}</span>
                          <div>
                            <strong>{s.title}</strong>
                            {s.description ? <p>{s.description}</p> : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ) : null}
              </div>
            ) : null}

            {awards.length && !certs.length ? (
              <div className="pf-about__recog">
                <RecognitionList awards={awards} onOpen={setOpenCred} />
              </div>
            ) : null}
          </div>
        ) : null}

        {!experience.length && !expertise && awards.length && !certs.length
          ? <RecognitionList awards={awards} onOpen={setOpenCred} />
          : null}

        {featured.length ? (
          <div className="pf-about__block">
            <p className="pf-about__label">Selected work</p>
            <ul className="pf-about__work">
              {featured.map((p) => {
                const thumb = coverOf(p);
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="pf-about__workbtn"
                      onClick={() => openCollection?.(p.id)}
                      aria-label={`Open project ${p.title}`}
                    >
                      <span className="pf-about__workfig">
                        <Media src={thumb} alt="" kind="work" />
                      </span>
                      <span className="pf-about__workcopy">
                        <strong>{p.title}</strong>
                        <em>{[p.category, p.year].filter(Boolean).join(' · ')}</em>
                        {p.description ? <span>{p.description}</span> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}

        {certs.length ? (
          <div className={awards.length ? 'pf-about__pair pf-about__pair--even' : 'pf-about__block'}>
            {awards.length ? <RecognitionList awards={awards} onOpen={setOpenCred} /> : null}

            {certs.length ? (
              <div>
                <p className="pf-about__label">Certificates</p>
                <ul className="pf-about__certs">
                  {certs.map((c, i) => {
                    const title = labelOf(c, 'title', 'name');
                    const issuer = labelOf(c, 'issuer', 'org');
                    const cred = {
                      kind: String(c.kind || 'Certificate'),
                      title,
                      issuer,
                      year: c.year || c.issuedOn || '',
                      expires_on: c.expires_on || '',
                      note: c.note || c.description || '',
                      credential_id: c.credential_id || '',
                      preview_url: c.preview_url || '',
                      verification_url: c.verification_url || '',
                      pinit_verified: Number.isFinite(c.human_percent),
                      hub_protected: Boolean(c.hub_protected),
                    };
                    return (
                      <li key={c.id || i}>
                        <button
                          type="button"
                          className="pf-about__cert"
                          onClick={() => setOpenCred(cred)}
                          aria-label={`${title}${issuer ? `, ${issuer}` : ''}`}
                        >
                          <span className="pf-about__certfig" aria-hidden="true">
                            {cred.preview_url && !isPdfUrl(cred.preview_url)
                              ? <img src={cred.preview_url} alt="" loading="lazy" />
                              : <FileText size={22} />}
                          </span>
                          <span>
                            <strong>{title}</strong>
                            <em>{[issuer, cred.year ? `Issued ${cred.year}` : ''].filter(Boolean).join(' · ')}</em>
                            {cred.credential_id ? <small>ID {cred.credential_id}</small> : null}
                            <small className="pf-about__issuer-note">
                              {cred.pinit_verified
                                ? 'Verified by Pinit HUB'
                                : 'Issuer credential — not independently verified by Pinit'}
                            </small>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {(collabs.length || clients.length) ? (
          <div className={collabs.length && clients.length ? 'pf-about__pair pf-about__pair--even pf-about__people' : 'pf-about__people'}>
            <NameRow title="Collaborations" items={collabs} />
            <NameRow title="Selected clients" items={clients} />
          </div>
        ) : null}
      </div>

      {openCred ? (
        <div
          className="pf-about__overlay"
          role="presentation"
          onClick={() => setOpenCred(null)}
        >
          <div
            className="pf-about__dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pf-about-cred-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button type="button" className="pf-about__close" onClick={() => setOpenCred(null)} aria-label="Close credential">
              <X size={16} />
            </button>
            {openCred.preview_url && !isPdfUrl(openCred.preview_url) ? (
              <img className="pf-about__dialogimg" src={openCred.preview_url} alt="" />
            ) : null}
            <p className="pf-about__label">{openCred.kind}</p>
            <h3 id="pf-about-cred-title">{openCred.title}</h3>
            {openCred.issuer ? <p className="pf-about__role">{openCred.issuer}</p> : null}
            {openCred.year ? <p className="pf-about__place">Issued {openCred.year}</p> : null}
            {openCred.expires_on ? <p className="pf-about__place">Expires {openCred.expires_on}</p> : null}
            {openCred.credential_id ? <p className="pf-about__place">Credential ID {openCred.credential_id}</p> : null}
            {openCred.note ? <p className="pf-about__copy">{openCred.note}</p> : null}
            <p className="pf-about__issuer-note">
              {openCred.pinit_verified
                ? 'Verified by Pinit HUB'
                : 'Issuer credential — not independently verified by Pinit'}
            </p>
            <div className="pf-about__dialogact">
              {openCred.preview_url ? (
                <a className="pf-btn" href={openCred.preview_url} target="_blank" rel="noreferrer">View document</a>
              ) : null}
              {openCred.verification_url ? (
                <a className="pf-btn" href={openCred.verification_url} target="_blank" rel="noreferrer">Open credential</a>
              ) : null}
              <button type="button" className="pf-btn" onClick={shareCred}>Share</button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ShopCollabs({ portfolio, onSelectListing }) {
  const items = asArray(portfolio.marketplace);
  if (!items.length) return null;

  return (
    <section className="pf-section" id="pf-shop">
      <SectionHead
        title="Shop — Available on Pinit Exchange"
        sub="Licensed listings and prints. Each item is sealed and protected."
      />
      <div className="pf-shop">
        {items.map((m) => (
          <button
            key={m.listing_id}
            type="button"
            className="pf-listing"
            onClick={() => onSelectListing?.(m)}
          >
            <Media src={listingPreviewUrl(m)} alt={m.title} />
            <b>{m.title}</b>
            {m.price ? <span>{m.price}</span> : null}
          </button>
        ))}
      </div>
    </section>
  );
}

function Contact({ portfolio, onContact }) {
  const c = portfolio.contact || {};
  return (
    <section className="pf-contact" id="pf-contact">
      <div className="pf-contact__inner">
        <div>
          <h2>Let&rsquo;s talk about the work</h2>
          <p>{c.note || 'Open to freelance projects, creative assignments and collaborations.'}</p>
        </div>
        <div className="pf-contact__act">
          <button type="button" className="pf-btn pf-btn--dark" onClick={onContact}>
            <Send size={14} /> Send a Message
          </button>
          {/* An address appears only when it was deliberately published. */}
          {c.email ? (
            <a className="pf-btn" href={`mailto:${c.email}`}><Mail size={14} /> {c.email}</a>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function CollectionView({ collection, onBack, sealed, ownerView }) {
  const gallery = asArray(collection.gallery).filter((g) => {
    const src = typeof g === 'string' ? g : g?.url || g?.src || '';
    return Boolean(src);
  });
  return (
    <section className="pf-section">
      <button type="button" className="pf-back" onClick={onBack}>← All work</button>
      <h2 className="pf-collection__h">{collection.title}</h2>
      <p className="pf-collection__meta">
        {[collection.category, collection.year, collection.client].filter(Boolean).join(' · ')}
      </p>
      {collection.description ? <p className="pf-collection__desc">{collection.description}</p> : null}
      {gallery.length ? (
        <div className="pf-gallery">
          {gallery.map((g, i) => {
            const src = typeof g === 'string' ? g : g?.url || g?.src || '';
            return (
              <figure key={`${collection.id}-${i}`}>
                <Media src={src} alt={collection.title} kind="work" />
                {sealed ? <figcaption className="pf-sealed"><BadgeCheck size={11} /> Sealed</figcaption> : null}
              </figure>
            );
          })}
        </div>
      ) : ownerView ? (
        <div className="pf-gallery-empty">
          <Media src="" alt={collection.title} kind="work" />
          <p>No pictures in this collection yet. Open Portfolio → Work in Pinit HUB and pick files from your vault.</p>
        </div>
      ) : null}
    </section>
  );
}

/* ── shell ──────────────────────────────────────────────────────────────── */

export default function PortfolioPages({
  portfolio, onSelectListing, onContact, onHire, onShare,
}) {
  const [openId, setOpenId] = useState(null);
  const [active, setActive] = useState('overview');

  const nav = useMemo(() => {
    const items = [['overview', 'Overview']];
    if (asArray(portfolio?.projects).length) items.push(['work', 'Work']);
    if (asArray(portfolio?.marketplace).length) items.push(['shop', 'Shop']);
    const hasAbout = Boolean(portfolio?.identity?.about || portfolio?.identity?.location)
      || asArray(portfolio?.experience).length
      || asArray(portfolio?.awards).length
      || asArray(portfolio?.skills).length
      || asArray(portfolio?.services).length
      || asArray(portfolio?.collaborations).length
      || asArray(portfolio?.clients).length
      || asArray(portfolio?.certifications).length
      || asArray(portfolio?.available_for).length
      || asArray(portfolio?.projects).some((p) => p.featured);
    if (hasAbout) items.push(['about', 'About']);
    const hasCredentials = asArray(portfolio?.certifications).length
      || asArray(portfolio?.awards).length
      || asArray(portfolio?.verified?.entries).length;
    if (hasCredentials) items.push(['certificates', 'Certificates']);
    items.push(['contact', 'Contact']);
    return items;
  }, [portfolio]);

  const scrollTo = (key) => {
    setOpenId(null);
    window.setTimeout(() => {
      document.getElementById(`pf-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setActive(key);
      try { window.history.replaceState(null, '', `#/${key}`); } catch { /* ignore */ }
    }, 0);
  };

  const openCollection = (cid) => {
    setOpenId(cid);
    try { window.location.hash = `#/work/${cid}`; } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  useEffect(() => {
    const read = () => {
      const h = (window.location.hash || '').replace(/^#\/?/, '');
      const [raw, cid] = h.split('/');
      const section = raw === 'verified' ? 'certificates' : raw;
      if (section === 'work' && cid) { setOpenId(cid); return; }
      setOpenId(null);
      if (section && nav.some(([k]) => k === section)) {
        window.setTimeout(() => {
          document.getElementById(`pf-${section}`)?.scrollIntoView({ block: 'start' });
          setActive(section);
        }, 60);
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [nav]);

  // Light the heading the reader is actually on.
  useEffect(() => {
    if (openId) return undefined;
    const ratios = new Map();
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) ratios.set(e.target.id, e.intersectionRatio);
      let best = null; let top = 0;
      for (const [key, r] of ratios) if (r > top) { best = key; top = r; }
      if (best && top > 0) setActive(best.replace(/^pf-/, ''));
    }, { threshold: [0.15, 0.4, 0.75], rootMargin: '-80px 0px -45% 0px' });
    for (const [key] of nav) {
      const el = document.getElementById(`pf-${key}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [nav, openId]);

  if (!portfolio) return null;
  const id = portfolio.identity || {};
  const sealed = Boolean(portfolio.verified?.entries?.length);
  const ownerView = Boolean(portfolio.owner_view);
  const collection = openId
    ? asArray(portfolio.projects).find((c) => String(c.id) === String(openId))
    : null;
  const contact = onContact || onHire;

  return (
    <article className={`pf pf-theme-${portfolio.theme || 'editorial'}`}>
      <nav className="pf-nav">
        <button type="button" className="pf-logo" onClick={() => scrollTo('overview')}>
          <BadgeCheck size={17} /> Pinit
        </button>
        <div className="pf-links">
          {nav.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={!openId && active === key ? 'is-on' : ''}
              onClick={() => scrollTo(key)}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="pf-nav__act">
          {onShare ? (
            <button type="button" className="pf-btn pf-btn--sm" onClick={onShare}>
              <Share2 size={13} /> Share
            </button>
          ) : null}
          <button type="button" className="pf-btn pf-btn--sm pf-btn--dark" onClick={contact}>
            <BadgeCheck size={13} /> Connect
          </button>
        </div>
      </nav>

      {collection ? (
        <CollectionView collection={collection} onBack={() => scrollTo('work')} sealed={sealed} ownerView={ownerView} />
      ) : (
        <>
          <Hero
            portfolio={portfolio}
            onContact={contact}
            onDownloadCv={() => printPortfolioCv(portfolio)}
          />
          <FeaturedWork portfolio={portfolio} openCollection={openCollection} sealed={sealed} ownerView={ownerView} />
          <AboutMe portfolio={portfolio} openCollection={openCollection} onShare={onShare} />
          <ShopCollabs portfolio={portfolio} onSelectListing={onSelectListing} />
          <LicensesCertificates
            portfolio={portfolio}
            onShare={onShare}
            name={(id.name || '').split(' ')[0]}
          />
          <Contact portfolio={portfolio} onContact={contact} />
        </>
      )}

      <CVPrintDocument portfolio={portfolio} />

      <footer className="pf-foot">
        <span className="pf-logo"><BadgeCheck size={15} /> Pinit</span>
        <span className="pf-foot__mid">Protected · Verified · Creators First</span>
        <span>© {new Date().getFullYear()} {id.name}. Powered by Pinit.</span>
      </footer>
    </article>
  );
}
