import { useEffect, useState } from 'react';
import { buildPinitCarrier, pinitStoredFileName } from '../../core/pinit-parser';

interface AssetViewProps {
  token: string;
  blob: Blob;
  mimeType: string;
  filename: string;
  allowDownload: boolean;
  downloadNote: string;
}

export function AssetView({ token, blob, mimeType, filename, allowDownload, downloadNote }: AssetViewProps) {
  const [url, setUrl] = useState('');
  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);

  useEffect(() => {
    if (!mimeType.startsWith('text/') || mimeType === 'text/html') {
      setText(null);
      return;
    }
    let cancelled = false;
    blob.text().then((value) => {
      if (!cancelled) setText(value.slice(0, 200_000));
    }).catch(() => {
      if (!cancelled) setText(null);
    });
    return () => { cancelled = true; };
  }, [blob, mimeType]);

  const shownName = pinitStoredFileName(filename);

  const save = () => {
    if (!allowDownload) return;
    const carrier = buildPinitCarrier(token, filename);
    if (!carrier) return;
    const file = new Blob([carrier.body], { type: 'application/json' });
    const objectUrl = URL.createObjectURL(file);
    const anchor = document.createElement('a');
    anchor.href = objectUrl;
    anchor.download = carrier.filename;
    anchor.click();
    URL.revokeObjectURL(objectUrl);
  };

  return (
    <section className="asset">
      <h2>{shownName}</h2>
      {mimeType.startsWith('image/') && url ? <img src={url} alt={shownName} /> : null}
      {mimeType.startsWith('video/') && url ? <video src={url} controls /> : null}
      {mimeType.startsWith('audio/') && url ? <audio src={url} controls /> : null}
      {mimeType === 'application/pdf' && url ? (
        <iframe title={shownName} src={url} sandbox="" />
      ) : null}
      {(mimeType === 'text/html' || mimeType === 'image/svg+xml') && url ? (
        <iframe title={shownName} src={url} sandbox="" />
      ) : null}
      {text != null ? <pre>{text}</pre> : null}
      {!mimeType.startsWith('image/')
        && !mimeType.startsWith('video/')
        && !mimeType.startsWith('audio/')
        && mimeType !== 'application/pdf'
        && mimeType !== 'text/html'
        && mimeType !== 'image/svg+xml'
        && text == null ? (
          <p>This file is open, and this Reader cannot preview this format yet.</p>
        ) : null}
      {allowDownload ? (
        <button type="button" onClick={save}>Save a copy</button>
      ) : (
        <p className="note">{downloadNote}</p>
      )}
    </section>
  );
}
