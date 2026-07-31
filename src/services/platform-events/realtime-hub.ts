/**
 * In-process pub/sub for SSE notification streams (per user).
 */

type Listener = () => void | Promise<void>;

const listeners = new Map<string, Set<Listener>>();

export const realtimeHub = {
  subscribe(userId: string, listener: Listener): () => void {
    if (!listeners.has(userId)) listeners.set(userId, new Set());
    listeners.get(userId)!.add(listener);
    return () => listeners.get(userId)?.delete(listener);
  },

  async notify(userId: string): Promise<void> {
    const set = listeners.get(userId);
    if (!set?.size) return;
    await Promise.all([...set].map(fn => Promise.resolve(fn()).catch(() => {})));
  },
};
