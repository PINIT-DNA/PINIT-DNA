/**
 * Single Exchange account authority.
 *
 * Hub identity (PINIT-*) is shared. Selling and buying are capabilities.
 * Creators who signed up only to sell enable buying via Create Buyer Account.
 * Buyers who start selling keep buying (buyer_enabled stays on).
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
  const canPurchase = user.can_purchase === true || user.can_purchase === 1
    || caps.buy === true
    || user.buyer_enabled === true || user.buyer_enabled === 1;
  const needsBuyerEnable = Boolean(user.needs_buyer_enable) || (sellerIntent && !canPurchase);

  let uiLabel = 'Buyer Account';
  if (canList && canPurchase) uiLabel = 'Buyer & Creator';
  else if (sellerIntent && canPurchase) uiLabel = 'Buyer · seller activation pending';
  else if (sellerIntent) uiLabel = 'Creator Account';

  return {
    userId: user.id || user.pinit_id || null,
    pinitId: user.pinit_id || '',
    role: sellerIntent ? 'SELLER' : 'BUYER',
    accountType: user.account_type || (sellerIntent ? 'CREATOR' : 'BUYER'),
    uiLabel,
    workspace: canList && canPurchase ? 'both' : (canList ? 'seller' : 'buyer'),
    exchangeEnabled: true,
    canList,
    canPurchase,
    sellerIntent,
    needsBuyerEnable,
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
