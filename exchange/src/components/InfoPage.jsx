import React from 'react';
import { ChevronRight } from 'lucide-react';

export default function InfoPage({
  crumbs = [],
  eyebrow,
  title,
  subtitle,
  onNavigate,
  children,
  related = [],
  primaryCta,
  secondaryCta,
}) {
  return (
    <article className="info-page">
      <nav className="info-crumb" aria-label="Breadcrumb">
        <ol>
          <li>
            <button type="button" onClick={() => onNavigate?.('home')}>Home</button>
          </li>
          {crumbs.map((c, i) => (
            <li key={`${c.label}-${i}`}>
              <ChevronRight size={12} aria-hidden />
              {c.page && i < crumbs.length - 1 ? (
                <button type="button" onClick={() => onNavigate?.(c.page)}>{c.label}</button>
              ) : (
                <span aria-current="page">{c.label}</span>
              )}
            </li>
          ))}
        </ol>
      </nav>

      <header className="info-hero">
        {eyebrow && <p className="info-hero__eyebrow">{eyebrow}</p>}
        <h1>{title}</h1>
        {subtitle && <p className="info-hero__sub">{subtitle}</p>}
      </header>

      <div className="info-body">{children}</div>

      {related.length > 0 && (
        <section className="info-related" aria-labelledby="info-related-heading">
          <h2 id="info-related-heading">Continue</h2>
          <div className="info-related__grid">
            {related.map((item) => (
              <button
                key={item.page}
                type="button"
                className="info-related__card"
                onClick={() => onNavigate?.(item.page)}
              >
                <strong>{item.label}</strong>
                {item.desc && <span>{item.desc}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {(primaryCta || secondaryCta) && (
        <div className="info-cta">
          {primaryCta && (
            <button type="button" className="btn-primary" onClick={primaryCta.onClick}>
              {primaryCta.label}
            </button>
          )}
          {secondaryCta && (
            <button type="button" className="btn-secondary" onClick={secondaryCta.onClick}>
              {secondaryCta.label}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function InfoCards({ items }) {
  return (
    <div className="info-cards">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <article key={item.title} className="info-card">
            {Icon && <Icon size={18} aria-hidden />}
            <h3>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        );
      })}
    </div>
  );
}

export function InfoSteps({ steps }) {
  return (
    <ol className="info-steps">
      {steps.map((step, i) => (
        <li key={step.title}>
          <span className="info-steps__n" aria-hidden>{String(i + 1).padStart(2, '0')}</span>
          <div>
            <h3>{step.title}</h3>
            <p>{step.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function FaqList({ items }) {
  return (
    <div className="info-faq">
      {items.map((item) => (
        <details key={item.q} className="info-faq__item">
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}
