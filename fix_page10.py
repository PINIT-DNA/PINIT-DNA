import io
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import letter
from reportlab.lib import colors
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle

PDF_PATH = r"C:\Users\AshwithaReddy\OneDrive\文档\PinIT_DNA_Report.pdf"

# Build replacement page 10
buf = io.BytesIO()
doc = SimpleDocTemplate(buf, pagesize=letter,
    leftMargin=1*inch, rightMargin=1*inch,
    topMargin=1*inch, bottomMargin=1*inch)

styles = getSampleStyleSheet()
h2   = ParagraphStyle('h2',  parent=styles['Heading2'], fontSize=11, spaceAfter=6, fontName='Helvetica-Bold')
body = ParagraphStyle('body',parent=styles['Normal'],   fontSize=10, leading=14, spaceAfter=6)
sm   = ParagraphStyle('sm',  parent=styles['Normal'],   fontSize=9,  leading=13)
smb  = ParagraphStyle('smb', parent=styles['Normal'],   fontSize=9,  leading=13, fontName='Helvetica-Bold')
foot = ParagraphStyle('foot',parent=styles['Normal'],   fontSize=9,  leading=12, alignment=1)  # center

BORDER    = colors.HexColor('#999999')
HEADER_BG = colors.HexColor('#D9D9D9')

def make_table(headers, rows, col_widths):
    data = [headers] + rows
    t = Table(data, colWidths=col_widths)
    t.setStyle(TableStyle([
        ('BACKGROUND',    (0,0), (-1,0), HEADER_BG),
        ('FONTNAME',      (0,0), (-1,0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0,0), (-1,-1), 9),
        ('GRID',          (0,0), (-1,-1), 0.5, BORDER),
        ('VALIGN',        (0,0), (-1,-1), 'TOP'),
        ('ROWBACKGROUNDS',(0,1), (-1,-1), [colors.white, colors.HexColor('#F7F7F7')]),
        ('LEFTPADDING',   (0,0), (-1,-1), 6),
        ('RIGHTPADDING',  (0,0), (-1,-1), 6),
        ('TOPPADDING',    (0,0), (-1,-1), 5),
        ('BOTTOMPADDING', (0,0), (-1,-1), 5),
    ]))
    return t

story = []

story.append(Paragraph("7.  Current Progress and Next Steps", h2))
story.append(Spacer(1, 4))
story.append(Paragraph(
    "Overall Progress: 35 of 44 features completed and live in production (80%).", body))
story.append(Spacer(1, 6))

story.append(Paragraph("Completed Work", ParagraphStyle('cw', parent=body, fontName='Helvetica-Bold')))
story.append(Paragraph(
    "All 35 core modules are live in production: DNA fingerprinting engine, AES-256-GCM encrypted "
    "vault, smart share links with full access control, privacy masking, real-time session monitoring, "
    "forensic audit trail with AI risk scoring, tamper-proof certificates, forward detection engine, "
    "recipient trust system, IP intelligence, device fingerprinting, and the forensic investigation dashboard.",
    body))
story.append(Spacer(1, 8))

story.append(Paragraph("Pending Features", ParagraphStyle('pf', parent=body, fontName='Helvetica-Bold')))
story.append(Spacer(1, 4))

headers = [Paragraph(x, smb) for x in ['Feature', 'Description', 'Expected Timeline']]
rows = [
    # 4 new DNA fingerprint layers
    [Paragraph('Neural Hash Layer', sm),
     Paragraph('Deep-learning CNN perceptual fingerprint; resistant to compression and format conversion', sm),
     Paragraph('Phase 3 (2029-2031)', sm)],
    [Paragraph('Blockchain Anchoring Layer', sm),
     Paragraph('On-chain SHA-256 proof-of-existence; immutable public timestamp via Ethereum / Polygon', sm),
     Paragraph('Phase 2 (2027-2028)', sm)],
    [Paragraph('Quantum-Resistant Signature', sm),
     Paragraph('Post-quantum cryptography layer using NIST PQC standard (CRYSTALS-Dilithium)', sm),
     Paragraph('Phase 2 (2027-2028)', sm)],
    [Paragraph('Cross-Modal AI Embedding', sm),
     Paragraph('Multi-modal AI fingerprint across text, image and audio using vector embeddings', sm),
     Paragraph('Phase 3 (2029-2031)', sm)],
    # original 5
    [Paragraph('Watermark Extraction Scanner', sm),
     Paragraph('Scan a leaked file to extract and attribute recipient watermark code', sm),
     Paragraph('1 week', sm)],
    [Paragraph('Email Notifications', sm),
     Paragraph('SMTP integration for high-risk access alerts', sm),
     Paragraph('3-5 days', sm)],
    [Paragraph('Role-Based Access Control', sm),
     Paragraph('Admin / Analyst / Auditor permission matrix', sm),
     Paragraph('1 week', sm)],
    [Paragraph('Bulk Upload & Batch DNA', sm),
     Paragraph('Upload multiple files at once; process all in a single operation', sm),
     Paragraph('3-5 days', sm)],
    [Paragraph('API Documentation', sm),
     Paragraph('Full REST API reference with examples', sm),
     Paragraph('2-3 days', sm)],
]
story.append(make_table(headers, rows, [2.0*inch, 3.5*inch, 1.2*inch]))
story.append(Spacer(1, 10))
story.append(Paragraph(
    "Estimated completion of near-term features (Watermark Scanner, Email Notifications, RBAC, "
    "Bulk Upload, API Documentation): 2 to 3 weeks from the date of this report. "
    "The 4 pending DNA fingerprint layers follow the 10-year technology roadmap detailed in the addendum.",
    body))

# Page number footer
story.append(Spacer(1, 20))
story.append(Paragraph("Page 10 of 12", foot))

doc.build(story)
buf.seek(0)

# Replace page 10 (index 9) in the PDF
reader = PdfReader(PDF_PATH)
writer = PdfWriter()

new_page_reader = PdfReader(buf)
new_page = new_page_reader.pages[0]

for i, page in enumerate(reader.pages):
    if i == 9:  # page 10 (0-indexed)
        writer.add_page(new_page)
    else:
        writer.add_page(page)

with open(PDF_PATH, 'wb') as f:
    writer.write(f)

import sys
sys.stdout.write("Done. Page 10 updated with 9 pending features (4 DNA layers + 5 original).\n")
