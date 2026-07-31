/**
 * Dev-only startup banner — printed on every `npm run dev` boot.
 * Shows Node (4000) + Python AI (8001) stack and refreshes when AI is ready.
 */

export type AiBannerStatus =
  | 'starting'
  | 'ready'
  | 'already-running'
  | 'unavailable'
  | 'external';

const AI_FEATURES = [
  'OCR',
  'CLIP / Embeddings',
  'AI Detection',
  'Image Analysis',
  'Document Analysis',
  'Future Crawler AI',
] as const;

const BOX_INNER = 57; // chars between │ borders

function row(text: string): string {
  const clipped = text.length > BOX_INNER ? text.slice(0, BOX_INNER - 1) + '…' : text;
  return `  │  ${clipped.padEnd(BOX_INNER)}│`;
}

function aiStatusLabel(status: AiBannerStatus): string {
  switch (status) {
    case 'starting':         return 'starting…';
    case 'ready':            return 'READY';
    case 'already-running':  return 'READY (already running)';
    case 'unavailable':      return 'unavailable — run: npm run dev:ai:setup';
    case 'external':         return 'external service';
  }
}

export function printDevStackBanner(opts: {
  nodePort: number;
  aiPort: number;
  aiStatus: AiBannerStatus;
  aiUrl?: string;
}): void {
  if (process.env['NODE_ENV'] === 'production') return;

  const { nodePort, aiPort, aiStatus, aiUrl } = opts;
  const nodeUrl = `http://localhost:${nodePort}`;
  const aiLocalUrl = `http://localhost:${aiPort}`;
  const aiDisplayUrl = aiUrl && aiStatus === 'external' ? aiUrl : aiLocalUrl;
  const allReady = aiStatus === 'ready' || aiStatus === 'already-running' || aiStatus === 'external';
  const readyLine = allReady ? '▼  ALL SERVICES READY' : '▼  Python AI starting…';

  const lines = [
    '',
    '  ┌───────────────────────────────────────────────────────────┐',
    row('PINIT-DNA — Dev Stack (Terminal 1: npm run dev)'),
    '  ├───────────────────────────────────────────────────────────┤',
    row('npm run dev'),
    row('       │'),
    row('       ▼'),
    row(`Node.js Backend  →  Port ${nodePort}   ${nodeUrl}`),
    row('       │'),
    row('       ├── Auto-starts Python AI'),
    row('       │'),
    row('       ▼'),
    row(`Python AI        →  Port ${aiPort}   ${aiDisplayUrl}`),
    row(`                   [${aiStatusLabel(aiStatus)}]`),
    row('       │'),
    ...AI_FEATURES.map((f) => row(`       ├── ${f}`)),
    row('       │'),
    row(readyLine),
    '  ├───────────────────────────────────────────────────────────┤',
    row('Frontend (Terminal 2):  cd client && npm run dev  → 3000'),
    '  └───────────────────────────────────────────────────────────┘',
    '',
  ];

  console.log(lines.join('\n'));
}
