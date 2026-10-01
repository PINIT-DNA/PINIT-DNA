import { buildPinitDocument } from '../../../src/lib/pinit-file';

export type PinitShareChannel = 'whatsapp' | 'email';

/** A .pinit carrier as a real file. Does not include the vault asset. */
export function createPinitFile(input: {
  token: string;
  name?: string | null;
}): { ok: true; file: File; filename: string } | { ok: false } {
  const built = buildPinitDocument(input);
  if (!built.ok) return { ok: false };
  const file = new File([built.body], built.filename, { type: 'application/octet-stream' });
  return { ok: true, file, filename: built.filename };
}

function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1500);
}

/** Save a .pinit carrier in the browser. Does not fetch or attach the vault file. */
export function downloadPinitCarrier(input: {
  token: string;
  name?: string | null;
}): { ok: true; filename: string } | { ok: false } {
  const created = createPinitFile(input);
  if (!created.ok) return { ok: false };
  saveFile(created.file);
  return { ok: true, filename: created.filename };
}

function openTab(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

/**
 * Open WhatsApp or Gmail first, then save the .pinit file.
 * The app has to open before the download, or the browser blocks the redirect.
 * The saved file is what gets attached. A chat link cannot carry the file.
 */
export function sharePinitFile(file: File, channel: PinitShareChannel): 'attach' {
  if (channel === 'whatsapp') {
    openTab('https://web.whatsapp.com/');
  } else {
    openTab('https://mail.google.com/mail/?view=cm&fs=1');
  }
  saveFile(file);
  return 'attach';
}
