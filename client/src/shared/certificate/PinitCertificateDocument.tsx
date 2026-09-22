import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import { certificateVerifyUrl } from './verify-origin';

const EMBLEM_SRC = '/pinit-hub-emblem-cut.png';
const SEAL_SRC = '/pinit-hub-seal-cut.png';

/**
 * THE canonical Pinit certificate.
 *
 * One certificate, one design, many places it can be shown: the Hub preview, the
 * PDF download, public verification, the portfolio and Exchange all render THIS
 * component. Nothing here decides what a certificate says — every value on the
 * sheet arrives as a prop from the Certificate record, which is the source of
 * truth. Displaying a certificate never creates one.
 *
 * Shared deliberately: the Hub and Exchange are separate builds, and a copy per
 * app is how the design drifts. Both import this file.
 *
 * The certificate is laid out against the approved artwork at its real size —
 * 1536 x 1024 — and the whole sheet is then scaled to whatever box it is given.
 *
 * Every measurement below is therefore a literal pixel from that artwork rather
 * than a percentage guess, which is what keeps the proportions identical at a
 * thumbnail, on the preview modal, and in an exported PDF. `u` is the scale
 * factor: one artwork pixel, expressed in rendered pixels.
 */
const ART_W = 1536;
const ART_H = 1024;

const NAVY = '#0c2340';
const NAVY_DEEP = '#0a1c33';
const INK = '#13233c';
const MUTED = '#5b6b80';
const RULE = '#c9d2de';

/**
 * What the certificate establishes, stated on the sheet itself.
 *
 * Pinit records and verifies evidence about a protected asset. It is not a
 * registration authority and does not adjudicate ownership, so the certificate
 * must not read as if it did — this is what keeps it usable as evidence in a
 * DMCA notice or a platform dispute without overclaiming.
 */
export const EVIDENCE_NOTICE =
  'This certificate records a protected digital asset and its associated evidence on Pinit HUB. ' +
  'It is not a government-issued copyright registration and does not constitute a legal determination ' +
  'of ownership, infringement, or other legal rights.';

export function PinitCertificateDocument({
  title,
  issuer,
  issuedLabel,
  recipientName,
  recipientPinitId,
  certificateId,
  trustLabel = 'PINIT VERIFIED',
  className = '',
  verifyBaseUrl,
  subtitle = 'PROTECTED ASSET',
  assetRecord,
  showEvidenceNotice = true,
}: {
  title: string;
  issuer: string;
  issuedLabel: string | null;
  recipientName?: string | null;
  recipientPinitId?: string | null;
  certificateId?: string | null;
  trustLabel?: string;
  className?: string;
  /** Public asset reference (PH-ASSET-XXXXXXXX). The full SHA-256 stays on verification. */
  assetRecord?: string | null;
  /** The evidence-record notice. Only a preview inside the Hub may turn it off. */
  showEvidenceNotice?: boolean;
  /**
   * Where verification lives. The QR must resolve to the SAME certificate no matter
   * which app drew the sheet, so Exchange passes the Hub's URL; inside the Hub the
   * page's own origin is already correct.
   */
  verifyBaseUrl?: string | null;
  subtitle?: string;
}) {
  const [qrSrc, setQrSrc] = useState<string | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(1);

  // One canonical public origin, never the origin that happens to be drawing the
  // sheet — see verify-origin.ts.
  const verifyUrl = certificateId ? certificateVerifyUrl(certificateId, verifyBaseUrl) : '';

  useEffect(() => {
    if (!verifyUrl) {
      setQrSrc(null);
      return;
    }
    let cancelled = false;
    void QRCode.toDataURL(verifyUrl, {
      margin: 0,
      width: 320,
      color: { dark: '#0a1628', light: '#ffffff' },
    })
      .then((src) => { if (!cancelled) setQrSrc(src); })
      .catch(() => { if (!cancelled) setQrSrc(null); });
    return () => { cancelled = true; };
  }, [verifyUrl]);

  // One observer drives every dimension on the sheet.
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const apply = () => {
      const w = host.clientWidth;
      if (w > 0) setScale(w / ART_W);
    };
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(host);
    return () => ro.disconnect();
  }, []);

  /** Artwork pixels → rendered pixels. */
  const u = (px: number) => `${px * scale}px`;

  const sans = 'Montserrat, Inter, system-ui, sans-serif';
  const serif = '"Playfair Display", Georgia, serif';

  /**
   * The title is the one field whose length is not ours to control — it is the
   * file's own name, and "WhatsApp Video 2026-09-10 at 16.49.43.mp4" is as normal
   * as "Kochi.jpg". Everything on this sheet is absolutely positioned at artwork
   * coordinates, so a title that grows downward collides with the ISSUED TO row
   * beneath it. Step the size down instead, and cap the band it may occupy.
   */
  const titleSize = (() => {
    const n = title.trim().length;
    // Sizes chosen so the longest wrap each one produces still fits TITLE_BAND:
    // 1 line at 72 (81), 2 at 48 (107), 3 at 32 (107), 3 at 26 (87).
    if (n <= 14) return 72;
    if (n <= 26) return 48;
    if (n <= 44) return 32;
    return 26;
  })();

  /** Artwork pixels the title may occupy before it would reach the ISSUED TO row. */
  const TITLE_BAND = 112;

  const label = (size: number, tracking: number, color = MUTED) => ({
    fontFamily: sans,
    fontSize: u(size),
    letterSpacing: u(tracking),
    color,
    fontWeight: 500 as const,
    lineHeight: 1.2,
  });

  return (
    <div
      ref={hostRef}
      className={`relative overflow-hidden ${className}`}
      style={{ aspectRatio: `${ART_W} / ${ART_H}`, background: '#eef1f6' }}
      aria-label={`Certificate document for ${title}`}
    >
      {/* ── the sheet ─────────────────────────────────────────────── */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(150deg, #ffffff 0%, #f4f7fb 45%, #eaeff6 100%)',
        }}
      >
        {/* guilloche — faint concentric wave, as on the artwork */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: [
              `repeating-radial-gradient(circle at 72% 46%, transparent 0, transparent ${u(26)}, rgba(18,45,80,0.030) ${u(27)}, transparent ${u(29)})`,
              `repeating-radial-gradient(circle at 72% 46%, transparent 0, transparent ${u(54)}, rgba(18,45,80,0.022) ${u(55)}, transparent ${u(58)})`,
              `repeating-linear-gradient(112deg, transparent 0, transparent ${u(30)}, rgba(18,45,80,0.016) ${u(31)}, transparent ${u(33)})`,
            ].join(', '),
          }}
        />
        {/* watermark emblem */}
        <img
          src={EMBLEM_SRC}
          alt=""
          aria-hidden
          className="pointer-events-none absolute"
          style={{
            left: u(1010), top: u(300), width: u(370),
            opacity: 0.05, filter: 'grayscale(1)',
          }}
        />
      </div>

      {/* ── outer frame: hairline, gap, hairline ──────────────────── */}
      <div
        className="absolute pointer-events-none"
        style={{
          left: u(16), top: u(16), right: u(16), bottom: u(16),
          border: `${u(2)} solid ${NAVY}`,
        }}
      />
      <div
        className="absolute pointer-events-none"
        style={{
          left: u(26), top: u(26), right: u(26), bottom: u(26),
          border: `${u(1)} solid rgba(12,35,64,0.45)`,
        }}
      />

      {/* ── left navy panel, wave edge ────────────────────────────── */}
      <svg
        className="absolute"
        style={{ left: 0, top: 0, width: u(470), height: '100%' }}
        viewBox="0 0 470 1024"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <linearGradient id="pc-navy" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#17395f" />
            <stop offset="45%" stopColor={NAVY_DEEP} />
            <stop offset="100%" stopColor="#06111f" />
          </linearGradient>
          <linearGradient id="pc-edge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4fb4ff" stopOpacity="0.15" />
            <stop offset="22%" stopColor="#7fd4ff" stopOpacity="0.95" />
            <stop offset="55%" stopColor="#5ec4ff" stopOpacity="1" />
            <stop offset="82%" stopColor="#7fd4ff" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#4fb4ff" stopOpacity="0.15" />
          </linearGradient>
          <filter id="pc-glow" x="-60%" y="-8%" width="220%" height="116%">
            <feGaussianBlur stdDeviation="7" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* the S-sweep: out at the shoulder, in at the waist, out again at the foot */}
        <path
          d="M0,0 L392,0 C 418,190 330,330 352,520 C 372,700 322,860 386,1024 L0,1024 Z"
          fill="url(#pc-navy)"
        />
        <path
          d="M392,0 C 418,190 330,330 352,520 C 372,700 322,860 386,1024"
          fill="none"
          stroke="url(#pc-edge)"
          strokeWidth="5"
          filter="url(#pc-glow)"
        />
      </svg>

      {/* left panel contents */}
      <div
        className="absolute flex flex-col items-center text-center"
        style={{ left: u(40), top: u(120), width: u(300) }}
      >
        <img src={EMBLEM_SRC} alt="" style={{ width: u(215) }} />
        <p
          style={{
            ...label(27, 9.5, '#cfe4f7'),
            marginTop: u(30), fontWeight: 400,
          }}
        >
          PINIT HUB
        </p>
        <div style={{ width: u(250), height: u(1), background: 'rgba(255,255,255,0.22)', marginTop: u(22) }} />
        <p style={{ ...label(11.5, 4.2, '#a9c2da'), marginTop: u(18) }}>
          SECURE · CONNECT · CONTROL
        </p>
      </div>

      <div className="absolute" style={{ left: u(66), top: u(760), width: u(270) }}>
        <p style={{ ...label(14.5, 4.6, '#b9cee2'), lineHeight: 1.95 }}>
          PROTECTING<br />CREATIVE WORK.<br />POWERING<br />A TRUSTED TOMORROW.
        </p>
        <div style={{ width: u(58), height: u(1), background: 'rgba(255,255,255,0.35)', marginTop: u(30) }} />
      </div>

      {/* ── certificate id, top right ─────────────────────────────── */}
      {certificateId && (
        <div className="absolute text-right" style={{ right: u(96), top: u(84), width: u(560) }}>
          <p style={label(12.5, 4.4)}>CERTIFICATE ID</p>
          <p
            style={{
              fontFamily: '"JetBrains Mono", ui-monospace, monospace',
              fontSize: u(13.5), letterSpacing: u(0.6), color: INK,
              marginTop: u(10), wordBreak: 'break-all',
            }}
          >
            {certificateId}
          </p>
        </div>
      )}

      {/* ── QR, under the id ──────────────────────────────────────── */}
      {qrSrc && (
        <div className="absolute text-center" style={{ right: u(88), top: u(172), width: u(128) }}>
          <img
            src={qrSrc}
            alt="Verify on Pinit Hub"
            style={{ width: u(128), height: u(128), background: '#fff', padding: u(6) }}
          />
          <p style={{ ...label(11, 3.4), marginTop: u(12), lineHeight: 1.5 }}>
            VERIFY ON<br />PINIT HUB
          </p>
        </div>
      )}

      {/* ── main body, left aligned ───────────────────────────────── */}
      <div className="absolute" style={{ left: u(498), top: u(120), width: u(760) }}>
        <p style={label(16, 6.6, '#4a5c74')}>PINIT HUB</p>

        <h1
          style={{
            fontFamily: serif, fontWeight: 700, color: NAVY,
            fontSize: u(96), lineHeight: 1, letterSpacing: u(1),
            marginTop: u(18),
          }}
        >
          CERTIFICATE
        </h1>

        <p style={{ ...label(21, 9.5, '#3d5170'), marginTop: u(22), fontWeight: 400 }}>
          {subtitle}
        </p>

        <div className="flex items-center" style={{ marginTop: u(26), gap: u(18) }}>
          <span style={{ height: u(1), width: u(150), background: RULE }} />
          <span
            style={{
              fontFamily: sans, fontSize: u(15), letterSpacing: u(5),
              color: '#1a6fc4', fontWeight: 600,
            }}
          >
            {trustLabel.toUpperCase()}
          </span>
          <span style={{ height: u(1), width: u(150), background: RULE }} />
        </div>
      </div>

      <div className="absolute" style={{ left: u(498), top: u(400), width: u(720) }}>
        <p style={label(13.5, 4.6)}>THIS CERTIFIES THAT</p>
        {/* Fixed band: the wording below always starts at the same place, whether the
            title is one word or a full filename. */}
        <div style={{ height: u(TITLE_BAND), marginTop: u(12), overflow: 'hidden' }}>
          <p
            style={{
              fontFamily: serif, fontWeight: 500, color: NAVY,
              fontSize: u(titleSize), lineHeight: 1.12,
              display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
              // A filename is one long token; let it break rather than run off the sheet.
              overflowWrap: 'anywhere', wordBreak: 'break-word',
            }}
            title={title}
          >
            {title}
          </p>
        </div>
        <p
          style={{
            fontFamily: sans, fontSize: u(19), lineHeight: 1.62,
            color: '#43546c', marginTop: u(8), maxWidth: u(600),
          }}
        >
          is a protected digital asset, securely recorded and
          <br />verified on the Pinit Hub platform.
        </p>
      </div>

      {/* ── issued to / by / date ─────────────────────────────────── */}
      <div className="absolute flex" style={{ left: u(498), top: u(620) }}>
        <div style={{ width: u(215) }}>
          <p style={label(12.5, 4.2)}>ISSUED TO</p>
          <p style={{ fontFamily: sans, fontSize: u(21), color: INK, marginTop: u(14) }}>
            {recipientName || '—'}
          </p>
          {recipientPinitId && (
            <p style={{ fontFamily: sans, fontSize: u(19), color: '#4a5c74', marginTop: u(8) }}>
              ({recipientPinitId})
            </p>
          )}
        </div>
        <div style={{ width: u(1), background: RULE, margin: `0 ${u(28)}`, alignSelf: 'stretch' }} />
        <div style={{ width: u(145) }}>
          <p style={label(12.5, 4.2)}>ISSUED BY</p>
          <p style={{ fontFamily: sans, fontSize: u(21), color: INK, marginTop: u(14) }}>{issuer}</p>
        </div>
        <div style={{ width: u(1), background: RULE, margin: `0 ${u(28)}`, alignSelf: 'stretch' }} />
        <div style={{ width: u(195) }}>
          <p style={label(12.5, 4.2)}>DATE OF ISSUE</p>
          <p style={{ fontFamily: sans, fontSize: u(21), color: INK, marginTop: u(14) }}>
            {issuedLabel || '—'}
          </p>
        </div>
      </div>

      {/* ── signature ─────────────────────────────────────────────── */}
      <div className="absolute" style={{ left: u(498), top: u(760) }}>
        <p
          style={{
            fontFamily: '"Great Vibes", cursive', color: NAVY,
            fontSize: u(62), lineHeight: 1, paddingLeft: u(8),
          }}
        >
          Pinit
        </p>
        <div style={{ width: u(280), height: u(1), background: '#8fa0b6', marginTop: u(14) }} />
        <p style={{ ...label(13.5, 4.4, '#3d5170'), marginTop: u(16) }}>PINIT HUB</p>
        <p style={{ ...label(13.5, 4.4), marginTop: u(8) }}>PLATFORM AUTHORITY</p>
      </div>

      {/* ── verified seal ─────────────────────────────────────────── */}
      <img
        src={SEAL_SRC}
        alt="Pinit Verified seal"
        className="absolute"
        style={{ right: u(96), top: u(600), width: u(260), height: u(260), objectFit: 'contain' }}
      />

      {/* ── footer ────────────────────────────────────────────────── */}
      <div
        className="absolute text-center"
        style={{ left: u(470), right: u(60), bottom: u(86) }}
      >
        <p style={{ ...label(15, 6.2, '#1f4d80'), fontWeight: 600 }}>
          SECURE · CONNECT · CONTROL
        </p>
        <p style={{ ...label(12, 3.4, '#7c8ba0'), marginTop: u(12) }}>
          PINIT. PROTECT WHAT MATTERS.
        </p>
      </div>

      {/* ── record band ───────────────────────────────────────────────
          The asset this certificate is bound to, and what the certificate
          establishes. Its own band at the foot of the sheet so it never crowds
          the signature — the full SHA-256 lives on the verification page. */}
      <div
        className="absolute text-center"
        style={{ left: u(470), right: u(60), bottom: u(22) }}
      >
        {assetRecord && (
          <p style={label(11, 2.6, '#8a98ab')}>
            ASSET RECORD: {assetRecord} · SHA-256 INTEGRITY RECORD AVAILABLE ON VERIFICATION
          </p>
        )}
        {showEvidenceNotice && (
          <p
            style={{
              fontFamily: sans,
              fontSize: u(10.5),
              lineHeight: 1.45,
              color: '#94a1b2',
              marginTop: assetRecord ? u(7) : 0,
            }}
          >
            {EVIDENCE_NOTICE}
          </p>
        )}
      </div>

    </div>
  );
}
