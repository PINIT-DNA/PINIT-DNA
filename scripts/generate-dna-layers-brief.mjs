/**
 * One-off brief: PINIT DNA 15-layer protection.
 * Run: node scripts/generate-dna-layers-brief.mjs
 */
import { jsPDF } from 'jspdf';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'PINIT-DNA-15-Layer-Protection.pdf');

const doc = new jsPDF({ unit: 'mm', format: 'a4' });
const W = 210;
const H = 297;
const M = 16;
const CONTENT_W = W - M * 2;
let y = 0;

const NAVY = [11, 31, 58];
const BLUE = [29, 78, 216];
const SLATE = [30, 41, 59];
const MUTED = [71, 85, 105];
const LINE = [226, 232, 240];
const WASH = [241, 245, 249];

function setFill(rgb) { doc.setFillColor(...rgb); }
function setText(rgb) { doc.setTextColor(...rgb); }
function setDraw(rgb) { doc.setDrawColor(...rgb); }

function footer() {
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    setDraw(LINE);
    doc.setLineWidth(0.2);
    doc.line(M, H - 12, W - M, H - 12);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    setText(MUTED);
    doc.text('PINIT HUB  ·  DNA protection brief  ·  Internal technical description', M, H - 7);
    doc.text(`${i} / ${pages}`, W - M, H - 7, { align: 'right' });
  }
}

function need(h) {
  if (y + h > H - 18) {
    doc.addPage();
    y = 18;
  }
}

function h1(text) {
  need(16);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  setText(NAVY);
  doc.text(text, M, y);
  y += 3;
  setFill(BLUE);
  doc.rect(M, y, 28, 0.8, 'F');
  y += 8;
}

function h2(text) {
  need(12);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  setText(NAVY);
  doc.text(text, M, y);
  y += 6;
}

function para(text) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setText(SLATE);
  const lines = doc.splitTextToSize(text, CONTENT_W);
  need(lines.length * 4.6 + 2);
  doc.text(lines, M, y);
  y += lines.length * 4.6 + 3;
}

function bullet(text) {
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setText(SLATE);
  const lines = doc.splitTextToSize(text, CONTENT_W - 6);
  need(lines.length * 4.6 + 1);
  setFill(BLUE);
  doc.circle(M + 1.2, y - 1.1, 0.7, 'F');
  doc.text(lines, M + 5, y);
  y += lines.length * 4.6 + 1.2;
}

function labelValue(label, value) {
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setText(BLUE);
  const labelLines = doc.splitTextToSize(label, 32);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setText(SLATE);
  const valueLines = doc.splitTextToSize(value, CONTENT_W - 36);
  const h = Math.max(labelLines.length, valueLines.length) * 4.2;
  need(h + 1);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  setText(BLUE);
  doc.text(labelLines, M, y);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  setText(SLATE);
  doc.text(valueLines, M + 36, y);
  y += h + 1.4;
}

// Cover
setFill(NAVY);
doc.rect(0, 0, W, H, 'F');
setFill(BLUE);
doc.rect(0, 0, 6, H, 'F');
doc.setFont('helvetica', 'bold');
doc.setFontSize(11);
setText([186, 210, 255]);
doc.text('PINIT HUB', M + 4, 48);
doc.setFontSize(28);
setText([255, 255, 255]);
const title = doc.splitTextToSize('15-layer DNA protection', CONTENT_W);
doc.text(title, M + 4, 68);
doc.setFont('helvetica', 'normal');
doc.setFontSize(12);
setText([203, 213, 225]);
const sub = doc.splitTextToSize(
  'How a protected asset is created, what each layer does, which extra technology is used, and how the original file is encrypted.',
  CONTENT_W - 8,
);
doc.text(sub, M + 4, 96);
doc.setFontSize(10);
doc.text('Prepared from the PINIT-DNA implementation.  8 October 2026.', M + 4, 250);
doc.text('This brief describes what the software actually does. It is not a legal opinion or a government certification.', M + 4, 258);

doc.addPage();
y = 20;

h1('1. What the 15 layers are');
para('PINIT DNA is a fingerprint pipeline. When someone protects a file, the system does not rely on the file name. It builds fifteen separate records about that file and stores them against one DNA record owned by that account. Layers 1 to 6 are the core match signals. Layers 7 to 10 record context, relationships, origin, and lineage. Layers 11 to 15 add authenticity, watermark readiness, custody, an ownership commitment, and a biometric bind.');
para('A later comparison uses these records to decide whether a new file is the same asset, a changed copy, or something else. No single layer is treated as proof by itself. A colour histogram, for example, is deliberately low weight because two unrelated pictures can look similar in coarse colour.');

h1('2. How a protected asset is generated');
bullet('The owner uploads the file while signed in. The API checks that the account still has vault storage for that size. There is no separate fixed file-size cap.');
bullet('The server reads the original bytes and runs a duplicate check against other accounts. The same account may protect the same file again. Another account may not register those same bytes as a new original.');
bullet('The file type is detected and routed to the matching engine. Images take the full visual path. Other media types use the layers that apply and skip the ones that do not.');
bullet('A DNA record is created for this owner. Layers 1 to 6 compute fingerprints. Where the layer is designed to, a carrier image is produced with tiny bit changes that a person should not see.');
bullet('Layers 7 to 10 store upload context, related records that share the same file hash, an origin descriptor, and a first lineage entry.');
bullet('Layers 11 to 15 then run: an authenticity check, a watermark-capability check, a custody entry, an ownership commitment, and a bind to the enrolled face template when one exists.');
bullet('Before the file is stored, an identity pass can embed ownership marks into the bytes that will be saved. Those marked bytes are what enter the vault, so a later protected download is compared against the same bytes.');
bullet('The bytes are encrypted in memory. Only the ciphertext is written to private storage. The fingerprint rows stay in PostgreSQL, scoped to the owner.');
para('The original upload is removed from the temporary disk after this. The vault copy is the encrypted object, not a public file URL.');

h1('3. Encryption');
para('Vault files use AES-256-GCM. That is authenticated encryption: it hides the bytes and it detects if the ciphertext is altered.');
labelValue('Algorithm', 'AES-256-GCM. 256-bit key, 96-bit random IV, 128-bit authentication tag.');
labelValue('Key', 'The master secret is not used as the file key. Each vault file gets its own key from HKDF-SHA256. The salt is the vault id. The info string is pinit-dna-vault-v1. The derived key is not stored. It is derived again when the file is opened.');
labelValue('On disk', 'The stored object is 12 bytes of IV, then 16 bytes of auth tag, then the ciphertext. The plaintext is not written.');
labelValue('Where', 'Ciphertext goes to the private Supabase bucket used for vault files. The database keeps the vault id, hashes, and layer rows. Storage paths are not returned as public links.');
para('Layer 14 uses a separate AES-256-GCM wrap, only for that layer’s random secret. Its IV is random per file. That wrap is not the vault encryption of the image itself.');
para('Government ID images, when submitted, use the same style of encrypted private storage. That path is separate from DNA generation and is not one of the fifteen layers.');

h1('4. Additional technology');
bullet('Node.js and TypeScript for the API. Sharp reads and transforms images (pixels, grayscale, resize) without sending the file to a third-party vision API for the core hashes.');
bullet('SHA-256 for file and pixel hashes, custody, and commitments. BLAKE3 is also computed on Layer 1 as an extra file hash.');
bullet('HMAC-SHA256 seals the Layer 1 to Layer 5 digests (the content seal) and the ownership watermark payload.');
bullet('PostgreSQL through Prisma stores the DNA record and one row per advanced layer. Queries for an owner’s assets stay scoped to that user.');
bullet('A Python service supplies the authenticity ensemble used by Layer 11 when it is available: CLIP zero-shot, an EfficientNet-style AI classifier, error-level analysis, frequency (FFT) analysis, a noise residual, and metadata signals. If that service is down, Layer 11 falls back to a local pixel check and protection still completes.');
bullet('ORB feature matching is used at upload time to catch near-duplicates after crop or recompression. It is not a sixteenth DNA layer. It sits beside Layer 2, which is not itself crop-tolerant.');
bullet('Spatial authentication can be enrolled on the same bytes that are about to be encrypted, so a later download is checked against the protected file rather than the raw upload.');
bullet('The robust invisible watermark used on protected downloads and share exports is applied at delivery time, not during the Layer 12 row. Layer 12 only records whether this image is large enough to carry that mark.');
bullet('Face sign-in uses a separate biometric pipeline (an enrolled face template). Layer 15 stores a hash of that template id. It does not put the face embedding inside the image.');

h1('5. The fifteen layers');

const layers = [
  {
    n: 'Layer 1 — Cryptographic',
    used: 'SHA-256 of the raw file, SHA-256 of the decoded RGB pixels, and a BLAKE3 hash of the file bytes.',
    for: 'Proves whether a file is the exact original. One changed byte changes the file hash. Stripping EXIF does not change the pixel hash. Any real pixel change does.',
    how: 'Used as the exact-match gate and as the content id that later layers refer to. It does not survive editing. That is the point: it is a seal, not a “looks similar” score.',
  },
  {
    n: 'Layer 2 — Structural',
    used: 'Grayscale, Sobel edges, an 8 by 8 grid, a 64-bit edge-density signature. Signature bits are written into the red-channel least significant bits on edge pixels.',
    for: 'Recognises the same picture after mild JPEG, brightness, or colour changes, because edges stay in the same places.',
    how: 'Verification reads those bits back and compares them with Hamming distance. Heavy cropping defeats it. Cropped copies are handled by the separate ORB check, not by stretching this layer.',
  },
  {
    n: 'Layer 3 — Perceptual',
    used: 'Four visual hashes: DCT pHash (32 by 32, then 8 by 8 coefficients), a fast average hash, a difference hash, and a longer 256-bit pHash.',
    for: 'Finds visually similar images after recompression, resize, small brightness changes, or PNG/JPEG conversion.',
    how: 'Two images are treated as similar when the 64-bit codes are within a small Hamming distance. Heavy filters or a redraw defeat it.',
  },
  {
    n: 'Layer 4 — Semantic colour',
    used: 'RGB histograms (full and 8-bin), HSV hue and saturation, the top colours, and a short colour fingerprint.',
    for: 'Describes the colour character of the picture: warm or cool, bright or dark.',
    how: 'It is a supporting score only. Tests showed unrelated images can still score high on coarse colour, so it is low weight and is never a standalone duplicate decision.',
  },
  {
    n: 'Layer 5 — Metadata provenance',
    used: 'A provenance manifest: tool, version, time, and a hash over the stable claims. In deterministic mode the hash is the claims digest only, so the same content produces the same digest.',
    for: 'Records where this fingerprint came from and ties it to the Layer 1 hash, without treating EXIF camera text as identity.',
    how: 'Compared as a metadata channel. It is not a substitute for the pixel hashes.',
  },
  {
    n: 'Layer 6 — Ownership watermark and content seal',
    used: 'A compact ownership signature (DNA or vault id, user, upload facts) is tiled across blue-channel least significant bits. An HMAC seals the Layer 1 to Layer 5 digests.',
    for: 'Lets a cropped copy still carry an ownership mark, and lets the system check that the core fingerprints were not swapped.',
    how: 'The tile is repeated so a partial crop can still recover it. The HMAC is the seal over the earlier layers, not a visible logo.',
  },
  {
    n: 'Layer 7 — Behavioral',
    used: 'A hash of the upload event: timing, user agent, session, timestamp. In deterministic mode it is instead a digest of the Layer 1 and Layer 3 ids.',
    for: 'Investigation context about how this registration happened. It is not used to recognise the picture.',
    how: 'The comparison engine skips it in every match mode. It is an audit record, not a similarity score.',
  },
  {
    n: 'Layer 8 — Relationship',
    used: 'Looks up other DNA records that already share this exact SHA-256, then hashes that relationship.',
    for: 'A snapshot of “which records already have this exact file,” taken at generation time.',
    how: 'Detection does not depend on it. The live duplicate check already compares the hash. This row is a reference, and the comparison engine skips it as a score.',
  },
  {
    n: 'Layer 9 — Origin',
    used: 'For images, a noise-residual descriptor from the pixels, folded into a bundle hash with upload context (address, agent, name, size, time) when that context exists. If the Python service is unavailable, the session hash is kept on its own.',
    for: 'A per-image noise-style descriptor that can be compared with another image’s residual.',
    how: 'This is not camera identification. Real camera PRNU would need many known photos from one device, and that enrollment does not exist here. It is not part of the Layer 1 to 6 match score.',
  },
  {
    n: 'Layer 10 — Evolution',
    used: 'A mutation log that starts with one ORIGIN entry, and a Merkle root over that log.',
    for: 'Reserved for tracking later versions of the same asset.',
    how: 'Nothing in the current product appends a second version to this log, so the record is the origin entry only. The comparison engine skips it. It is not a version history yet.',
  },
  {
    n: 'Layer 11 — Deepfake and authenticity',
    used: 'When the Python service is up: an ensemble (CLIP, EfficientNet-style classifier, error-level analysis, FFT, noise, metadata). Otherwise a local pixel and marker fallback. Video uses byte heuristics.',
    for: 'A risk score that the picture may be synthetic or tampered, stored on the DNA record. A score above 55 is flagged.',
    how: 'Failure of this layer does not block protection. A high score is a signal for review. It is not a statement that a laboratory certified the file as authentic or fake.',
  },
  {
    n: 'Layer 12 — Invisible watermark capability',
    used: 'Checks whether this image’s size can carry the robust watermark that protected downloads and share exports embed later.',
    for: 'Records readiness. It does not embed the delivery watermark during DNA generation, because the vault id used in that mark does not exist yet at this step.',
    how: 'Survival of that later watermark was measured on JPEG quality, brightness, grayscale, resize, and a screenshot-style transform. Crop is outside that test and is not claimed here.',
  },
  {
    n: 'Layer 13 — Chain of custody',
    used: 'One registration event: time, owner, file name, SHA-256 of the file, and a second SHA-256 over that event. The first write is kept. A repeat job does not replace the original timestamp.',
    for: 'An evidence row for this registration, marked in the product as DMCA-ready.',
    how: 'This is a software record. The brief does not claim that a court has admitted it, or that a DMCA notice has been filed. Those are later actions a person can take using the record.',
  },
  {
    n: 'Layer 14 — Ownership commitment',
    used: 'A random 32-byte secret. The commitment is SHA-256 of secret, file hash, and owner. A public hash is SHA-256 of owner and DNA id. The secret is stored only as AES-256-GCM ciphertext with a fresh IV. The first commitment is kept.',
    for: 'A hash commitment the owner could later open to show they knew the secret for this file hash.',
    how: 'This is a hash commitment, not a zk-SNARK and not a blockchain proof. The current product writes the row. A verifier that opens proofData is not wired into the user flow yet.',
  },
  {
    n: 'Layer 15 — Biometric bind',
    used: 'If the account has an enrolled face template, the layer stores SHA-256 of that template hash, the method hmac-sha256, and the user id. If there is no enrolled face, it stores NOT_REGISTERED.',
    for: 'Ties this DNA record to the person who enrolled the face on the account, without copying the face embedding into the file.',
    how: 'It does not by itself mean the face was matched to this upload. Face match and liveness are separate checks in sign-in and identity verification.',
  },
];

for (const layer of layers) {
  need(28);
  setFill(WASH);
  doc.roundedRect(M, y - 4, CONTENT_W, 8, 1, 1, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setText(NAVY);
  doc.text(layer.n, M + 2, y + 1.2);
  y += 8;
  labelValue('How', layer.used);
  labelValue('For', layer.for);
  labelValue('In use', layer.how);
  y += 2;
}

h1('6. How the layers secure a file together');
para('Exact identity is Layer 1. If the bytes match, the file is the same object. If they do not, Layers 2, 3, and 6 still have a chance to recognise a recompressed or lightly edited copy, and ORB covers crops that Layer 2 misses. Layer 4 only supports that decision. Layers 7, 8, and 10 are records, not match scores. Layer 9 adds an optional noise descriptor. Layer 11 adds an authenticity risk. Layer 12 records that a delivery watermark can be applied. Layer 13 freezes the registration facts. Layer 14 freezes an ownership commitment. Layer 15 links the record to an enrolled face template when one exists.');
para('The file itself is not left as plaintext. After the fingerprints and any in-file marks are prepared, AES-256-GCM ciphertext is what the vault stores. Opening it requires the master secret and the vault id. Changing the ciphertext fails the authentication tag.');
para('What this does not do: it does not call a government registry, it does not by itself send a DMCA notice, and it does not treat one weak layer as “verified.” A protected asset is secured by the combination of fingerprints, in-file marks where those layers apply, an owner-scoped database record, and encrypted vault storage.');

h1('7. Short map');
const rows = [
  ['1 Cryptographic', 'Exact file and pixel seal', 'SHA-256, BLAKE3'],
  ['2 Structural', 'Edge signature in the image', 'Sobel, LSB'],
  ['3 Perceptual', 'Looks-the-same hash', 'DCT pHash, aHash, dHash'],
  ['4 Semantic', 'Colour description, low weight', 'RGB and HSV histograms'],
  ['5 Metadata', 'Provenance digest', 'SHA-256 claims digest'],
  ['6 Signature', 'Ownership tile and content seal', 'LSB, HMAC-SHA256'],
  ['7 Behavioral', 'Upload-event audit', 'SHA-256 bundle'],
  ['8 Relationship', 'Same-hash record snapshot', 'SHA-256 graph hash'],
  ['9 Origin', 'Noise residual, not camera ID', 'Python residual, SHA-256'],
  ['10 Evolution', 'Origin lineage entry only', 'Merkle root over one leaf'],
  ['11 Deepfake', 'Authenticity risk score', 'CLIP, EfficientNet, ELA, FFT'],
  ['12 Watermark', 'Can a delivery mark fit', 'Robust watermark check'],
  ['13 Custody', 'Registration evidence row', 'SHA-256, first write wins'],
  ['14 Commitment', 'Hash commitment of a secret', 'SHA-256, AES-256-GCM'],
  ['15 Biometric', 'Hash of enrolled face template', 'SHA-256, or not registered'],
];

doc.setFont('helvetica', 'bold');
doc.setFontSize(8);
setText(MUTED);
need(8);
doc.text('LAYER', M, y);
doc.text('ROLE', M + 42, y);
doc.text('TECHNOLOGY', M + 112, y);
y += 3;
setDraw(LINE);
doc.line(M, y, W - M, y);
y += 4;

for (const [a, b, c] of rows) {
  need(6);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  setText(NAVY);
  doc.text(a, M, y);
  doc.setFont('helvetica', 'normal');
  setText(SLATE);
  doc.text(b, M + 42, y);
  doc.text(c, M + 112, y);
  y += 5.2;
}

y += 6;
para('Source: the layer services, the vault encryption service, and the DNA generation path in the PINIT-DNA repository. Names match the layer registry: Cryptographic, Structural, Perceptual, Semantic, Metadata, Signature, Behavioral, Relationship, Origin, Evolution, Deepfake Detection, Invisible Watermark, Chain of Custody, ZK Ownership Proof, Biometric Bind. The “ZK” name in the registry is the hash-commitment scheme described in Layer 14, not a zero-knowledge circuit.');

footer();
writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log(out);
