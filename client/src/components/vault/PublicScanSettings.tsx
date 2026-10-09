import { useEffect, useState } from 'react';
import { API_BASE_URL } from '../../config/api.config';
import { api } from '../../services/dashboard.api';

interface ScanChoices {
  available: boolean;
  optOut: boolean;
  showTitle: boolean;
  showRecipient: boolean;
}

export function PublicScanSettings({ vaultId }: { vaultId: string }) {
  const [choices, setChoices] = useState<ScanChoices | null>(null);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.get(`${API_BASE_URL}/scan/settings/${vaultId}`)
      .then((res) => {
        if (!live) return;
        setChoices(res.data as ScanChoices);
      })
      .catch(() => {
        if (live) setNote('Public scan choices could not be loaded.');
      });
    return () => { live = false; };
  }, [vaultId]);

  const save = async (next: ScanChoices) => {
    setChoices(next);
    setNote(null);
    try {
      const res = await api.patch(`${API_BASE_URL}/scan/settings/${vaultId}`, {
        optOut: next.optOut,
        showTitle: next.showTitle,
        showRecipient: next.showRecipient,
      });
      setChoices(res.data as ScanChoices);
    } catch {
      setNote('These choices are not saved yet.');
      setChoices((prev) => (prev ? { ...prev, available: false } : prev));
    }
  };

  if (!choices) return null;

  return (
    <section>
      <h3 className="text-2xs font-semibold text-gray-600 dark:text-gray-300 uppercase tracking-wider mb-2">
        Public scan
      </h3>
      <div className="space-y-2 text-xs text-gray-700 dark:text-gray-200">
        <label className="flex items-center justify-between gap-3">
          <span>Hide this asset from public scan</span>
          <input
            type="checkbox"
            checked={choices.optOut}
            onChange={(event) => void save({ ...choices, optOut: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Show the asset title</span>
          <input
            type="checkbox"
            checked={choices.showTitle}
            disabled={choices.optOut}
            onChange={(event) => void save({ ...choices, showTitle: event.target.checked })}
          />
        </label>
        <label className="flex items-center justify-between gap-3">
          <span>Show who the copy was issued to</span>
          <input
            type="checkbox"
            checked={choices.showRecipient}
            disabled={choices.optOut}
            onChange={(event) => void save({ ...choices, showRecipient: event.target.checked })}
          />
        </label>
        <p className="text-gray-500">
          A public scan can show your name and the date this asset was first protected. The title and recipient stay hidden unless you turn them on.
        </p>
        {!choices.available && (
          <p className="text-amber-600">Saving these choices needs a database update that has not been applied.</p>
        )}
        {note && <p className="text-amber-600">{note}</p>}
      </div>
    </section>
  );
}
