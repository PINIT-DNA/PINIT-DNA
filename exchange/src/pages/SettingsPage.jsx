import React, { useState } from 'react';
import {
  User, Store, ShieldCheck, ShieldAlert, CreditCard, Bell, Lock,
  CheckCircle, AlertCircle, ShoppingCart,
} from 'lucide-react';
import { canList, canPurchase, roleLabel, resolveExchangeAccount } from '../lib/roles.js';
import { apiFetch } from '../lib/api.js';
import { sellerSubscriptionLabel } from '../lib/money.js';

/**
 * Notification preferences are kept on the device.
 *
 * There is no notifications endpoint yet, and the previous version of this page
 * rendered three `defaultChecked` boxes that were never read, never sent and
 * never stored — the user could untick "email me when a sale is sealed" and
 * still be emailed. Storing them locally is a smaller promise, but it is one
 * the app actually keeps, and the label says so.
 */
const NOTIFY_KEY = 'pinit_notify_prefs';
const NOTIFY_DEFAULTS = { sale_sealed: true, brief_match: true, hub_tracking: true };

function loadNotifyPrefs() {
  try {
    const raw = JSON.parse(localStorage.getItem(NOTIFY_KEY) || '{}');
    return { ...NOTIFY_DEFAULTS, ...raw };
  } catch {
    return { ...NOTIFY_DEFAULTS };
  }
}

const NOTIFY_ROWS = [
  { id: 'sale_sealed', label: 'Sale sealed', hint: 'When a licence of your work completes.' },
  { id: 'brief_match', label: 'Brief matches', hint: 'When a buyer brief matches your verticals.' },
  { id: 'hub_tracking', label: 'Hub tracking alerts', hint: 'Post-sale activity on a protected asset.' },
];

export default function SettingsPage({ user, onUserUpdated, onNavigate, onEnableBuyer }) {
  const seller = canList(user);
  const account = resolveExchangeAccount(user);
  const sellerWorkspace = account.sellerIntent;
  const [activeTab, setActiveTab] = useState('account');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState(user?.name || user?.display_name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [sellerPlan, setSellerPlan] = useState(user?.seller_plan || 'pro');
  const [exchangeId] = useState(user?.exchange_id || '');
  const [notify, setNotify] = useState(loadNotifyPrefs);

  const biometricVerified = Boolean(user?.biometric_verified);

  const [upgrading, setUpgrading] = useState(false);
  const [upgradeError, setUpgradeError] = useState('');
  const [enablingBuyer, setEnablingBuyer] = useState(false);

  /**
   * Buyer -> Creator, started deliberately from here.
   *
   * The conversion itself only changes the role; it does NOT grant listing
   * rights. The server sets seller_onboarding_status to PAYMENT_METHOD_REQUIRED,
   * and every seller route stays blocked until the $25 activation is verified.
   * So this button creates the account and hands off to payment — it never
   * short-circuits the gate.
   */
  const startCreatorUpgrade = async () => {
    if (!user?.pinit_id) return;
    setUpgrading(true);
    setUpgradeError('');
    const { ok, data, error } = await apiFetch('/api/auth/become-creator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pinit_id: user.pinit_id }),
    });
    setUpgrading(false);
    if (!ok) {
      setUpgradeError(error || 'Could not start the Creator upgrade. Please try again.');
      return;
    }
    onUserUpdated?.(data.user, data.session_token);
    onNavigate?.('seller_onboarding_payment');
  };

  const toggleNotify = (id) => {
    setNotify((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(NOTIFY_KEY, JSON.stringify(next));
      } catch {
        /* private mode — the toggle still reflects this session */
      }
      return next;
    });
  };

  const handleSaveSettings = async (e) => {
    e.preventDefault();
    setSaveError('');
    setSaving(true);
    try {
      const endpoint = canList(user) ? '/api/auth/onboard-seller' : '/api/auth/profile';
      const { ok, data, error } = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pinit_id: user?.pinit_id,
          name: name,
          email: email,
          bio: bio,
          seller_plan: canList(user) ? sellerPlan : undefined,
          display_name: name,
        }),
      });

      if (ok) {
        setSaveSuccessMsg('Settings updated successfully!');
        if (onUserUpdated) onUserUpdated(data.user);
        setTimeout(() => setSaveSuccessMsg(''), 3000);
      } else {
        // A silent failure used to look identical to a successful save.
        setSaveError(error || 'Could not save your settings. Please try again.');
      }
    } catch (err) {
      console.error('Error updating settings:', err);
      setSaveError('Could not reach the server. Your changes were not saved.');
    } finally {
      setSaving(false);
    }
  };

  const tabs = sellerWorkspace
    ? [
      { id: 'account', label: 'Account profile', icon: User },
      { id: 'buyer', label: 'Buyer access', icon: ShoppingCart },
      { id: 'storefront', label: 'Public storefront', icon: Store },
      { id: 'verification', label: 'Seller verification', icon: ShieldCheck },
      { id: 'billing', label: 'Billing & payouts', icon: CreditCard },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'security', label: 'Security & sessions', icon: Lock },
    ]
    : [
      { id: 'account', label: 'Account profile', icon: User },
      { id: 'payments', label: 'Payment methods', icon: CreditCard },
      { id: 'creator', label: 'Become a Seller', icon: Store },
      { id: 'notifications', label: 'Notifications', icon: Bell },
      { id: 'security', label: 'Security & sessions', icon: Lock },
    ];

  // Only these tabs contain fields the save endpoint accepts. Showing "Save
  // settings" under a read-only panel implies there is something to save.
  const SAVABLE_TABS = ['account', 'storefront', 'billing'];
  const showSave = SAVABLE_TABS.includes(activeTab);

  return (
    <div className="ex-page settings-page">
      <header className="settings-head">
        <h1 className="ex-h1">{sellerWorkspace ? 'Seller settings' : 'Account settings'}</h1>
        <p className="settings-head__role">{roleLabel(user)}{user?.pinit_id ? ` · ${user.pinit_id}` : ''}</p>
        {canPurchase(user) && !sellerWorkspace && (
          <p className="settings-head__hint">
            Pinit HUB is your private workspace. Listing on Exchange requires becoming a Creator.
          </p>
        )}
      </header>

      <div className="settings-grid">
        <nav className="ex-card settings-nav" aria-label="Settings sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={activeTab === tab.id ? 'page' : undefined}
                className={`settings-nav__item ${activeTab === tab.id ? 'is-active' : ''}`}
              >
                <Icon size={17} /> {tab.label}
              </button>
            );
          })}
        </nav>

        <div className="ex-card ex-card--pad settings-panel">
          {saveSuccessMsg && (
            <div className="ex-alert ex-alert--ok settings-alert">
              <CheckCircle size={18} /> <span>{saveSuccessMsg}</span>
            </div>
          )}
          {saveError && (
            <div className="ex-alert ex-alert--error settings-alert" role="alert">
              <AlertCircle size={18} /> <span>{saveError}</span>
            </div>
          )}

          <form onSubmit={handleSaveSettings}>
            {activeTab === 'account' && (
              <section>
                <h2 className="ex-h2 settings-h">Account profile</h2>
                <div className="settings-pair">
                  <div className="form-group">
                    <label className="form-label" htmlFor="set-name">Full name</label>
                    <input id="set-name" type="text" className="form-input" value={name} onChange={(e) => setName(e.target.value)} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label" htmlFor="set-email">Email address</label>
                    <input id="set-email" type="email" className="form-input" value={email} onChange={(e) => setEmail(e.target.value)} required />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="set-pid">Pinit ID</label>
                  <input id="set-pid" type="text" className="form-input settings-readonly" value={user?.pinit_id || ''} readOnly />
                  <span className="settings-fine">Shared identity between Pinit HUB Vault and Pinit Exchange.</span>
                </div>
                <p className="settings-fine" style={{ marginTop: 12 }}>
                  Capabilities: {canPurchase(user) ? 'Buying on' : 'Buying off'}
                  {seller ? ' · Selling on' : ''}
                </p>
              </section>
            )}

            {activeTab === 'buyer' && (
              <section>
                <h2 className="ex-h2 settings-h">Buyer access</h2>
                {account.needsBuyerEnable ? (
                  <>
                    <p className="settings-body">
                      Activate Buyer on this same Pinit identity to use Discover checkout, cart,
                      purchases and wishlist. Selling is unchanged. No second email or login.
                    </p>
                    <button
                      type="button"
                      className="ex-btn ex-btn--primary"
                      disabled={enablingBuyer}
                      onClick={async () => {
                        setEnablingBuyer(true);
                        await onEnableBuyer?.();
                        setEnablingBuyer(false);
                      }}
                    >
                      {enablingBuyer ? 'Enabling…' : 'Become a Buyer'}
                    </button>
                  </>
                ) : (
                  <p className="settings-fine">
                    Buyer is on. Cart, checkout, purchases and wishlist are available alongside selling.
                  </p>
                )}
              </section>
            )}

            {activeTab === 'creator' && (
              <section>
                <h2 className="ex-h2 settings-h">Become a Seller</h2>
                <p className="settings-body">
                  A Seller capability lets you list assets you have protected in Pinit HUB and
                  earn from licences. Buying stays on this same account — you do not need a
                  second login.
                </p>

                <div className="creator-upgrade">
                  <div className="creator-upgrade__price">
                    <span className="creator-upgrade__amount">{sellerSubscriptionLabel()}</span>
                    <span className="creator-upgrade__term">one-time activation</span>
                  </div>
                  <ul className="creator-upgrade__list">
                    <li>List Hub-protected assets on the marketplace</li>
                    <li>Set your own Personal, Commercial, Exclusive and Enterprise pricing</li>
                    <li>Keep 85% of every licence as creator net</li>
                    <li>Per-asset activity, sales and earnings reporting</li>
                  </ul>
                </div>

                {upgradeError && (
                  <div className="ex-alert ex-alert--error settings-alert" role="alert">
                    <AlertCircle size={18} /> <span>{upgradeError}</span>
                  </div>
                )}

                <button
                  type="button"
                  className="ex-btn ex-btn--primary"
                  disabled={upgrading}
                  onClick={startCreatorUpgrade}
                >
                  {upgrading ? 'Starting seller setup…' : 'Continue to payment'}
                </button>
                <span className="settings-fine">
                  Your account keeps buying. After the {sellerSubscriptionLabel()} subscription
                  is verified, listing is enabled on this same identity.
                </span>
              </section>
            )}

            {activeTab === 'payments' && (
              <section>
                <h2 className="ex-h2 settings-h">Payment methods</h2>
                <p className="settings-body">
                  Cards are tokenized by the payment provider. Exchange never stores raw card numbers.
                </p>
                <button type="button" className="ex-btn ex-btn--primary" onClick={() => onNavigate?.('buyer_payments')}>
                  Open payment methods
                </button>
              </section>
            )}

            {activeTab === 'storefront' && (
              <section>
                <h2 className="ex-h2 settings-h">Public storefront</h2>
                <div className="form-group">
                  <label className="form-label" htmlFor="set-bio">Creator biography and provenance story</label>
                  <textarea id="set-bio" className="form-textarea" rows="5" value={bio} onChange={(e) => setBio(e.target.value)} />
                  <span className="settings-fine">Shown on your public portfolio and creator passport.</span>
                </div>
              </section>
            )}

            {activeTab === 'verification' && (
              <section>
                <h2 className="ex-h2 settings-h">Seller verification</h2>

                <div className="settings-row">
                  <div>
                    <span className="settings-row__name">Exchange seller ID</span>
                    <span className="settings-row__hint">Commerce identity minted at seller onboarding.</span>
                  </div>
                  <span className="settings-pill">{exchangeId || 'Not issued'}</span>
                </div>

                {/* Read-only. This was previously an editable checkbox, which
                    implied a seller could attest to their own biometric match —
                    the value was never sent anywhere, and self-certification is
                    not something this control should ever offer. Verification
                    happens in Pinit HUB. */}
                <div className="settings-row">
                  <div>
                    <span className="settings-row__name">Biometric ID check</span>
                    <span className="settings-row__hint">Verified in Pinit HUB — not editable here.</span>
                  </div>
                  {biometricVerified ? (
                    <span className="settings-status settings-status--ok">
                      <ShieldCheck size={15} /> Verified
                    </span>
                  ) : (
                    <span className="settings-status settings-status--wait">
                      <ShieldAlert size={15} /> Not verified
                    </span>
                  )}
                </div>
              </section>
            )}

            {activeTab === 'billing' && (
              <section>
                <h2 className="ex-h2 settings-h">Seller plan</h2>
                <div className="settings-plans" role="radiogroup" aria-label="Seller plan">
                  {[
                    { id: 'pro', name: 'Pro', price: '$29 / mo', blurb: 'Unlimited listings, 85% creator net payout.' },
                    { id: 'enterprise_pro', name: 'Enterprise Pro', price: '$99 / mo', blurb: 'Unlimited listings, priority SLA, 90% net payout.' },
                  ].map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      role="radio"
                      aria-checked={sellerPlan === plan.id}
                      onClick={() => setSellerPlan(plan.id)}
                      className={`settings-plan ${sellerPlan === plan.id ? 'is-on' : ''}`}
                    >
                      <span className="settings-plan__name">{plan.name}</span>
                      <span className="settings-plan__price">{plan.price}</span>
                      <span className="settings-plan__blurb">{plan.blurb}</span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'notifications' && (
              <section>
                <h2 className="ex-h2 settings-h">Notifications</h2>
                <p className="settings-body">
                  These preferences are stored on this device. Account-wide delivery settings
                  are not available yet.
                </p>
                <div className="settings-toggles">
                  {NOTIFY_ROWS.map((row) => (
                    <label key={row.id} className="settings-toggle">
                      <input
                        type="checkbox"
                        checked={Boolean(notify[row.id])}
                        onChange={() => toggleNotify(row.id)}
                      />
                      <span>
                        <span className="settings-row__name">{row.label}</span>
                        <span className="settings-row__hint">{row.hint}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </section>
            )}

            {activeTab === 'security' && (
              <section>
                <h2 className="ex-h2 settings-h">Security and linked Hub account</h2>
                <div className="settings-row">
                  <div>
                    <span className="settings-row__name">Linked Pinit HUB identity</span>
                    <span className="settings-row__hint">Sign-in and biometrics are managed in Hub.</span>
                  </div>
                  <span className="settings-pill">{user?.pinit_id || 'Sign in with Hub'}</span>
                </div>
              </section>
            )}

            {showSave && (
              <div className="settings-save">
                <button type="submit" className="ex-btn ex-btn--primary" disabled={saving}>
                  {saving ? 'Saving…' : 'Save settings'}
                </button>
              </div>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
