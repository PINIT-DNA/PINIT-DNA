/** Limits concurrent vault preview fetches so the gallery does not overwhelm the API. */
const MAX_CONCURRENT = 3;
let active = 0;
const waiters: Array<() => void> = [];

function release(): void {
  active = Math.max(0, active - 1);
  const next = waiters.shift();
  if (next) next();
}

export function runVaultPreviewQueued<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      fn()
        .then(resolve, reject)
        .finally(release);
    };

    if (active < MAX_CONCURRENT) run();
    else waiters.push(run);
  });
}

export async function withVaultPreviewRetry<T>(
  fn: () => Promise<T>,
  attempts = 3,
  delayMs = 800,
): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (i < attempts - 1) {
        await new Promise(r => setTimeout(r, delayMs * (i + 1)));
      }
    }
  }
  throw lastError;
}
