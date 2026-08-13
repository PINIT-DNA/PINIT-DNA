/**
 * Single Exchange account authority.
 *
 * Hub identity (PINIT-*) is shared. Exchange role is not guessed per page.
 * Backend `/api/auth/me` fields `exchange_role` + `can_list` are the source of truth.
 * localStorage only stores pinit_id so the session can be restored — never the role.
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
      displayName: '',
      raw: null,
    };
  }

  const listFlag = user.can_list;
  const raw = String(user.exchange_role || user.role || '').toLowerCase();
  const rawSeller = raw === 'creator' || raw === 'seller' || raw === 'admin';

  let role = 'BUYER';
  if (listFlag === true || listFlag === 1) role = 'SELLER';
  else if (listFlag === false || listFlag === 0) role = 'BUYER';
  else if (rawSeller) role = 'SELLER';

  const seller = role === 'SELLER';
  return {
    userId: user.id || user.pinit_id || null,
    pinitId: user.pinit_id || '',
    role,
    accountType: seller ? 'CREATOR' : 'BUYER',
    uiLabel: seller ? 'Creator Account' : 'Buyer Account',
    workspace: seller ? 'seller' : 'buyer',
    exchangeEnabled: true,
    canList: seller,
    canPurchase: !seller,
    displayName: user.display_name || user.name || (seller ? 'Creator' : 'Buyer'),
    raw: user,
  };
}

export function isSellerAccount(accountOrUser) {
  const a = accountOrUser?.role
    ? accountOrUser
    : resolveExchangeAccount(accountOrUser);
  return a.role === 'SELLER';
}

export function isBuyerAccount(accountOrUser) {
  const a = accountOrUser?.role
    ? accountOrUser
    : resolveExchangeAccount(accountOrUser);
  return a.role === 'BUYER';
}
