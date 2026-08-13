import React from 'react';
import { BadgeCheck, Mail, MapPin, ShieldCheck, Star } from 'lucide-react';
import { listingPreviewUrl } from '../../lib/listing-preview.js';
import { isVideoListing } from '../../lib/media.js';

export function WorkMedia({ item, className = '' }) {
  const src = listingPreviewUrl(item) || item?.cover_url || item?.preview_url || '';
  if (!src) return <div className={`ps-media ps-media--empty ${className}`} />;
  if (isVideoListing(item) || /\.(mp4|webm|mov)(\?|$)/i.test(src)) {
    return <video className={`ps-media ${className}`} src={src} muted playsInline />;
  }
  return <img className={`ps-media ${className}`} src={src} alt={item?.title || ''} />;
}

function show(portfolio, key) {
  return portfolio?.sections?.[key] !== false;
}

function serviceTitle(item) {
  return typeof item === 'string' ? item : item?.title || '';
}

function clientName(item) {
  return typeof item === 'string' ? item : item?.name || '';
}

export default function PortfolioSite({
  portfolio,
  compact = false,
  onNavigate,
  onSelectListing,
  onContact,
  onHire,
  onShare,
}) {
  if (!portfolio) return null;
  const identity = portfolio.identity || {};
  const trust = portfolio.trust || null;
  const cover = identity.cover_url || listingPreviewUrl(portfolio.selected_work?.[0]) || '';
  const first = (identity.name || 'Creator').split(' ')[0];
  const skillLabels = (portfolio.skills || []).flatMap((s) => {
    if (typeof s === 'string') return [s];
    if (Array.isArray(s?.items)) return s.items.filter((item) => typeof item === 'string' && item);
    if (typeof s?.name === 'string') return [s.name];
    if (typeof s?.title === 'string') return [s.title];
    return [];
  });

  return (
    <article className={`ps ${compact ? 'ps--compact' : ''}`}>
      <header className="ps-hero">
        {cover ? <div className="ps-hero__photo" style={{ backgroundImage: `url(${cover})` }} /> : <div className="ps-hero__photo ps-hero__photo--plain" />}
        <div className="ps-hero__veil" />
        <div className="ps-hero__copy">
          {identity.photo_url ? (
            <img className="ps-avatar" src={identity.photo_url} alt="" />
          ) : (
            <div className="ps-avatar ps-avatar--letter">{(identity.name || 'C')[0]}</div>
          )}
          <p className="ps-kicker">{(identity.categories || []).slice(0, 3).join(' · ') || 'Creator'}</p>
          <h1>{identity.name}</h1>
          {identity.headline ? <p className="ps-headline">{identity.headline}</p> : null}
          {identity.location ? (
            <p className="ps-place"><MapPin size={13} /> {identity.location}</p>
          ) : null}
          {!compact && (
            <div className="ps-actions">
              <button type="button" className="ps-btn ps-btn--solid" onClick={onContact}><Mail size={15} /> Contact</button>
              <button type="button" className="ps-btn" onClick={onHire}>Hire</button>
              <button type="button" className="ps-btn" onClick={() => document.getElementById('ps-work')?.scrollIntoView({ behavior: 'smooth' })}>View work</button>
            </div>
          )}
          {trust?.identity_verified && (
            <p className="ps-verified"><BadgeCheck size={14} /> Pinit Verified</p>
          )}
        </div>
      </header>

      {show(portfolio, 'about') && identity.about && (
        <section className="ps-block">
          <p className="ps-label">About</p>
          <h2>The story behind the work</h2>
          <p className="ps-prose">{identity.about}</p>
        </section>
      )}

      {show(portfolio, 'featured') && (portfolio.selected_work || []).length > 0 && (
        <section className="ps-block" id="ps-work">
          <p className="ps-label">Selected work</p>
          <h2>Pieces that define {first}</h2>
          <div className="ps-editorial">
            {portfolio.selected_work.map((item, i) => (
              <button
                key={item.listing_id}
                type="button"
                className={`ps-shot ${i === 0 ? 'ps-shot--lead' : ''}`}
                onClick={() => onSelectListing?.(item.listing_id)}
              >
                <WorkMedia item={item} />
                <span>
                  <strong>{item.title}</strong>
                  <em>{item.vertical === 'images' ? 'Photography' : item.vertical}</em>
                </span>
              </button>
            ))}
          </div>
        </section>
      )}

      {show(portfolio, 'projects') && (portfolio.projects || []).length > 0 && (
        <section className="ps-block">
          <p className="ps-label">Projects</p>
          <h2>Case studies</h2>
          <div className="ps-cases">
            {portfolio.projects.map((project) => (
              <article key={project.id || project.title} className="ps-case">
                <div className="ps-case__visual">
                  <WorkMedia item={project.items?.[0] || { preview_url: project.cover_url, title: project.title }} />
                </div>
                <div className="ps-case__copy">
                  <p className="ps-label">{[project.category, project.year].filter(Boolean).join(' · ')}</p>
                  <h3>{project.title}</h3>
                  {project.description ? <p>{project.description}</p> : null}
                  <p className="ps-muted">
                    {[project.client && `Client: ${project.client}`, project.role, `${project.items?.length || 0} works`].filter(Boolean).join(' · ')}
                  </p>
                  {(project.tools || []).length > 0 && (
                    <div className="ps-pills">{project.tools.map((t) => <span key={t}>{t}</span>)}</div>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      {show(portfolio, 'experience') && (portfolio.experience || []).length > 0 && (
        <section className="ps-block">
          <p className="ps-label">Experience</p>
          <div className="ps-exp">
            {portfolio.experience.map((job, i) => (
              <article key={`${job.title}-${i}`}>
                <h3>{job.title}</h3>
                <p>{[job.org, job.start && `${job.start}${job.end ? ` — ${job.end}` : ' — Present'}`].filter(Boolean).join(' · ')}</p>
                {job.summary ? <p className="ps-muted">{job.summary}</p> : null}
              </article>
            ))}
          </div>
        </section>
      )}

      {show(portfolio, 'skills') && skillLabels.length > 0 && (
        <section className="ps-block">
          <p className="ps-label">Expertise</p>
          <div className="ps-pills">{skillLabels.map((s) => <span key={s}>{s}</span>)}</div>
        </section>
      )}

      {(show(portfolio, 'certifications') || show(portfolio, 'awards')) && (
        ((portfolio.certifications || []).length > 0 || (portfolio.awards || []).length > 0) && (
          <section className="ps-block">
            <p className="ps-label">Credentials</p>
            <div className="ps-creds">
              {(portfolio.certifications || []).map((c, i) => (
                <article key={`c-${i}`}>
                  <h3>{c.title}</h3>
                  <p>{[c.issuer || c.org, c.year].filter(Boolean).join(' · ')}</p>
                  <em>{c.verified ? 'Pinit verified' : 'Provided by creator'}</em>
                </article>
              ))}
              {(portfolio.awards || []).map((a, i) => (
                <article key={`a-${i}`}>
                  <h3>{a.title}</h3>
                  <p>{[a.org || a.issuer, a.year].filter(Boolean).join(' · ')}</p>
                </article>
              ))}
            </div>
          </section>
        )
      )}

      {show(portfolio, 'clients') && (portfolio.clients || []).length > 0 && (
        <section className="ps-block">
          <p className="ps-label">Clients & collaborations</p>
          <div className="ps-pills">{portfolio.clients.map((c) => <span key={clientName(c)}>{clientName(c)}</span>)}</div>
        </section>
      )}

      {show(portfolio, 'testimonials') && portfolio.review_summary && (
        <section className="ps-block">
          <p className="ps-label">What clients say</p>
          <p className="ps-muted"><Star size={13} /> {portfolio.review_summary.average} · {portfolio.review_summary.count} verified Pinit reviews</p>
          <div className="ps-quotes">
            {(portfolio.testimonials || []).slice(0, 4).map((t, i) => (
              <blockquote key={i}>
                <p>“{t.comment}”</p>
                <cite>— {t.buyer_name}</cite>
              </blockquote>
            ))}
          </div>
        </section>
      )}

      {show(portfolio, 'services') && ((portfolio.services || []).length > 0 || (portfolio.available_for || []).length > 0) && (
        <section className="ps-block">
          <p className="ps-label">Services</p>
          <h2>How we can work together</h2>
          <div className="ps-services">
            {(portfolio.services || []).map((s, i) => (
              <article key={serviceTitle(s) + i}>
                <h3>{serviceTitle(s)}</h3>
                {s?.description ? <p>{s.description}</p> : null}
                {s?.price ? <em>{s.price}</em> : null}
              </article>
            ))}
          </div>
          {(portfolio.available_for || []).length > 0 && (
            <ul className="ps-avail">{portfolio.available_for.map((item) => <li key={item}>{item}</li>)}</ul>
          )}
        </section>
      )}

      {show(portfolio, 'marketplace') && (portfolio.marketplace || []).length > 0 && (
        <section className="ps-block">
          <p className="ps-label">Available for licensing</p>
          <h2>On Pinit Exchange</h2>
          <div className="ps-license">
            {portfolio.marketplace.slice(0, 4).map((item) => (
              <button key={item.listing_id} type="button" onClick={() => onSelectListing?.(item.listing_id)}>
                <WorkMedia item={item} />
                <strong>{item.title}</strong>
                <span>${Number(item.price_personal || item.price_commercial || 0).toFixed(0)}</span>
              </button>
            ))}
          </div>
          {!compact && (
            <button type="button" className="ps-btn" onClick={() => onNavigate?.('marketplace')}>View all work</button>
          )}
        </section>
      )}

      {show(portfolio, 'trust') && trust && (
        <section className="ps-block ps-trust">
          <ShieldCheck size={18} />
          <div>
            <p className="ps-label">Protected & verified through Pinit</p>
            <p>
              Identity verified · {trust.live_listings} protected listings · {trust.licensed_transactions} licensed works
              {trust.creator_since ? ` · Creating since ${trust.creator_since}` : ''}
            </p>
          </div>
        </section>
      )}

      {show(portfolio, 'contact') && !compact && (
        <section className="ps-block ps-close">
          <h2>Let’s make something</h2>
          <p>{portfolio.contact?.note || `Work with ${identity.name} on a commission, collaboration, or license.`}</p>
          <div className="ps-actions">
            <button type="button" className="ps-btn ps-btn--solid" onClick={onContact}>Contact</button>
            <button type="button" className="ps-btn" onClick={onHire}>Hire creator</button>
            {onShare ? <button type="button" className="ps-btn" onClick={onShare}>Share</button> : null}
          </div>
        </section>
      )}
    </article>
  );
}
