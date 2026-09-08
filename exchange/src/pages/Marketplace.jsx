import React, { useState, useEffect } from 'react';
import {
  Search, Filter, ShieldCheck, Pencil, X, Check,
} from 'lucide-react';
import ListingCard from '../components/ListingCard.jsx';
import DiscoverHeroArt from '../components/DiscoverHeroArt.jsx';
import EmptyState from '../components/EmptyState.jsx';
import { apiFetch, unwrapList } from '../lib/api.js';
import { formatMoney } from '../lib/money.js';
import { buyerKey } from '../lib/buyer.js';
import { canList } from '../lib/roles.js';
import { isImageListing, isVideoListing } from '../lib/media.js';
import { samePinitIdentity, extractPinitCode } from '../lib/pinit-identity.js';
import { resolveHubAppUrl } from '../lib/exchange-routes.js';

// One hue per vertical. Colour is information here, not decoration — it
// identifies the category on the filter pill and tints the hover glow of
// tiles belonging to it.
const VERTICAL_HUE = {
  all: 'var(--v-all)',
  mine: 'var(--v-mine)',
  images: 'var(--v-images)',
  video: 'var(--v-video)',
  audio: 'var(--v-audio)',
  documents: 'var(--v-all)',
  design: 'var(--v-ui_ux)',
  ui_ux: 'var(--v-ui_ux)',
  '3d': 'var(--v-3d)',
  other: 'var(--v-concepts)',
  concepts: 'var(--v-concepts)',
};

const VERTICAL_INK = {
  images: '#1a1204',
  design: '#04171c',
  ui_ux: '#04171c',
  '3d': '#04160f',
  other: '#0f0600',
  concepts: '#0f0600',
};

const VERTICALS = [
  { id: 'all', name: 'All' },
  { id: 'images', name: 'Images' },
  { id: 'video', name: 'Video' },
  { id: 'audio', name: 'Audio' },
  { id: 'documents', name: 'Documents' },
  { id: 'design', name: 'Design' },
  { id: '3d', name: '3D' },
  { id: 'other', name: 'Other' },
];

const INBOUND_VERTICAL = {
  ui_ux: 'design',
  graphics: 'design',
  photography: 'images',
  image: 'images',
  concepts: 'other',
  illustration: 'other',
};

export default function Marketplace({
  onSelectListing,
  onOpenListFromHub,
  onOpenCheckout,
  onBecomeCreator,
  user = null,
  focusListingId = null,
  resetFiltersToken = 0,
  externalSearch = null,
  externalVertical = null,
  onCartChanged,
  shopModule = 'buy',
  onNavigate,
}) {
  const buyView = shopModule !== 'sell';
  const [listings, setListings] = useState([]);
  const [loading, setLoading] = useState(true);
  // A failed request and an empty catalogue are different things. Conflating
  // them told customers the shop was empty when the backend was simply down.
  const [loadError, setLoadError] = useState('');
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedVertical, setSelectedVertical] = useState('all');
  const [selectedBadge, setSelectedBadge] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  // Incremented to request a re-fetch for the current search term, from either
  // the page form or the header. searchQuery itself is not a fetch dependency —
  // that would fire a request on every keystroke.
  const [searchToken, setSearchToken] = useState(0);
  // The term the currently displayed results were fetched with.
  const [appliedSearch, setAppliedSearch] = useState('');
  const [sortOption, setSortOption] = useState('newest');
  // Additive server-side filters. Empty string means "not applied" — the
  // param is omitted entirely rather than sent as 0, which would filter.
  const [licence, setLicence] = useState('');
  const [media, setMedia] = useState('');
  const [priceMin, setPriceMin] = useState('');
  const [priceMax, setPriceMax] = useState('');
  const [creatorQuery, setCreatorQuery] = useState('');
  const [filterToken, setFilterToken] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [savedIds, setSavedIds] = useState(() => new Set());
  const [followedCodes, setFollowedCodes] = useState(() => new Set());
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState('');

  useEffect(() => {
    if (buyView && selectedVertical === 'mine') setSelectedVertical('all');
  }, [buyView, selectedVertical]);

  useEffect(() => {
    try {
      const name = sessionStorage.getItem('pinit_discover_creator');
      if (!name) return;
      sessionStorage.removeItem('pinit_discover_creator');
      setCreatorQuery(name);
      setFilterToken((t) => t + 1);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (resetFiltersToken) {
      setSelectedVertical('all');
      setSelectedBadge('all');
      setSearchQuery('');
      setSortOption('newest');
      setLicence('');
      setMedia('');
      setPriceMin('');
      setPriceMax('');
      setCreatorQuery('');
    }
  }, [resetFiltersToken, user?.pinit_id]);

  // A search run from the header lands here. Widen the vertical filter to
  // 'all' first — searching from the header while a category pill is active
  // would otherwise appear to return nothing.
  useEffect(() => {
    if (!externalSearch) return;
    setSearchQuery(externalSearch.term || '');
    setSelectedVertical('all');
    // Bump the token explicitly. Relying on selectedVertical alone would miss
    // the case where 'all' is already selected — the term would land in the
    // input but no fetch would run.
    setSearchToken((t) => t + 1);
  }, [externalSearch]);

  // A category opened from Collections lands here. Other filters are cleared
  // so the buyer sees that whole category, not the intersection of it with
  // whatever was left applied from an earlier visit.
  useEffect(() => {
    if (!externalVertical?.vertical) return;
    const incoming = String(externalVertical.vertical || '').toLowerCase();
    setSelectedVertical(INBOUND_VERTICAL[incoming] || incoming);
    setSelectedBadge('all');
    setSearchQuery('');
    setLicence('');
    setMedia('');
    setPriceMin('');
    setPriceMax('');
    setCreatorQuery('');
    setSearchToken((t) => t + 1);
  }, [externalVertical]);

  useEffect(() => {
    fetchListings();
  }, [selectedVertical, selectedBadge, sortOption, searchToken, filterToken, resetFiltersToken, user?.pinit_id]);

  useEffect(() => {
    const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer');
    if (!key) {
      setSavedIds(new Set());
      return;
    }
    let cancelled = false;
    apiFetch(`/api/commerce/wishlist?buyer_key=${encodeURIComponent(key)}`).then(({ ok, data }) => {
      if (cancelled || !ok) return;
      setSavedIds(new Set((data.items || []).map((row) => row.listing_id).filter(Boolean)));
    });
    apiFetch(`/api/commerce/follows?buyer_key=${encodeURIComponent(key)}`).then(({ ok, data }) => {
      if (cancelled || !ok) return;
      setFollowedCodes(new Set(
        (data.items || []).map((row) => extractPinitCode(row.creator_pinit_id)).filter(Boolean),
      ));
    });
    return () => { cancelled = true; };
  }, [user?.pinit_id, user?.email]);

  useEffect(() => {
    if (!focusListingId || !listings.length) return;
    const el = document.getElementById(`listing-${focusListingId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('listing-card--flash');
      setTimeout(() => el.classList.remove('listing-card--flash'), 2400);
    }
  }, [focusListingId, listings]);

  const PAGE_SIZE = 24;

  const buildUrl = (offset) => {
    const verticalParam = selectedVertical === 'mine' ? 'all' : selectedVertical;
    let url = `/api/listings?vertical=${verticalParam}&badge=${selectedBadge}&sort=${sortOption}`
      + `&limit=${PAGE_SIZE}&offset=${offset}`;
    if (selectedVertical === 'mine' && user?.pinit_id) {
      url += `&seller=${encodeURIComponent(user.pinit_id)}`;
    }
    if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;
    if (licence) url += `&licence=${encodeURIComponent(licence)}`;
    if (media) url += `&media=${encodeURIComponent(media)}`;
    if (priceMin !== '' && Number(priceMin) > 0) url += `&price_min=${encodeURIComponent(priceMin)}`;
    if (priceMax !== '' && Number(priceMax) > 0) url += `&price_max=${encodeURIComponent(priceMax)}`;
    if (creatorQuery.trim()) url += `&creator=${encodeURIComponent(creatorQuery.trim())}`;
    return url;
  };

  const fetchListings = async () => {
    setLoading(true);
    setLoadError('');
    // Remember the term these results actually came from. Reading the live
    // input instead would relabel the results header on every keystroke,
    // before the matching request had run.
    setAppliedSearch(searchQuery.trim());
    const { ok, data, error, headers } = await apiFetch(buildUrl(0));
    if (!ok) {
      // Surface the failure instead of rendering an empty marketplace.
      setLoadError(error || 'Could not load the marketplace.');
      setListings([]);
      setTotal(0);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const page = unwrapList(data, headers);
    setListings(page.items);
    setTotal(page.total);
    setHasMore(page.hasMore);
    setLoading(false);
  };

  const loadMore = async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const { ok, data, error, headers } = await apiFetch(buildUrl(listings.length));
    if (ok) {
      const page = unwrapList(data, headers);
      setListings((prev) => [...prev, ...page.items]);
      setTotal(page.total);
      setHasMore(page.hasMore);
    } else {
      setLoadError(error || 'Could not load more listings.');
    }
    setLoadingMore(false);
  };

  const handleSearchSubmit = (e) => {
    e.preventDefault();
    fetchListings();
  };

  const openEdit = (e, item) => {
    e.stopPropagation();
    setEditError('');
    setEditing(item);
    setEditForm({
      title: item.title || '',
      tagline: item.tagline || '',
      description: item.description || '',
      tags: item.tags || '',
      vertical: item.vertical || 'images',
      price_personal: item.price_personal ?? 49,
      price_commercial: item.price_commercial ?? 149,
      price_exclusive: item.price_exclusive ?? 899,
      price_enterprise: item.price_enterprise ?? 2499,
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!user?.pinit_id || !editing) return;
    setSaving(true);
    setEditError('');
    const { ok, error } = await apiFetch(`/api/listings/${encodeURIComponent(editing.listing_id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinit_id: user.pinit_id, ...editForm }),
    });
    if (!ok) {
      setEditError(error || 'Update failed');
      setSaving(false);
      return;
    }
    setEditing(null);
    await fetchListings();
    setSaving(false);
  };

  const isOwner = (item) => samePinitIdentity(user?.pinit_id, item.pinit_id);

  const visibleListings = listings
    .filter((item) => {
      if (buyView && user?.pinit_id && samePinitIdentity(user.pinit_id, item.pinit_id)) return false;
      if (selectedVertical === 'images') return isImageListing(item);
      if (selectedVertical === 'video') return isVideoListing(item);
      return true;
    })
    .slice()
    .sort((a, b) => {
      const aOn = followedCodes.has(extractPinitCode(a.pinit_id)) ? 1 : 0;
      const bOn = followedCodes.has(extractPinitCode(b.pinit_id)) ? 1 : 0;
      return bOn - aOn;
    });

  // ---- Search-results mode ------------------------------------------------
  // Someone who has searched or filtered is no longer browsing: they have a
  // question and want the answer. In that mode the marketing hero and the
  // editorial rails step aside for a plain result count, the filters that
  // produced it, and a way to undo each one.
  const badgeActive = selectedBadge !== 'all';
  const verticalActive = selectedVertical !== 'all';
  const priceActive = (priceMin !== '' && Number(priceMin) > 0) || (priceMax !== '' && Number(priceMax) > 0);
  const creatorActive = Boolean(creatorQuery.trim());
  const resultsMode = Boolean(appliedSearch) || badgeActive || verticalActive
    || Boolean(licence) || Boolean(media) || priceActive || creatorActive;

  // Section rails only earn their place once the catalogue is bigger than the
  // grid can show at a glance. Below that, Featured and Recently listed would
  // repeat the very tiles sitting directly above them — the same asset three
  // times on one screen. Redundancy reads as padding, so the rails stay hidden
  // until there is genuinely more to surface.
  const exploreCreators = !resultsMode
    ? Object.values(listings.reduce((acc, item) => {
      const id = item.pinit_id || item.creator_exchange_id;
      if (!id || acc[id]) return acc;
      acc[id] = {
        id,
        name: item.creator_name || 'Creator',
        preview: item.preview_url,
      };
      return acc;
    }, {})).slice(0, 6)
    : [];

  const activeFilters = [];
  if (appliedSearch) {
    activeFilters.push({
      key: 'q',
      label: `“${appliedSearch}”`,
      clear: () => { setSearchQuery(''); setSearchToken((t) => t + 1); },
    });
  }
  if (verticalActive) {
    activeFilters.push({
      key: 'vertical',
      label: VERTICALS.find((v) => v.id === selectedVertical)?.name || selectedVertical,
      clear: () => setSelectedVertical('all'),
    });
  }
  if (badgeActive) {
    activeFilters.push({
      key: 'badge',
      label: `${selectedBadge} badge`,
      clear: () => setSelectedBadge('all'),
    });
  }
  if (licence) {
    activeFilters.push({
      key: 'licence',
      label: `${licence.charAt(0).toUpperCase()}${licence.slice(1)} licence`,
      clear: () => { setLicence(''); setFilterToken((t) => t + 1); },
    });
  }
  if (media) {
    activeFilters.push({
      key: 'media',
      label: media === 'video' ? 'Video' : 'Images',
      clear: () => { setMedia(''); setFilterToken((t) => t + 1); },
    });
  }
  if (creatorActive) {
    activeFilters.push({
      key: 'creator',
      label: `Creator: ${creatorQuery.trim()}`,
      clear: () => { setCreatorQuery(''); setFilterToken((t) => t + 1); },
    });
  }
  if (priceActive) {
    const lo = priceMin !== '' && Number(priceMin) > 0 ? formatMoney(Number(priceMin)) : null;
    const hi = priceMax !== '' && Number(priceMax) > 0 ? formatMoney(Number(priceMax)) : null;
    activeFilters.push({
      key: 'price',
      label: lo && hi ? `${lo}–${hi}` : (lo ? `${lo}+` : `Under ${hi}`),
      clear: () => { setPriceMin(''); setPriceMax(''); setFilterToken((t) => t + 1); },
    });
  }

  const clearAllFilters = () => {
    setSearchQuery('');
    setSelectedVertical('all');
    setSelectedBadge('all');
    setLicence('');
    setMedia('');
    setPriceMin('');
    setPriceMax('');
    setCreatorQuery('');
    setSearchToken((t) => t + 1);
  };

  return (
    <div className="market-page">
      <div className="glass-panel market-hero market-hero--compact">
        <div className="market-hero__copy">
          <div className="market-hero__badge">
            <ShieldCheck size={16} />
            <span>Protected by Pinit HUB</span>
          </div>
          <h1 className="market-hero__title">Discover protected creative work</h1>
          <p className="market-hero__sub">
            Explore and license creative work protected by Pinit HUB.
          </p>
        </div>
        <DiscoverHeroArt />
      </div>

      <div id="browse-section" className="market-browse">
        <div className="market-cats">
          {VERTICALS.map((v) => (
            <button
              key={v.id}
              type="button"
              className="vpill"
              aria-pressed={selectedVertical === v.id}
              onClick={() => setSelectedVertical(v.id)}
              style={{
                '--vpill-hue': VERTICAL_HUE[v.id] || 'var(--v-all)',
                '--vpill-ink': VERTICAL_INK[v.id] || '#fff',
              }}
            >
              {v.name}
            </button>
          ))}
        </div>

        <div className="market-search-row">
          <form onSubmit={handleSearchSubmit} className="market-search-form">
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={18} color="var(--text-muted)" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)' }} />
              <input
                type="text"
                className="form-input"
                placeholder="Search creative work, creators, or assets…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '40px' }}
              />
            </div>
            <button type="submit" className="btn-secondary">Search</button>
          </form>

            <div className="market-toolbar">
            <button
              type="button"
              className={`ex-btn ex-btn--secondary ex-btn--sm filter-toggle${activeFilters.length ? ' has-active' : ''}`}
              aria-expanded={filtersOpen}
              aria-controls="market-filters"
              onClick={() => setFiltersOpen((o) => !o)}
            >
              <Filter size={15} /> Price
              {activeFilters.length > 0 && <span className="filter-toggle__count">{activeFilters.length}</span>}
            </button>
            <select
              className="form-select"
              value={media}
              onChange={(e) => { setMedia(e.target.value); setFilterToken((t) => t + 1); }}
              aria-label="Type"
              style={{ width: 'auto', minWidth: '96px' }}
            >
              <option value="">Type</option>
              <option value="image">Images</option>
              <option value="video">Video</option>
            </select>
            <select
              className="form-select"
              value={licence}
              onChange={(e) => { setLicence(e.target.value); setFilterToken((t) => t + 1); }}
              aria-label="License"
              style={{ width: 'auto', minWidth: '110px' }}
            >
              <option value="">License</option>
              <option value="personal">Personal</option>
              <option value="commercial">Commercial</option>
              <option value="exclusive">Exclusive</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <input
              className="form-input market-toolbar__creator"
              placeholder="Creator"
              value={creatorQuery}
              onChange={(e) => setCreatorQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  setFilterToken((t) => t + 1);
                }
              }}
              aria-label="Filter by creator"
            />
            <select className="form-select" value={selectedBadge} onChange={(e) => setSelectedBadge(e.target.value)} style={{ width: 'auto', minWidth: '120px' }}>
              <option value="all">Protection</option>
              <option value="Gold">Gold</option>
              <option value="Silver">Silver</option>
              <option value="Bronze">Bronze</option>
            </select>
            <select className="form-select" value={sortOption} onChange={(e) => setSortOption(e.target.value)} style={{ width: 'auto', minWidth: '120px' }}>
              <option value="newest">Newest</option>
              <option value="popular">Most Viewed</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>
        </div>

        {filtersOpen && (
          <form
            id="market-filters"
            className="market-filters"
            onSubmit={(e) => { e.preventDefault(); setFilterToken((t) => t + 1); }}
          >
            <div className="market-filters__group">
              <span className="ex-label" id="lbl-licence">Licence</span>
              <div className="market-filters__opts" role="group" aria-labelledby="lbl-licence">
                {[
                  { id: '', label: 'Any' },
                  { id: 'personal', label: 'Personal' },
                  { id: 'commercial', label: 'Commercial' },
                  { id: 'exclusive', label: 'Exclusive' },
                  { id: 'enterprise', label: 'Enterprise' },
                ].map((o) => (
                  <button
                    key={o.id || 'any'}
                    type="button"
                    className={`fchip${licence === o.id ? ' is-on' : ''}`}
                    aria-pressed={licence === o.id}
                    onClick={() => { setLicence(o.id); setFilterToken((t) => t + 1); }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <span className="market-filters__hint">Only assets the creator priced for that licence.</span>
            </div>

            <div className="market-filters__group">
              <span className="ex-label" id="lbl-media">Type</span>
              <div className="market-filters__opts" role="group" aria-labelledby="lbl-media">
                {[
                  { id: '', label: 'Any' },
                  { id: 'image', label: 'Images' },
                  { id: 'video', label: 'Video' },
                ].map((o) => (
                  <button
                    key={o.id || 'any'}
                    type="button"
                    className={`fchip${media === o.id ? ' is-on' : ''}`}
                    aria-pressed={media === o.id}
                    onClick={() => { setMedia(o.id); setFilterToken((t) => t + 1); }}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="market-filters__group">
              <label className="ex-label" htmlFor="price-min">Price range</label>
              <div className="market-filters__price">
                <input
                  id="price-min"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="Min"
                  value={priceMin}
                  onChange={(e) => setPriceMin(e.target.value)}
                  aria-label="Minimum price"
                />
                <span aria-hidden="true">–</span>
                <input
                  id="price-max"
                  type="number"
                  min="0"
                  inputMode="numeric"
                  className="form-input"
                  placeholder="Max"
                  value={priceMax}
                  onChange={(e) => setPriceMax(e.target.value)}
                  aria-label="Maximum price"
                />
                <button type="submit" className="ex-btn ex-btn--secondary ex-btn--sm">Apply</button>
              </div>
              <span className="market-filters__hint">
                {licence
                  ? `Compared against the ${licence} price.`
                  : 'Compared against each asset’s lowest published price.'}
              </span>
            </div>

            {activeFilters.length > 0 && (
              <button type="button" className="market-filters__reset" onClick={clearAllFilters}>
                Reset all filters
              </button>
            )}
          </form>
        )}
      </div>

      {resultsMode && !loading && !loadError && (
        <div className="results-bar">
          <div className="results-bar__count" role="status" aria-live="polite">
            <strong>{visibleListings.length}</strong>
            {visibleListings.length === 1 ? ' asset' : ' assets'}
            {appliedSearch ? <> matching <span className="results-bar__term">“{appliedSearch}”</span></> : ' in this view'}
          </div>
          <div className="results-bar__chips">
            {activeFilters.map((f) => (
              <button
                key={f.key}
                type="button"
                className="results-chip"
                onClick={f.clear}
                aria-label={`Remove filter ${f.label}`}
              >
                {f.label} <X size={13} />
              </button>
            ))}
            {activeFilters.length > 1 && (
              <button type="button" className="results-bar__clear" onClick={clearAllFilters}>
                Clear all
              </button>
            )}
          </div>
        </div>
      )}

      {loading ? (
        <div className="listing-grid" aria-busy="true" aria-label="Loading listings">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="asset-card listing-card--skeleton" aria-hidden="true">
              <div className="sk sk-media" style={{ aspectRatio: '4 / 3' }} />
              <div className="asset-card__body">
                <div className="sk sk-line sk-line--title" />
                <div className="sk sk-line sk-line--meta" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <EmptyState
          icon={<ShieldCheck size={36} color="var(--danger, #c0392b)" />}
          title="Couldn't load the marketplace"
          description="Pinit Exchange is temporarily waking up. Please try again in a moment."
          primaryLabel="Retry"
          onPrimary={fetchListings}
        />
      ) : visibleListings.length === 0 ? (
        // A search that found nothing is a different dead end from an empty
        // category, and both differ from a creator with no listings yet. Each
        // gets the way out that actually applies to it.
        appliedSearch ? (
          <EmptyState
            icon={<Search size={36} color="var(--primary)" />}
            title={`No assets match “${appliedSearch}”`}
            description={
              activeFilters.length > 1
                ? 'Other filters are still narrowing these results. Try clearing them, or search a different term.'
                : 'Try a different term, or browse the full catalogue.'
            }
            primaryLabel={activeFilters.length > 1 ? 'Clear all filters' : 'Browse everything'}
            onPrimary={clearAllFilters}
            secondaryLabel="Open Pinit HUB"
            onSecondary={() => window.open(resolveHubAppUrl(), '_blank')}
          />
        ) : (
          <EmptyState
            icon={<ShieldCheck size={36} color="var(--primary)" />}
            title={buyView && listings.some((item) => samePinitIdentity(user?.pinit_id, item.pinit_id))
              ? 'No other creators to buy from yet'
              : 'No work in this view'}
            description={
              buyView && listings.some((item) => samePinitIdentity(user?.pinit_id, item.pinit_id))
                ? 'Your own listings stay in Sell. Buy, cart and wishlist appear on another creator’s asset. Open Discover after someone else lists, or switch to Sell to manage yours.'
                : selectedVertical === 'mine'
                ? 'Your protected assets can become licenses on Pinit Exchange.'
                : 'Try another category, clear filters, or list a protected asset.'
            }
            primaryLabel={selectedVertical === 'mine' && canList(user) ? 'List an asset' : 'Show all categories'}
            onPrimary={() => {
              if (selectedVertical === 'mine' && canList(user)) onOpenListFromHub?.();
              else setSelectedVertical('all');
            }}
            secondaryLabel="Open Pinit HUB"
            onSecondary={() => window.open(resolveHubAppUrl(), '_blank')}
          />
        )
      ) : (
        <>
        {!resultsMode && (
          <div className="ex-section-head market-discover-head">
            <div>
              <h2 className="ex-h2">Discover</h2>
              <div className="ex-h2-sub">Protected creative work, ready to license.</div>
            </div>
          </div>
        )}
        <div className="listing-grid">
          {visibleListings.map((item) => (
            <div
              key={item.listing_id}
              style={{ position: 'relative', '--tile-hue': VERTICAL_HUE[item.vertical] || 'var(--v-all)' }}
            >
              {isOwner(item) && !buyView && canList(user) && (
                <button
                  type="button"
                  className="card-edit-btn"
                  style={{ zIndex: 5 }}
                  title="Edit listing"
                  onClick={(e) => openEdit(e, item)}
                >
                  <Pencil size={14} /> Edit
                </button>
              )}
              <ListingCard
                item={item}
                user={user}
                wishlisted={savedIds.has(item.listing_id)}
                onSelect={onSelectListing}
                onOpenCreator={(id) => {
                  try { sessionStorage.setItem('pinit_open_creator', id); } catch { /* ignore */ }
                  onNavigate?.('passports');
                }}
                onWishlist={async (listing) => {
                  const key = buyerKey(user) || localStorage.getItem('pinit_guest_buyer') || `GUEST-${Date.now()}`;
                  if (!localStorage.getItem('pinit_guest_buyer') && !user) {
                    localStorage.setItem('pinit_guest_buyer', key);
                  }
                  const already = savedIds.has(listing.listing_id);
                  if (already) {
                    const { ok } = await apiFetch(
                      `/api/commerce/wishlist/${encodeURIComponent(listing.listing_id)}?buyer_key=${encodeURIComponent(key)}`,
                      { method: 'DELETE' },
                    );
                    if (ok) {
                      setSavedIds((prev) => {
                        const next = new Set(prev);
                        next.delete(listing.listing_id);
                        return next;
                      });
                      onCartChanged?.();
                    }
                    return;
                  }
                  const { ok } = await apiFetch('/api/commerce/wishlist', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ buyer_key: key, listing_id: listing.listing_id }),
                  });
                  if (ok) {
                    setSavedIds((prev) => new Set(prev).add(listing.listing_id));
                    onCartChanged?.();
                  }
                }}
              />
            </div>
          ))}
        </div>
        </>
      )}

      {!loading && !loadError && !resultsMode && exploreCreators.length > 0 && (
        <section className="ex-section market-creators">
          <div className="ex-section-head">
            <div>
              <h2 className="ex-h2">Explore creators</h2>
              <div className="ex-h2-sub">Meet the creators behind protected work.</div>
            </div>
            <button type="button" className="ex-text-link" onClick={() => onNavigate?.('passports')}>
              View all creators →
            </button>
          </div>
          <div className="market-creators__row">
            {exploreCreators.map((c) => (
              <button
                key={c.id}
                type="button"
                className="market-creator-chip"
                onClick={() => {
                  try { sessionStorage.setItem('pinit_open_creator', c.id); } catch { /* ignore */ }
                  onNavigate?.('passports');
                }}
              >
                <span className="market-creator-chip__avatar">{String(c.name).charAt(0).toUpperCase()}</span>
                <span className="market-creator-chip__name">{c.name}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {!loading && !loadError && visibleListings.length > 0 && (
        <div className="marketplace-more">
          <p className="marketplace-more__count">
            Showing {visibleListings.length}{total ? ` of ${total}` : ''} {total === 1 ? 'asset' : 'assets'}
          </p>
          {hasMore && (
            <button
              type="button"
              className="btn-secondary"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </div>
      )}

      {editing && (
        <div className="modal-overlay" onClick={() => setEditing(null)} role="presentation">
          <div className="modal-content" style={{ maxWidth: 520 }} onClick={(e) => e.stopPropagation()} role="dialog">
            <div className="modal-header">
              <div>
                <h3 style={{ color: '#fff', fontSize: '1.2rem' }}>Edit listing</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>Update title, tagline, tags, and prices — stock-agency style.</p>
              </div>
              <button type="button" onClick={() => setEditing(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>
            <form onSubmit={saveEdit} className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <label className="form-label">Title
                <input className="form-input" value={editForm.title} onChange={(e) => setEditForm({ ...editForm, title: e.target.value })} required />
              </label>
              <label className="form-label">Tagline
                <input className="form-input" value={editForm.tagline} onChange={(e) => setEditForm({ ...editForm, tagline: e.target.value })} placeholder="One punchy line buyers see on the card" maxLength={120} />
              </label>
              <label className="form-label">Tags / keywords
                <input className="form-input" value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} placeholder="cinematic, drone, golden-hour, 8k" />
              </label>
              <label className="form-label">Description
                <textarea className="form-textarea" rows={3} value={editForm.description} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} />
              </label>
              <label className="form-label">Category
                <select className="form-select" value={editForm.vertical} onChange={(e) => setEditForm({ ...editForm, vertical: e.target.value })}>
                  {VERTICALS.filter((v) => v.id !== 'all' && v.id !== 'mine').map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                {['price_personal', 'price_commercial', 'price_exclusive', 'price_enterprise'].map((key) => (
                  <label key={key} className="form-label" style={{ textTransform: 'capitalize' }}>
                    {key.replace('price_', '').replace('_', ' ')}
                    <input type="number" className="form-input" value={editForm[key]} onChange={(e) => setEditForm({ ...editForm, [key]: Number(e.target.value) })} />
                  </label>
                ))}
              </div>
              {editError && <div style={{ color: '#f87171', fontSize: '0.88rem' }}>{editError}</div>}
              <div className="modal-footer" style={{ marginTop: 8 }}>
                <button type="button" className="btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
                <button type="submit" className="btn-primary" disabled={saving}>
                  {saving ? 'Saving…' : <><Check size={16} /> Save changes</>}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
