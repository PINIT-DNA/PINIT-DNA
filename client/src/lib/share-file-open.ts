/**
 * Build a shareable file that opens on Pinit HUB when the recipient opens it.
 * WhatsApp/Email get a file attachment (not a pasted link). Opening routes to Pinit.
 */

function isHtmlFile(fileName: string, mimeType?: string | null): boolean {
  const lower = fileName.toLowerCase();
  const mime = (mimeType ?? '').toLowerCase();
  return (
    lower.endsWith('.html')
    || lower.endsWith('.htm')
    || lower.endsWith('.xhtml')
    || mime.includes('html')
  );
}

/** Inject an immediate redirect to the Pinit open page (tracked VIEWED). */
export function injectPinitOpenRedirect(html: string, openUrl: string): string {
  const safeUrl = JSON.stringify(openUrl);
  const bridge = [
    '<!-- Pinit HUB open bridge -->',
    `<meta http-equiv="refresh" content="0;url=${openUrl.replace(/"/g, '&quot;')}">`,
    `<script>(function(){try{location.replace(${safeUrl});}catch(e){location.href=${safeUrl};}})();</script>`,
    `<noscript><p>Open this file on Pinit HUB: <a href="${openUrl.replace(/"/g, '&quot;')}">${openUrl.replace(/</g, '')}</a></p></noscript>`,
  ].join('');

  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${bridge}`);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html([^>]*)>/i, `<html$1><head>${bridge}</head>`);
  }
  return `<!DOCTYPE html><html><head>${bridge}<meta charset="utf-8"><title>Pinit HUB</title></head><body></body></html>`;
}

function buildPinitLauncherHtml(openUrl: string, filename: string): string {
  const safeUrl = JSON.stringify(openUrl);
  const safeName = filename.replace(/</g, '');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="0;url=${openUrl.replace(/"/g, '&quot;')}">
  <title>${safeName} · Pinit HUB</title>
  <script>(function(){try{location.replace(${safeUrl});}catch(e){location.href=${safeUrl};}})();</script>
</head>
<body style="font-family:system-ui,sans-serif;background:#0b1220;color:#e5e7eb;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;">
  <p>Opening <strong>${safeName}</strong> on Pinit HUB…<br>
  <a href="${openUrl.replace(/"/g, '&quot;')}" style="color:#38bdf8">Continue</a></p>
</body>
</html>`;
}

function htmlShareFileName(originalName: string): string {
  const base = originalName.replace(/\.[^.]+$/, '') || 'file';
  return `${base}.html`;
}

/**
 * Prepare the attachment for Share File:
 * - HTML → same filename, redirect injected so open → Pinit page
 * - Other → HTML launcher file (still a file, not a chat link) that opens Pinit
 */
export async function buildShareFileAttachment(params: {
  source: Blob;
  originalFileName: string;
  originalMimeType?: string | null;
  openUrl: string;
}): Promise<File> {
  const { source, originalFileName, originalMimeType, openUrl } = params;

  if (isHtmlFile(originalFileName, originalMimeType)) {
    const text = await source.text();
    const bridged = injectPinitOpenRedirect(text, openUrl);
    return new File([bridged], originalFileName, { type: 'text/html;charset=utf-8' });
  }

  const launcher = buildPinitLauncherHtml(openUrl, originalFileName);
  return new File([launcher], htmlShareFileName(originalFileName), {
    type: 'text/html;charset=utf-8',
  });
}
