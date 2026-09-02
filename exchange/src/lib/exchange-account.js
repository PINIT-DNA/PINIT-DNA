/**
 * One Pinit identity. Buying and selling are capabilities on that identity.
 * Frontend labels come from API flags (can_purchase / can_list), not a second account.
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
  const buyFlag = user.can_purchase;
  const canPurchase = sellerIntent
    ? (buyFlag === true || buyFlag === 1 || caps.buy === true
      || user.buyer_enabled === true || user.buyer_enabled === 1 || user.buyer_enabled === '1')
    : (buyFlag !== false && buyFlag !== 0);
  const needsBuyerEnable = sellerIntent && !canPurchase;

  let uiLabel = 'Buyer Account';
  if (canPurchase && (canList || sellerIntent)) uiLabel = 'Buyer & Creator';
  else if (sellerIntent) uiLabel = 'Seller Account';

  return {
    userId: user.id || user.pinit_id || null,
    pinitId: user.pinit_id || '',
    role: sellerIntent ? 'SELLER' : 'BUYER',
    accountType: user.account_type || (canPurchase && sellerIntent
      ? 'CREATOR_AND_BUYER'
      : (sellerIntent ? 'CREATOR' : 'BUYER')),
    uiLabel,
    workspace: canList && canPurchase ? 'both' : (canList || sellerIntent ? 'seller' : 'buyer'),
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
