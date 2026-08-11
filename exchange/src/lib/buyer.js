/** Shared buyer key for cart/wishlist (avoid exporting helpers from page components — breaks Vite HMR). */
export function buyerKey(user) {
  return user?.pinit_id || user?.email || localStorage.getItem('pinit_guest_buyer') || '';
}
