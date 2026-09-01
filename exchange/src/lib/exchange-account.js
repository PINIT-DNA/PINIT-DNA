/**
 * Single Exchange account authority.
 *
 * Hub identity (PINIT-*) is shared. Buying is always on for a signed-in user.
 * Selling is an additive capability after subscription verification.
 * Backend `/api/auth/me` fields `can_list` / `can_purchase` / `capabilities` are source of truth.
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
      displayName: '',
      raw: null,
    };
  }

  const listFlag = user.can_list;
  const raw = String(user.exchange_role || user.role || '').toLowerCase();
  const sellerIntent = raw === 'creator' || raw === 'seller' || raw === 'admin';
  const caps = user.capabilities || {};
  const canList = listFlag === true || listFlag === 1 || caps.sell === true;
  const canPurchase = user.can_purchase !== false && caps.buy !== false;

  let uiLabel = 'Buyer Account';
  if (canList && canPurchase) uiLabel = 'Buyer & Creator';
  else if (sellerIntent && !canList) uiLabel = 'Creator (activation pending)';
  else if (sellerIntent) uiLabel = 'Creator Account';

  return {
    userId: user.id || user.pinit_id || null,
    pinitId: user.pinit_id || '',
    role: sellerIntent ? 'SELLER' : 'BUYER',
    accountType: sellerIntent ? 'CREATOR' : 'BUYER',
    uiLabel,
    workspace: canList ? 'both' : (sellerIntent ? 'seller' : 'buyer'),
    exchangeEnabled: true,
    canList,
    canPurchase,
    sellerIntent,
    sellerOnboardingComplete: user.seller_onboarding_complete !== false && canList,
    displayName: user.display_name || user.name || (sellerIntent ? 'Creator' : 'Buyer'),
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
