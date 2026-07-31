/**
 * Convert docs/DAIP-IICLME-HLD-v2.0.md to .docx (no pandoc required)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = await import('docx');

  const mdPath = path.join(__dirname, 'DAIP-IICLME-HLD-v2.0.md');
  const outPath = path.join(__dirname, 'DAIP-IICLME-HLD-v2.0.docx');
  const lines = fs.readFileSync(mdPath, 'utf8').split(/\r?\n/);

  const children = [];

  const pushParagraph = (text, opts = {}) => {
    const t = text.trim();
    if (!t) return;
    children.push(
      new Paragraph({
        alignment: opts.center ? AlignmentType.CENTER : undefined,
        heading: opts.heading,
        spacing: { after: 120 },
        children: [new TextRun({ text: t, bold: opts.bold, italics: opts.italics, size: opts.size ?? 22 })],
      }),
    );
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) {
      children.push(new Paragraph({ spacing: { after: 80 }, children: [] }));
      continue;
    }
    if (line.startsWith('# ')) {
      pushParagraph(line.slice(2), { heading: HeadingLevel.TITLE, bold: true, size: 32 });
    } else if (line.startsWith('## ')) {
      pushParagraph(line.slice(3), { heading: HeadingLevel.HEADING_1, bold: true, size: 28 });
    } else if (line.startsWith('### ')) {
      pushParagraph(line.slice(4), { heading: HeadingLevel.HEADING_2, bold: true, size: 24 });
    } else if (line.startsWith('---')) {
      continue;
    } else if (line.startsWith('|')) {
      // table row — render as monospace-style paragraph
      pushParagraph(line.replace(/\|/g, '  ').trim(), { size: 20 });
    } else if (line.startsWith('**') && line.endsWith('**')) {
      pushParagraph(line.replace(/\*\*/g, ''), { bold: true });
    } else {
      const cleaned = line.replace(/\*\*(.*?)\*\*/g, '$1').replace(/`/g, '');
      pushParagraph(cleaned);
    }
  }

  const doc = new Document({
    creator: 'PINIT-DNA',
    title: 'PINIT DAIP - IICLME HLD v2.0',
    description: 'Digital Asset Intelligence Platform - Architecture Proposal',
    sections: [{ properties: {}, children }],
  });

  const buffer = await Packer.toBuffer(doc);
  fs.writeFileSync(outPath, buffer);
  console.log('Created:', outPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
