import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { buyerKey } from '../lib/buyer.js';
import { extractPinitCode, samePinitIdentity } from '../lib/pinit-identity.js';

export default function FollowCreatorButton({
  user,
  creatorPinitId,
  onOpenAuth,
  className = '',
}) {
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = samePinitIdentity(user?.pinit_id, creatorPinitId);

  useEffect(() => {
    const key = buyerKey(user);
    if (!key || !creatorPinitId || own) {
      setFollowing(false);
      return undefined;
    }
    let cancelled = false;
    apiFetch(`/api/commerce/follows?buyer_key=${encodeURIComponent(key)}`).then(({ ok, data }) => {
      if (cancelled || !ok) return;
      const code = extractPinitCode(creatorPinitId);
      setFollowing((data.items || []).some((row) => (
        row.creator_pinit_id === creatorPinitId
        || extractPinitCode(row.creator_pinit_id) === code
      )));
    });
    return () => { cancelled = true; };
  }, [user?.pinit_id, user?.email, creatorPinitId, own]);

  if (!creatorPinitId || own) return null;

  const toggle = async (e) => {
    e?.stopPropagation?.();
    if (!user?.pinit_id) {
      onOpenAuth?.({ mode: 'login', intent: 'buyer' });
      return;
    }
    const key = buyerKey(user);
    if (!key || busy) return;
    setBusy(true);
    if (following) {
      const { ok } = await apiFetch(
        `/api/commerce/follows/${encodeURIComponent(creatorPinitId)}?buyer_key=${encodeURIComponent(key)}`,
        { method: 'DELETE' },
      );
      if (ok) setFollowing(false);
    } else {
      const { ok } = await apiFetch('/api/commerce/follows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ buyer_key: key, creator_pinit_id: creatorPinitId }),
      });
      if (ok) setFollowing(true);
    }
    setBusy(false);
  };

  return (
    <button
      type="button"
      className={`follow-btn ${following ? 'is-on' : ''} ${className}`.trim()}
      onClick={toggle}
      disabled={busy}
      aria-pressed={following}
    >
      {busy ? '…' : following ? 'Following' : 'Follow'}
    </button>
  );
}
