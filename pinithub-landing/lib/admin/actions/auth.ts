'use server';

import { login as loginUser, logout as logoutUser } from '@/lib/auth/server';
import type { ActionResult } from '../types';

export async function loginAction(email: string, password: string): Promise<ActionResult> {
  if (!email.trim() || !password) return { ok: false, error: 'Enter your email and password.' };
  const result = await loginUser(email, password);
  if (!result.ok) return { ok: false, error: result.error };
  return { ok: true };
}

/** No redirect here — the client navigates itself so it can also clear local state. */
export async function logoutAction(): Promise<void> {
  await logoutUser();
}
