import React, { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, MapPin } from 'lucide-react';
import { listingPreviewUrl } from '../../lib/listing-preview.js';
import VerifiedLedger, { VerifiedStats } from './VerifiedLedger.jsx';

/**
 * The public portfolio, as a site rather than one long scroll.
 *
 * Six headings across the top and everything else nested under them. Six is the
 * limit — past that a nav becomes a menu nobody reads — so Awards, Exhibitions,
 * Services, Clients and Testimonials all sit inside About, and Videos sit inside
 * the collection they belong to.
 *
 * A section that would render empty is dropped from the nav entirely. A heading
 * that opens onto nothing costs more than it gives.
 *
 * Built as its own component rather than as changes to PortfolioSite, which is
 * still what the builder's live preview uses.
 */

const asArray = (v) => (Array.isArray(v) ? v : []);

function labelOf(item, ...keys) {
  if (typeof item === 'string') return item;
  for (const k of keys) {
    if (typeof item?.[k] === 'string' && item[k].trim()) return item[k];
  }
  return '';
}

/** Skills arrive as strings, as {name}, or as grouped {items:[]}. */
function flatSkills(skills) {
  return asArray(skills).flatMap((s) => {
    if (typeof s === 'string') return [s];
    if (Array.isArray(s?.items)) return s.items.filter((i) => typeof i === 'string' && i);
    const one = labelOf(s, 'name', 'title', 'label');
    return one ? [one] : [];
  });
}

function Media({ src, alt = '', className = '' }) {
  if (!src) return <span className={`pp-media pp-media--empty ${className}`} />;
  if (/\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return <video className={`pp-media ${className}`} src={src} muted playsInline loop />;
  }
  return <img className={`pp-media ${className}`} src={src} alt={alt} loading="lazy" />;
}

/** Everything with a picture, flattened — what the Overview wall draws. */
function allWork(portfolio) {
  const out = [];
  for (const w of asArray(portfolio.selected_work)) {
    const src = listingPreviewUrl(w) || w.cover_url || w.preview_url || '';
    if (src) out.push({ id: `s-${w.listing_id || w.id || out.length}`, src, title: w.title || '' });
  }
  for (const p of asArray(portfolio.projects)) {
    if (p.cover_url) out.push({ id: `p-${p.id}`, src: p.cover_url, title: p.title || '' });
    for (const [i, g] of asArray(p.gallery).entries()) {
      const src = typeof g === 'string' ? g : g?.url || g?.src || '';
      if (src) out.push({ id: `g-${p.id}-${i}`, src, title: p.title || '' });
    }
  }
  for (const m of asArray(portfolio.marketplace)) {
    const src = listingPreviewUrl(m) || '';
    if (src) out.push({ id: `m-${m.listing_id || out.length}`, src, title: m.title || '' });
  }
  const seen = new Set();
  return out.filter((w) => (seen.has(w.src) ? false : seen.add(w.src)));
}

/* ── pages ─────────────────────────────────────────────────────────────── */

function Overview({ portfolio, work, go, sealed }) {
  // The intro directly above already carries the headline, so an empty wall
  // says what is missing instead of repeating it.
  if (work.length === 0) {
    return (
      <div className="pp-empty">
        <p>No work published yet.</p>
      </div>
    );
  }
  return (
    <div className="pp-wall">
      {work.slice(0, 18).map((w) => (
        <figure key={w.id} className="pp-tile" onClick={() => go('work')}>
          <Media src={w.src} alt={w.title} />
          {/* The seal sits on every image from the first screen, so it reads as
              a property of the work rather than a claim made about it. */}
          {sealed ? <figcaption className="pp-seal"><BadgeCheck size={11} /> Sealed</figcaption> : null}
        </figure>
      ))}
    </div>
  );
}

function Work({ portfolio, work, openCollection }) {
  const collections = asArray(portfolio.projects);

  // No named collections yet — show the work rather than an empty page.
  if (collections.length === 0) {
    return (
      <div className="pp-wall">
        {work.map((w) => (
          <figure key={w.id} className="pp-tile"><Media src={w.src} alt={w.title} /></figure>
        ))}
      </div>
    );
  }

  return (
    <div className="pp-cols">
      {collections.map((c) => (
        <button key={c.id} type="button" className="pp-col" onClick={() => openCollection(c.id)}>
          <Media src={c.cover_url} alt={c.title} />
          <h3>{c.title}</h3>
          <p>
            {[c.category, c.year].filter(Boolean).join(' · ')}
            {asArray(c.gallery).length ? ` · ${asArray(c.gallery).length} pieces` : ''}
          </p>
        </button>
      ))}
    </div>
  );
}

function Collection({ collection, onBack }) {
  const gallery = asArray(collection.gallery);
  return (
    <div className="pp-collection">
      <button type="button" className="pp-back" onClick={onBack}>← All work</button>
      <h2 className="pp-h">{collection.title}</h2>
      <p className="pp-meta">
        {[collection.category, collection.year, collection.client].filter(Boolean).join(' · ')}
      </p>
      {collection.description ? <p className="pp-prose">{collection.description}</p> : null}
      {collection.outcome ? <p className="pp-prose pp-prose--dim">{collection.outcome}</p> : null}

      {asArray(collection.tools).length > 0 && (
        <div className="pp-tags">
          {collection.tools.map((t) => <span key={t}>{t}</span>)}
        </div>
      )}

      {gallery.length > 0 && (
        <div className="pp-wall pp-wall--tight">
          {gallery.map((g, i) => {
            const src = typeof g === 'string' ? g : g?.url || g?.src || '';
            return src ? (
              <figure key={`${collection.id}-${i}`} className="pp-tile">
                <Media src={src} alt={collection.title} />
              </figure>
            ) : null;
          })}
        </div>
      )}

      {collection.hub_protected && (
        <p className="pp-sealed"><BadgeCheck size={13} /> Protected in Pinit HUB</p>
      )}
    </div>
  );
}

function Shop({ portfolio, onSelectListing }) {
  const items = asArray(portfolio.marketplace);
  return (
    <>
      <p className="pp-lead">
        Licensed through Pinit Exchange, sealed in Pinit HUB. Rights and terms are on each listing.
      </p>
      <div className="pp-shop">
        {items.map((m) => (
          <button
            key={m.listing_id}
            type="button"
            className="pp-item"
            onClick={() => onSelectListing?.(m)}
          >
            <Media src={listingPreviewUrl(m)} alt={m.title} />
            <h4>{m.title}</h4>
            {m.price ? <span className="pp-price">{m.price}</span> : null}
          </button>
        ))}
      </div>
    </>
  );
}

function About({ portfolio }) {
  const id = portfolio.identity || {};
  const skills = flatSkills(portfolio.skills);
  const experience = asArray(portfolio.experience);
  const services = asArray(portfolio.services);
  const clients = asArray(portfolio.clients);
  // Awards, certifications and exhibitions are one idea to a reader, so they
  // are one block here rather than three headings that are usually empty.
  const recognition = [...asArray(portfolio.awards), ...asArray(portfolio.certifications)];
  const testimonials = asArray(portfolio.testimonials);

  return (
    <div className="pp-about">
      <div className="pp-portrait">
        {id.photo_url
          ? <Media src={id.photo_url} alt={id.name} />
          : <span className="pp-portrait__letter">{(id.name || 'C')[0]}</span>}
      </div>

      <div className="pp-bio">
        <h2 className="pp-name">{id.name}</h2>
        {asArray(id.categories).length > 0 && (
          <p className="pp-role">{id.categories.join(' · ')}</p>
        )}
        {id.headline ? <p className="pp-prose">{id.headline}</p> : null}
        {id.about ? <p className="pp-prose">{id.about}</p> : null}

        <div className="pp-facts">
          {id.location ? (
            <div><span>Based in</span><b><MapPin size={11} /> {id.location}</b></div>
          ) : null}
          {portfolio.verified?.summary?.since ? (
            <div><span>Protecting since</span><b>{portfolio.verified.summary.since}</b></div>
          ) : id.creator_since ? (
            <div><span>Creating since</span><b>{id.creator_since}</b></div>
          ) : null}
          {asArray(portfolio.available_for).length > 0 ? (
            <div>
              <span>Available for</span>
              <b>{portfolio.available_for.map((a) => labelOf(a, 'label', 'name')).filter(Boolean).join(' · ')}</b>
            </div>
          ) : null}
        </div>

        <div className="pp-two">
          {experience.length > 0 && (
            <section>
              <p className="pp-label">Experience</p>
              <div className="pp-rows">
                {experience.map((job, i) => (
                  <div key={job.id || i} className="pp-row">
                    <span className="pp-yr">
                      {[job.start, job.end].filter(Boolean).join(' — ') || job.year || ''}
                    </span>
                    <div>
                      <b>{labelOf(job, 'company', 'title', 'role') || 'Role'}</b>
                      {job.role && job.company ? <p>{job.role}</p> : null}
                      {job.summary ? <p>{job.summary}</p> : null}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            {skills.length > 0 && (
              <>
                <p className="pp-label">Skills</p>
                <div className="pp-tags">{skills.map((s) => <span key={s}>{s}</span>)}</div>
              </>
            )}
            {services.length > 0 && (
              <>
                <p className="pp-label pp-label--gap">Services</p>
                <div className="pp-tags">
                  {services.map((s, i) => (
                    <span key={i}>{labelOf(s, 'title', 'name', 'label') || 'Service'}</span>
                  ))}
                </div>
              </>
            )}
            {clients.length > 0 && (
              <>
                <p className="pp-label pp-label--gap">Clients</p>
                <div className="pp-tags">
                  {clients.map((c, i) => (
                    <span key={i}>{labelOf(c, 'name', 'title', 'client') || 'Client'}</span>
                  ))}
                </div>
              </>
            )}
            {recognition.length > 0 && (
              <>
                <p className="pp-label pp-label--gap">Recognition</p>
                <div className="pp-rows">
                  {recognition.map((r, i) => (
                    <div key={i} className="pp-row">
                      <span className="pp-yr">{r.year || ''}</span>
                      <div>
                        <b>{labelOf(r, 'title', 'name', 'award') || 'Recognition'}</b>
                        {r.issuer || r.body ? <p>{r.issuer || r.body}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </section>
        </div>

        {testimonials.length > 0 && (
          <section>
            <p className="pp-label pp-label--gap">What clients say</p>
            <div className="pp-quotes">
              {testimonials.slice(0, 4).map((t, i) => (
                <blockquote key={i}>
                  <p>{t.comment || t.quote || t.body}</p>
                  <cite>{t.buyer_name || t.author || 'Client'}</cite>
                </blockquote>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

function Contact({ portfolio, onContact }) {
  const c = portfolio.contact || {};
  const cta = portfolio.cta || {};
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [body, setBody] = useState('');

  const submit = (e) => {
    e.preventDefault();
    // Hand off to whatever the host page already does for contact — a mail
    // client when an address is published, the Pinit route otherwise. The form
    // exists so the visitor knows what to say, not to invent a second inbox.
    if (c.email) {
      const subject = `Project with ${portfolio.identity?.name || 'you'}`;
      window.location.href =
        `mailto:${c.email}?subject=${encodeURIComponent(subject)}`
        + `&body=${encodeURIComponent(`${body}\n\n— ${name} (${email})`)}`;
      return;
    }
    onContact?.();
  };
  return (
    <div className="pp-contact">
      <div>
        <h2 className="pp-h">Let's talk about the work</h2>
        <p className="pp-prose">
          {c.note || `Work with ${portfolio.identity?.name} on a commission, collaboration or licence.`}
        </p>
        <div className="pp-facts">
          {portfolio.identity?.location ? (
            <div><span>Based in</span><b>{portfolio.identity.location}</b></div>
          ) : null}
          {asArray(portfolio.available_for).length > 0 ? (
            <div>
              <span>Available for</span>
              <b>{portfolio.available_for.map((a) => labelOf(a, 'label', 'name')).filter(Boolean).join(' · ')}</b>
            </div>
          ) : null}
        </div>
      </div>
      {/* A form, not a published address. contact_email stays private unless
          the person chose to publish it, which is the same rule the creator
          directory follows. */}
      <form className="pp-form" onSubmit={submit}>
        <label>
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          <span>What do you need?</span>
          <textarea rows={4} value={body} onChange={(e) => setBody(e.target.value)} required />
        </label>
        <button type="submit" className="pp-btn pp-btn--solid">
          {cta.primary && cta.primary !== 'Connect' ? cta.primary : 'Send message'}
        </button>
        {c.email ? <a className="pp-quiet" href={`mailto:${c.email}`}>or email {c.email}</a> : null}
      </form>
    </div>
  );
}

/* ── shell ─────────────────────────────────────────────────────────────── */

export default function PortfolioPages({
  portfolio, onNavigate, onSelectListing, onContact, onHire,
}) {
  /**
   * One continuous page, not six.
   *
   * The six headings are the information architecture, but they are anchors
   * down a single scroll rather than separate views. A wall-only landing page
   * works for someone with three hundred photographs; with a handful it reads
   * as a stack of near-empty slides, which is exactly what it looked like.
   *
   * A collection and a single piece are the exception — those are genuinely
   * different content, so they replace the page and have their own address.
   */
  const [openId, setOpenId] = useState(null);
  const [active, setActive] = useState('overview');

  const work = useMemo(() => allWork(portfolio || {}), [portfolio]);

  // A heading only exists when it leads somewhere. Shop disappears entirely
  // for someone with nothing listed — an empty shop is worse than no shop.
  const nav = useMemo(() => {
    const items = [['overview', 'Overview'], ['work', 'Work']];
    if (asArray(portfolio?.marketplace).length > 0) items.push(['shop', 'Shop']);
    items.push(['about', 'About']);
    if (portfolio?.verified?.entries?.length) items.push(['verified', 'Verified']);
    items.push(['contact', 'Contact']);
    return items;
  }, [portfolio]);

  const scrollTo = (key) => {
    const el = document.getElementById(`pp-${key}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(key);
    try { window.history.replaceState(null, '', `#/${key}`); } catch { /* ignore */ }
  };

  const openCollection = (id) => {
    setOpenId(id);
    try { window.location.hash = `#/work/${id}`; } catch { /* ignore */ }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const closeCollection = () => {
    setOpenId(null);
    try { window.location.hash = '#/work'; } catch { /* ignore */ }
  };

  // A shared link still lands where it says it will.
  useEffect(() => {
    const read = () => {
      const h = (window.location.hash || '').replace(/^#\/?/, '');
      const [section, id] = h.split('/');
      if (section === 'work' && id) { setOpenId(id); return; }
      setOpenId(null);
      if (section && nav.some(([k]) => k === section)) {
        // Wait for layout before measuring the anchor.
        window.setTimeout(() => {
          const el = document.getElementById(`pp-${section}`);
          if (el) el.scrollIntoView({ block: 'start' });
          setActive(section);
        }, 60);
      }
    };
    read();
    window.addEventListener('hashchange', read);
    return () => window.removeEventListener('hashchange', read);
  }, [nav]);

  // Light the heading you are actually looking at.
  useEffect(() => {
    if (openId) return undefined;
    const seen = new Map();
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) seen.set(e.target.id, e.intersectionRatio);
        let best = null; let bestRatio = 0;
        for (const [id, ratio] of seen) {
          if (ratio > bestRatio) { best = id; bestRatio = ratio; }
        }
        if (best && bestRatio > 0) setActive(best.replace(/^pp-/, ''));
      },
      { threshold: [0.15, 0.4, 0.75], rootMargin: '-72px 0px -45% 0px' },
    );
    for (const [key] of nav) {
      const el = document.getElementById(`pp-${key}`);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [nav, openId]);

  if (!portfolio) return null;
  const identity = portfolio.identity || {};
  const collection = openId
    ? asArray(portfolio.projects).find((c) => String(c.id) === String(openId))
    : null;
  const sealed = Boolean(portfolio.verified?.entries?.length);
  const has = (key) => nav.some(([k]) => k === key);

  return (
    <article className={`pp pp-theme-${portfolio.theme || 'editorial'}`}>
      <header className="pp-nav">
        <button type="button" className="pp-logo" onClick={() => scrollTo('overview')}>
          {identity.name}
        </button>
        <nav className="pp-links">
          {nav.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`${!openId && active === key ? 'is-on' : ''}${key === 'verified' ? ' is-seal' : ''}`}
              onClick={() => { setOpenId(null); window.setTimeout(() => scrollTo(key), 0); }}
            >
              {key === 'verified' ? <><BadgeCheck size={13} /> {label}</> : label}
            </button>
          ))}
        </nav>
      </header>

      {/* A collection replaces the scroll — it is a different thing to read. */}
      {collection ? (
        <div className="pp-body pp-body--wide">
          <Collection collection={collection} onBack={closeCollection} />
        </div>
      ) : (
        <>
          <section id="pp-overview" className="pp-body pp-body--wide pp-section">
            <div className="pp-intro">
              <h1 className="pp-name">{identity.name}</h1>
              {asArray(identity.categories).length > 0 && (
                <p className="pp-role">{identity.categories.join(' · ')}</p>
              )}
              {identity.headline ? <p className="pp-prose">{identity.headline}</p> : null}
              <VerifiedStats verified={portfolio.verified} compact />
            </div>
            <Overview portfolio={portfolio} work={work} go={() => scrollTo('work')} sealed={sealed} />
          </section>

          <section id="pp-work" className="pp-body pp-body--wide pp-section">
            <h2 className="pp-section__h">Work</h2>
            <Work portfolio={portfolio} work={work} openCollection={openCollection} />
          </section>

          {has('shop') && (
            <section id="pp-shop" className="pp-body pp-body--wide pp-section">
              <h2 className="pp-section__h">Shop</h2>
              <Shop portfolio={portfolio} onSelectListing={onSelectListing} />
            </section>
          )}

          <section id="pp-about" className="pp-body pp-section">
            <h2 className="pp-section__h">About</h2>
            <About portfolio={portfolio} />
          </section>

          {has('verified') && (
            <section id="pp-verified" className="pp-body pp-section">
              <VerifiedLedger verified={portfolio.verified} name={(identity.name || '').split(' ')[0]} />
            </section>
          )}

          <section id="pp-contact" className="pp-body pp-section pp-section--last">
            <Contact portfolio={portfolio} onContact={onContact || onHire} />
          </section>
        </>
      )}
    </article>
  );
}
