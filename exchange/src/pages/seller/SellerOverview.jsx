import React, { useMemo } from 'react';
import {
  ArrowRight, ArrowUpRight, Images, ListTree, BadgeDollarSign, Briefcase,
  Eye, ShieldCheck, Sparkles, TrendingUp,
} from 'lucide-react';
import StudioPage from '../../components/workspace/StudioPage.jsx';
import DiscoverHeroArt from '../../components/DiscoverHeroArt.jsx';
import useSellerDesk from '../../hooks/useSellerDesk.js';
import { formatMoney } from '../../lib/money.js';
import { listingTitleMap } from '../../lib/seller-workspace.js';

/**
 * Seller Overview.
 *
 * The desk endpoint already returns revenue, views, saves, listing counts and
 * open requirements. The page used to fetch all of that and show none of it —
 * a recent-sales list and four navigation buttons. This surfaces it.
 *
 * The page is built around the journey a seller actually takes:
 *
 *   protect in HUB → list on Exchange → get discovered → sale sealed → paid
 *
 * That sequence is the spine of the screen, because a seller's real question is
 * never "what are my numbers" but "where am I stuck, and what do I do next".
 * When a stage has nothing in it, we say what to do rather than showing a zero
 * and leaving them to work it out.
 */

const nf = new Intl.NumberFormat();

export default function SellerOverview({ user, onNavigate, onOpenListFromHub }) {
  const { sales, listings, metrics, requirements, loading } = useSellerDesk(user);
  const titles = listingTitleMap(listings);

  const stats = useMemo(() => {
    const live = metrics.active_listings_count ?? 0;
    const drafts = listings.filter(
      (l) => l.status && l.status !== 'live' && l.status !== 'published',
    ).length;
    return {
      live,
      drafts,
      total: listings.length,
      views: metrics.total_views ?? 0,
      saves: metrics.total_saves ?? 0,
      salesCount: metrics.sealed_sales_count ?? sales.length,
      gross: metrics.total_gross_revenue ?? 0,
      net: metrics.total_net_revenue ?? 0,
      openBriefs: requirements.length,
    };
  }, [listings, metrics, requirements, sales.length]);

  /**
   * Which stage the seller is actually at.
   *
   * We highlight the first stage that is not yet satisfied, so the page always
   * points at one next action instead of four equal options.
   */
  const stage = stats.total === 0 ? 0
    : stats.live === 0 ? 1
    : stats.views === 0 ? 2
    : stats.salesCount === 0 ? 3
    : 4;

  if (loading) {
    return <div className="studio-mod studio-mod--loading">Loading seller overview…</div>;
  }

  const journey = [
    {
      key: 'listed', icon: Images, label: 'Listed',
      value: stats.total === 0 ? '—' : nf.format(stats.total),
      hint: stats.total === 0 ? 'Nothing listed yet' : `${stats.live} live`,
      go: 'seller_assets',
    },
    {
      key: 'live', icon: ListTree, label: 'Published',
      value: nf.format(stats.live),
      hint: stats.drafts > 0 ? `${stats.drafts} still draft` : 'All published',
      go: 'seller_listings',
    },
    {
      key: 'seen', icon: Eye, label: 'Views',
      value: nf.format(stats.views),
      hint: stats.saves > 0 ? `${nf.format(stats.saves)} saved` : 'No saves yet',
      go: 'seller_listings',
    },
    {
      key: 'sold', icon: ShieldCheck, label: 'Licences sealed',
      value: nf.format(stats.salesCount),
      hint: stats.salesCount === 0 ? 'No sales yet' : 'Sealed in Pinit HUB',
      go: 'seller_sales',
    },
  ];

  return (
    <StudioPage
      title="Overview"
      actions={(
        <button type="button" className="btn-primary" onClick={onOpenListFromHub}>
          List from Pinit HUB
        </button>
      )}
    >
      {/*
        The same hero band the marketplace uses, told from the seller's side.
        Reused rather than rebuilt — one hero, two audiences. It stays compact
        because a seller who is already here does not need the pitch twice.
      */}
      <div className="glass-panel market-hero market-hero--compact so-hero">
        <div className="market-hero__copy">
          <div className="market-hero__badge">
            <ShieldCheck size={16} />
            <span>Protected by Pinit HUB</span>
          </div>
          <h1 className="market-hero__title">Sell the work you already protected</h1>
          <p className="market-hero__sub">
            Anything protected in Pinit HUB can be listed and licensed here. The
            certificate, the protection and the full history stay in HUB.
          </p>
          <div className="market-hero__ctas">
            <button type="button" className="btn-primary" onClick={onOpenListFromHub}>
              List from Pinit HUB
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => onNavigate?.(stats.total > 0 ? 'seller_listings' : 'seller_assets')}
            >
              {stats.total > 0 ? 'View your listings' : 'See your assets'}
            </button>
          </div>
        </div>
        <DiscoverHeroArt />
      </div>

      {/* ── The journey. Four stages, current one lit. ───────────────────── */}
      <section className="so-journey" aria-label="Your selling journey">
        {journey.map((s, i) => {
          const Icon = s.icon;
          const done = i < stage;
          const now = i === stage;
          return (
            <button
              key={s.key}
              type="button"
              className={`so-stage${done ? ' is-done' : ''}${now ? ' is-now' : ''}`}
              onClick={() => onNavigate?.(s.go)}
            >
              <span className="so-stage__top">
                <Icon size={15} />
                <span className="so-stage__label">{s.label}</span>
              </span>
              <span className="so-stage__value">{s.value}</span>
              <span className="so-stage__hint">{s.hint}</span>
            </button>
          );
        })}
      </section>

      {/* ── What to do next. One instruction, not four options. ──────────── */}
      {stage < 4 && (
        <section className="so-next">
          <span className="so-next__icon"><Sparkles size={16} /></span>
          <div className="so-next__body">
            <h3>
              {stage === 0 && 'Bring your first protected asset across'}
              {stage === 1 && 'Publish a listing so buyers can find it'}
              {stage === 2 && 'Your listings are live — nobody has seen them yet'}
              {stage === 3 && 'People are looking. No licence sealed yet'}
            </h3>
            <p>
              {stage === 0 && 'Anything you have protected in Pinit HUB can be listed here. Its certificate and history stay in HUB.'}
              {stage === 1 && `You have ${stats.drafts || stats.total} asset${(stats.drafts || stats.total) === 1 ? '' : 's'} ready. A listing only becomes visible once you publish it.`}
              {stage === 2 && 'Share your portfolio link, or answer an open brief — both bring buyers to your listings.'}
              {stage === 3 && 'Views are turning up but not converting. Check your pricing and licence terms.'}
            </p>
          </div>
          <button
            type="button"
            className="btn-primary so-next__cta"
            onClick={() => (stage === 0 ? onOpenListFromHub?.() : onNavigate?.(stage === 1 ? 'seller_listings' : stage === 2 ? 'seller_opportunities' : 'seller_listings'))}
          >
            {stage === 0 && 'List from Pinit HUB'}
            {stage === 1 && 'Open Listings'}
            {stage === 2 && 'See opportunities'}
            {stage === 3 && 'Review pricing'}
            <ArrowRight size={14} />
          </button>
        </section>
      )}

      <div className="so-grid">
        {/* ── Earnings ─────────────────────────────────────────────────── */}
        <section className="glass-panel so-panel so-earnings">
          <div className="studio-section__head">
            <h2>Earnings</h2>
            <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_earnings')}>
              Open Earnings <ArrowRight size={14} />
            </button>
          </div>

          {stats.salesCount === 0 ? (
            <p className="studio-empty">
              Nothing earned yet. Your first sealed licence will show here, with the
              platform fee separated out.
            </p>
          ) : (
            <>
              <div className="so-money">
                <span className="so-money__label">Yours, after fees</span>
                <span className="so-money__net">{formatMoney(stats.net, 'INR')}</span>
                <span className="so-money__gross">
                  {formatMoney(stats.gross, 'INR')} gross
                  {stats.gross > 0 && (
                    <> · {Math.round(((stats.gross - stats.net) / stats.gross) * 100)}% fee</>
                  )}
                </span>
              </div>
              <div className="so-money__meta">
                <span><TrendingUp size={13} /> {nf.format(stats.salesCount)} licence{stats.salesCount === 1 ? '' : 's'} sealed</span>
              </div>
            </>
          )}
        </section>

        {/* ── Attention: only real, actionable items. ───────────────────── */}
        <section className="glass-panel so-panel">
          <h2>Worth your time</h2>
          <ul className="so-todo">
            {stats.drafts > 0 && (
              <li>
                <button type="button" onClick={() => onNavigate?.('seller_listings')}>
                  <span className="so-todo__n">{stats.drafts}</span>
                  <span>
                    <b>Draft{stats.drafts === 1 ? '' : 's'} not published</b>
                    <em>Buyers cannot see these yet</em>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </li>
            )}
            {stats.openBriefs > 0 && (
              <li>
                <button type="button" onClick={() => onNavigate?.('seller_opportunities')}>
                  <span className="so-todo__n">{stats.openBriefs}</span>
                  <span>
                    <b>Open brief{stats.openBriefs === 1 ? '' : 's'}</b>
                    <em>Buyers asking for work like yours</em>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </li>
            )}
            {stats.saves > 0 && stats.salesCount === 0 && (
              <li>
                <button type="button" onClick={() => onNavigate?.('seller_listings')}>
                  <span className="so-todo__n">{nf.format(stats.saves)}</span>
                  <span>
                    <b>Saved, not bought</b>
                    <em>Interest without a sale — check your pricing</em>
                  </span>
                  <ArrowUpRight size={14} />
                </button>
              </li>
            )}
            {stats.drafts === 0 && stats.openBriefs === 0 && !(stats.saves > 0 && stats.salesCount === 0) && (
              <li className="so-todo__clear">
                <ShieldCheck size={15} />
                <span>Nothing waiting on you.</span>
              </li>
            )}
          </ul>
        </section>
      </div>

      {/* ── Recent sales ───────────────────────────────────────────────── */}
      <section className="glass-panel so-panel so-sales">
        <div className="studio-section__head">
          <h2>Recent sales</h2>
          {sales.length > 0 && (
            <button type="button" className="btn-secondary" onClick={() => onNavigate?.('seller_sales')}>
              Open Sales <ArrowRight size={14} />
            </button>
          )}
        </div>
        {sales.length === 0 ? (
          <p className="studio-empty">
            No sealed licences yet. Every sale is sealed in Pinit HUB, so the buyer
            gets provable rights and you keep the record.
          </p>
        ) : (
          <ul className="so-salelist">
            {sales.slice(0, 6).map((row) => (
              <li key={row.seal_id}>
                <span className="so-salelist__title">
                  {titles.get(row.listing_id) || row.listing_id}
                </span>
                <span className="so-salelist__buyer">{row.buyer_pinit_id || 'Buyer'}</span>
                <span className="so-salelist__price">
                  {formatMoney(row.price_paid || 0, row.currency)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Jump to. Kept, but demoted — it is navigation, not news. ────── */}
      <nav className="so-jump" aria-label="Jump to">
        {[
          ['seller_assets', Images, 'Assets'],
          ['seller_listings', ListTree, 'Listings'],
          ['seller_opportunities', Briefcase, 'Opportunities'],
          ['seller_earnings', BadgeDollarSign, 'Earnings'],
        ].map(([go, Icon, label]) => (
          <button key={go} type="button" onClick={() => onNavigate?.(go)}>
            <Icon size={15} /> {label}
          </button>
        ))}
      </nav>
    </StudioPage>
  );
}
