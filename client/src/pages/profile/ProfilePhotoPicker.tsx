import { useRef, useState } from 'react';
import { Camera, Loader2, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { api } from '../../services/dashboard.api';
import { API_BASE_URL } from '../../config/api.config';
import { notifyProfileUpdated } from '../../hooks/useUserProfile';

export function ProfilePhotoPicker({
  photoUrl,
  name,
  onChange,
  compact = false,
}: {
  photoUrl: string;
  name: string;
  onChange: (url: string) => void;
  compact?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const letter = (name || 'P').trim().charAt(0).toUpperCase() || 'P';

  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('Choose a photo (JPG, PNG, or WEBP).');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error('Keep the photo under 3 MB.');
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append('avatar', file);
      const { data } = await api.post(`${API_BASE_URL}/profile/avatar`, body, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const next = String((data as { profile?: { avatarUrl?: string } })?.profile?.avatarUrl || '');
      onChange(next);
      notifyProfileUpdated();
      toast.success('Photo saved');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      toast.error(msg || 'Could not upload that photo.');
    }
    setBusy(false);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await api.delete(`${API_BASE_URL}/profile/avatar`);
      onChange('');
      notifyProfileUpdated();
      toast.success('Photo removed');
    } catch {
      toast.error('Could not remove the photo.');
    }
    setBusy(false);
  };

  return (
    <div className={compact ? 'flex items-center gap-3' : 'pe-photo'}>
      <button
        type="button"
        className={compact ? 'relative w-16 h-16 rounded-full overflow-hidden shrink-0 border border-bg-border' : 'pe-photo__face'}
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        aria-label="Change profile photo"
      >
        {photoUrl
          ? <img src={photoUrl} alt="" className={compact ? 'w-full h-full object-cover' : 'pe-photo__img'} />
          : <span className={compact ? 'w-full h-full flex items-center justify-center bg-gradient-to-br from-dna-500 to-purple text-white text-xl font-bold' : 'pe-photo__letter'}>{letter}</span>}
        {busy ? (
          <span className={compact ? 'absolute inset-0 bg-black/50 flex items-center justify-center' : 'pe-photo__busy'}>
            <Loader2 size={16} className="animate-spin text-white" />
          </span>
        ) : null}
      </button>
      <div className={compact ? 'flex flex-col gap-1' : 'pe-photo__act'}>
        <button type="button" className={compact ? 'btn btn-secondary btn-sm text-xs' : 'pe-btn'} onClick={() => inputRef.current?.click()} disabled={busy}>
          <Camera size={13} /> {photoUrl ? 'Change photo' : 'Add photo'}
        </button>
        {photoUrl ? (
          <button type="button" className={compact ? 'text-xs text-gray-500 hover:text-red-400' : 'pe-btn pe-photo__remove'} onClick={remove} disabled={busy}>
            <Trash2 size={13} /> Remove
          </button>
        ) : null}
        {!compact ? <span className="pe-field__hint">Shown on your portfolio and in the Hub. JPG, PNG, or WEBP, under 3 MB.</span> : null}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif"
        hidden
        onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }}
      />
    </div>
  );
}
