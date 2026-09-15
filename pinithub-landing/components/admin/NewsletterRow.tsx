'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteSubscriber, setSubscriberActive } from '@/lib/admin/actions/inbox';

export function NewsletterRow({
  id,
  email,
  source,
  active,
  createdAt,
}: {
  id: string;
  email: string;
  source: string;
  active: boolean;
  createdAt: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const toggle = () => {
    setError('');
    startTransition(async () => {
      const result = await setSubscriberActive(id, !active);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  const remove = () => {
    if (!confirm(`Remove ${email} from the list?`)) return;
    setError('');
    startTransition(async () => {
      const result = await deleteSubscriber(id);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <tr className="border-b border-line last:border-b-0 hover:bg-white/[0.02]">
      <td className="px-4 py-3 text-paper">
        {email}
        {error && (
          <p role="alert" className="mt-1 text-[0.75rem] text-red-400">
            {error}
          </p>
        )}
      </td>
      <td className="px-4 py-3 text-mute">{source}</td>
      <td className="px-4 py-3 text-mute-2">{createdAt}</td>
      <td className="px-4 py-3">
        <span
          className={`inline-block rounded-full border px-2.5 py-1 text-[0.6875rem] font-medium ${
            active ? 'border-signal/40 bg-signal/10 text-signal' : 'border-line text-mute-2'
          }`}
        >
          {active ? 'Active' : 'Inactive'}
        </span>
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">
        <button
          type="button"
          onClick={toggle}
          disabled={pending}
          className="mr-3 text-[0.8125rem] text-mute-2 hover:text-paper disabled:opacity-40"
        >
          {active ? 'Deactivate' : 'Activate'}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="text-[0.8125rem] text-red-400/80 hover:text-red-400 disabled:opacity-40"
        >
          Remove
        </button>
      </td>
    </tr>
  );
}
