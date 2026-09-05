import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowUpRight, Award, BadgeCheck, Camera, Download, Globe, ImagePlus,
  Handshake, Languages, Mail, MapPin, Palette, PenTool, Send, Share2, Star, Trophy,
} from 'lucide-react';
import { listingPreviewUrl } from '../../lib/listing-preview.js';
import LicensesCertificates from './LicensesCertificates.jsx';

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

/** The data carries no icon of its own, so services rotate through a set. */
const SERVICE_ICONS = [Camera, PenTool, Palette, Handshake];
const AWARD_ICONS = [Trophy, Star, Award];

/* ── sections ───────────────────────────────────────────────────────────── */

function Hero({ portfolio, onContact }) {
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
            <button type="button" className="pf-btn" onClick={() => window.print()}>
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

function AboutMe({ portfolio }) {
  const id = portfolio.identity || {};
  const available = flatten(portfolio.available_for, 'label', 'name');
  const languages = flatten(portfolio.languages, 'label', 'name');
  const experience = asArray(portfolio.experience);
  const awards = asArray(portfolio.awards);
  const services = flatten(portfolio.services, 'title', 'name', 'label');
  const skills = flatten(portfolio.skills, 'name', 'title', 'label');
  if (!id.about && !experience.length && !awards.length && !services.length && !skills.length) return null;

  return (
    <section className="pf-section pf-about" id="pf-about">
      <div className="pf-about__main">
        <div className="pf-about__story">
          <h2>About</h2>
          {id.about ? <p>{id.about}</p> : null}
          <div className="pf-about__facts">
            {id.location ? (
              <div><MapPin size={14} /><span>Based in</span><b>{id.location}</b></div>
            ) : null}
            {available.length ? (
              <div><Globe size={14} /><span>Available for</span><b>{available.join(' · ')}</b></div>
            ) : null}
            {languages.length ? (
              <div><Languages size={14} /><span>Languages</span><b>{languages.join(', ')}</b></div>
            ) : null}
          </div>
        </div>

        {experience.length ? (
          <div className="pf-about__exp">
            <SectionHead title="Experience" />
            <ol className="pf-timeline">
              {experience.map((job, i) => {
                const org = labelOf(job, 'company', 'org');
                const role = labelOf(job, 'role', 'title');
                return (
                  <li key={job.id || i}>
                    <span className="pf-dot" />
                    <span className="pf-when">
                      {[job.start, job.end].filter(Boolean).join(' — ') || job.year || ''}
                    </span>
                    <div>
                      <b>{org || role}</b>
                      {org && role ? <p>{role}</p> : null}
                      {job.summary ? <p className="pf-dim">{job.summary}</p> : null}
                      {job.location ? <p className="pf-dim">{job.location}</p> : null}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>

      {(services.length || skills.length) ? (
        <div className="pf-about__practice">
          {services.length ? (
            <div>
              <SectionHead title="Services" sub="What I can help you with." />
              <div className="pf-services">
                {services.map((s, i) => {
                  const Icon = SERVICE_ICONS[i % SERVICE_ICONS.length];
                  return (
                    <article key={s} className={`pf-service pf-service--${i % 4}`}>
                      <span className="pf-service__icon"><Icon size={17} /></span>
                      <h3>{s}</h3>
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
          {skills.length ? (
            <div>
              <SectionHead title="Skills" sub="Tools and skills I work with." />
              <div className="pf-tags">{skills.map((s) => <span key={s}>{s}</span>)}</div>
            </div>
          ) : null}
        </div>
      ) : null}

      {awards.length ? (
        <div className="pf-about__awards">
          <SectionHead title="Awards & Recognition" sub="Milestones and achievements." />
          <div className="pf-awards">
            {awards.map((a, i) => {
              const Icon = AWARD_ICONS[i % AWARD_ICONS.length];
              return (
                <article key={a.id || i} className="pf-award">
                  <span className="pf-award__icon"><Icon size={16} /></span>
                  <b>{labelOf(a, 'title', 'name')}</b>
                  {labelOf(a, 'issuer', 'org', 'body')
                    ? <p>{labelOf(a, 'issuer', 'org', 'body')}</p> : null}
                  {a.year ? <span className="pf-year">{a.year}</span> : null}
                </article>
              );
            })}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ShopCollabs({ portfolio, onSelectListing }) {
  const items = asArray(portfolio.marketplace);
  const collabs = flatten(portfolio.collaborations, 'with', 'name', 'title');
  if (!items.length && !collabs.length) return null;

  return (
    <section className="pf-section pf-split" id="pf-shop">
      <div>
        {items.length ? (
          <>
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
          </>
        ) : null}
      </div>

      <div>
        {collabs.length ? (
          <>
            <SectionHead title="Collaborations" sub="People and brands I've worked with." />
            <div className="pf-collabs">
              {collabs.slice(0, 3).map((c) => <span key={c}>{c}</span>)}
              {collabs.length > 3
                ? <span className="pf-collabs__more">+{collabs.length - 3} more</span>
                : null}
            </div>
          </>
        ) : null}
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
    items.push(['about', 'About']);
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
          <Hero portfolio={portfolio} onContact={contact} />
          <FeaturedWork portfolio={portfolio} openCollection={openCollection} sealed={sealed} ownerView={ownerView} />
          <AboutMe portfolio={portfolio} />
          <ShopCollabs portfolio={portfolio} onSelectListing={onSelectListing} />
          <LicensesCertificates
            portfolio={portfolio}
            onShare={onShare}
            name={(id.name || '').split(' ')[0]}
          />
          <Contact portfolio={portfolio} onContact={contact} />
        </>
      )}

      <footer className="pf-foot">
        <span className="pf-logo"><BadgeCheck size={15} /> Pinit</span>
        <span className="pf-foot__mid">Protected · Verified · Creators First</span>
        <span>© {new Date().getFullYear()} {id.name}. Powered by Pinit.</span>
      </footer>
    </article>
  );
}
