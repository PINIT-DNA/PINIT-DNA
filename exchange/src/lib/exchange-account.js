/**
 * Single Exchange account authority.
 *
 * One Pinit identity buys and sells. Selling is a capability gated by the
 * ₹2,500 seller subscription — not a second login.
 */

export function resolveExchangeAccount(user) {
  if (!user) {
    return {
      userId: null,
      pinitId: null,
      role: null,
      accountType: 'GUEST',
      uiLabel: 'Guest',
      workspace: 'public',
      exchangeEnabled: false,
      canList: false,
      canPurchase: false,
      sellerIntent: false,
      needsBuyerEnable: false,
      displayName: '',
      raw: null,
    };
  }

  const listFlag = user.can_list;
  const raw = String(user.exchange_role || user.role || '').toLowerCase();
  const sellerIntent = raw === 'creator' || raw === 'seller' || raw === 'admin';
  const caps = user.capabilities || {};
  const canList = listFlag === true || listFlag === 1 || caps.sell === true;
  const canPurchase = true;
  const needsBuyerEnable = false;

  let uiLabel = 'Pinit Account';
  if (canList && canPurchase) uiLabel = 'Buy & Sell';
  else if (sellerIntent && canPurchase) uiLabel = 'Buy · sell pending';

  return {
    userId: user.id || user.pinit_id || null,
    pinitId: user.pinit_id || '',
    role: sellerIntent ? 'SELLER' : 'BUYER',
    accountType: user.account_type || (sellerIntent ? 'CREATOR_AND_BUYER' : 'BUYER'),
    uiLabel,
    workspace: canList ? 'both' : 'buyer',
    exchangeEnabled: true,
    canList,
    canPurchase,
    sellerIntent,
    needsBuyerEnable,
    sellerOnboardingComplete: user.seller_onboarding_complete !== false && canList,
    displayName: user.display_name || user.name || 'Account',
    raw: user,
  };
}

export function isSellerAccount(accountOrUser) {
  const a = accountOrUser?.role
    ? accountOrUser
    : resolveExchangeAccount(accountOrUser);
  return a.sellerIntent || a.role === 'SELLER';
}

export function isBuyerAccount(accountOrUser) {
  const a = accountOrUser?.role
    ? accountOrUser
    : resolveExchangeAccount(accountOrUser);
  return Boolean(a.canPurchase);
}
