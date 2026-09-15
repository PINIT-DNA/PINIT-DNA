import { useEffect, useRef, useState } from 'react';
import { Loader2, Pencil, Trash2, Upload } from 'lucide-react';
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const letter = (name || 'P').trim().charAt(0).toUpperCase() || 'P';

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

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
    setOpen(false);
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
    setOpen(false);
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
    <div ref={wrapRef} className={compact ? 'pe-photo pe-photo--compact' : 'pe-photo'}>
      <div className="pe-photo__wrap">
        <span className="pe-photo__face">
          {photoUrl
            ? <img src={photoUrl} alt="" className="pe-photo__img" />
            : <span className="pe-photo__letter">{letter}</span>}
          {busy ? (
            <span className="pe-photo__busy">
              <Loader2 size={16} className="animate-spin text-white" />
            </span>
          ) : null}
        </span>
        <button
          type="button"
          className="pe-photo__pencil"
          onClick={() => setOpen((v) => !v)}
          disabled={busy}
          aria-label="Edit profile photo"
          aria-expanded={open}
        >
          <Pencil size={compact ? 12 : 14} />
        </button>
        {open ? (
          <div className="pe-photo__menu" role="menu">
            <button type="button" role="menuitem" onClick={() => inputRef.current?.click()} disabled={busy}>
              <Upload size={14} /> Upload
            </button>
            {photoUrl ? (
              <button type="button" role="menuitem" className="is-danger" onClick={() => void remove()} disabled={busy}>
                <Trash2 size={14} /> Remove
              </button>
            ) : null}
          </div>
        ) : null}
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
