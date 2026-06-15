import io
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

PDF_PATH = r"C:\Users\AshwithaReddy\OneDrive\文档\PinIT_DNA_Report.pdf"

buf = io.BytesIO()
doc = SimpleDocTemplate(buf, pagesize=letter,
    leftMargin=1*inch, rightMargin=1*inch,
    topMargin=1*inch, bottomMargin=1*inch)

styles = getSampleStyleSheet()
h1  = ParagraphStyle('h1',  parent=styles['Heading1'],  fontSize=13, spaceAfter=6)
h2  = ParagraphStyle('h2',  parent=styles['Heading2'],  fontSize=11, spaceAfter=4)
body= ParagraphStyle('body',parent=styles['Normal'],    fontSize=10, leading=14, spaceAfter=4)
sm  = ParagraphStyle('sm',  parent=styles['Normal'],    fontSize=9,  leading=13)
smb = ParagraphStyle('smb', parent=styles['Normal'],    fontSize=9,  leading=13, fontName='Helvetica-Bold')

BORDER    = colors.HexColor('#999999')
HEADER_BG = colors.HexColor('#D9D9D9')
WHITE     = colors.white
ALTROW    = colors.HexColor('#F7F7F7')

def make_table(headers, rows, col_widths):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND',   (0,0), (-1,0), HEADER_BG),
        ('FONTNAME',     (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',     (0,0), (-1,-1), 9),
        ('GRID',         (0,0), (-1,-1), 0.5, BORDER),
        ('VALIGN',       (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS',(0,1),(-1,-1), [WHITE, ALTROW]),
        ('LEFTPADDING',  (0,0), (-1,-1), 6),
        ('RIGHTPADDING', (0,0), (-1,-1), 6),
        ('TOPPADDING',   (0,0), (-1,-1), 5),
        ('BOTTOMPADDING',(0,0), (-1,-1), 5),
    ]))
    return t

story = []

# Title
story.append(Paragraph("PinIT DNA — Report Addendum", h1))
story.append(Paragraph(
    "This addendum extends the main report with four additional pending DNA fingerprint layers "
    "and the 10-year technology roadmap.", body))
story.append(Spacer(1, 12))

# Section A — 4 Pending DNA Layers
story.append(Paragraph("A.  Universal DNA Engine — 4 Pending Layers", h2))
story.append(Paragraph(
    "The Universal DNA Engine currently implements 6 fingerprint layers. "
    "Four additional layers are planned, bringing the total to 10 fingerprint layers per file.", body))
story.append(Spacer(1, 6))

dna_headers = [Paragraph(x, smb) for x in ['#', 'Layer Name', 'Description', 'Status']]
dna_rows = [
    [Paragraph('7',  sm), Paragraph('Neural Hash Layer', sm),
     Paragraph('Deep-learning CNN perceptual fingerprint; resistant to compression and format conversion', sm),
     Paragraph('Pending', sm)],
    [Paragraph('8',  sm), Paragraph('Blockchain Anchoring', sm),
     Paragraph('On-chain SHA-256 proof-of-existence; immutable public timestamp via Ethereum / Polygon', sm),
     Paragraph('Pending', sm)],
    [Paragraph('9',  sm), Paragraph('Quantum-Resistant Signature', sm),
     Paragraph('Post-quantum cryptography layer using NIST PQC standard (CRYSTALS-Dilithium)', sm),
     Paragraph('Pending', sm)],
    [Paragraph('10', sm), Paragraph('Cross-Modal AI Embedding', sm),
     Paragraph('Multi-modal AI fingerprint across text, image and audio content using vector embeddings', sm),
     Paragraph('Pending', sm)],
]
story.append(make_table(dna_headers, dna_rows, [0.3*inch, 1.5*inch, 3.5*inch, 1.0*inch]))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Once all 10 layers are complete, every file will carry a 10-dimensional fingerprint covering "
    "cryptographic, structural, perceptual, semantic, metadata, steganographic, neural, blockchain, "
    "quantum-resistant, and cross-modal dimensions.", body))

story.append(Spacer(1, 18))

# Section B — 10-Year Roadmap
story.append(Paragraph("B.  10-Year Technology Roadmap (2026 - 2036)", h2))
story.append(Paragraph(
    "PinIT DNA is designed as a long-term platform. The roadmap below outlines the strategic "
    "development plan over the next 10 years across four phases.", body))
story.append(Spacer(1, 6))

road_headers = [Paragraph(x, smb) for x in ['Phase', 'Period', 'Milestone', 'Key Deliverables']]
road_rows = [
    [Paragraph('Phase 1', sm), Paragraph('2026', sm),
     Paragraph('Foundation Complete', sm),
     Paragraph('All 44 features live; 10-layer DNA engine; RBAC; Bulk Upload; Email Alerts; API Docs', sm)],
    [Paragraph('Phase 2', sm), Paragraph('2027-2028', sm),
     Paragraph('Enterprise Scale', sm),
     Paragraph('Blockchain anchoring; quantum-resistant signatures; SOC 2 compliance; SLA uptime; multi-region deployment', sm)],
    [Paragraph('Phase 3', sm), Paragraph('2029-2031', sm),
     Paragraph('AI Intelligence Platform', sm),
     Paragraph('Neural hash layer; cross-modal AI embeddings; automated threat intelligence; predictive leak detection; legal-grade evidence export', sm)],
    [Paragraph('Phase 4', sm), Paragraph('2032-2036', sm),
     Paragraph('Global Provenance Network', sm),
     Paragraph('Decentralised provenance registry; cross-organisation trust federation; real-time global monitoring; zero-knowledge proof verification; 10-year immutable audit archive', sm)],
]
story.append(make_table(road_headers, road_rows, [0.7*inch, 1.0*inch, 1.6*inch, 3.0*inch]))
story.append(Spacer(1, 8))
story.append(Paragraph(
    "The platform is architected for 10+ years of continuous operation. All cryptographic primitives "
    "(AES-256-GCM, SHA-256, HMAC-SHA256) are selected for long-term security. "
    "Each DNA record, certificate, and forensic audit log is stored with a permanent, verifiable "
    "timestamp that constitutes admissible proof of original ownership for the full 10-year retention period.", body))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "Updated Feature Count: With 4 pending DNA layers added, the total planned feature set expands "
    "from 40 to 44 features. Current completion: 35 of 44 features live in production (80%).", body))

doc.build(story)
buf.seek(0)

# Merge with original PDF
reader  = PdfReader(PDF_PATH)
writer  = PdfWriter()
for page in reader.pages:
    writer.add_page(page)

addendum_reader = PdfReader(buf)
for page in addendum_reader.pages:
    writer.add_page(page)

with open(PDF_PATH, 'wb') as f:
    writer.write(f)

print(f"Saved: {len(reader.pages)} original + {len(addendum_reader.pages)} addendum pages -> {PDF_PATH}")
