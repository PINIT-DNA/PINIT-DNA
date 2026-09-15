"""
Build the PinitHub company profile.

    python build.py

Three files, with distinct jobs:

  profile.src.html                   the source you edit. Points at screens/*.png
                                     with ordinary relative paths, so a screenshot
                                     is replaced by dropping a new file over the
                                     old one — no markup to touch.

  PINITHUB-Company-Profile-2026.html built. Every image folded in, so it renders
                                     anywhere it is opened or sent. Open this one.

  PINITHUB-Company-Profile-2026.pdf  built. The thing you hand to a client.

Relative paths only resolve in some of the places this document ends up — a
preview pane or an email client will show a broken icon where the source looks
fine locally. So the source keeps the paths and the build resolves them, rather
than making a person choose between an editable file and one that works.
"""
import io, os, re, base64, subprocess, sys
from pathlib import Path
from PIL import Image

HERE = Path(__file__).resolve().parent
SRC = HERE / 'profile.src.html'
OUT_HTML = HERE / 'PINITHUB-Company-Profile-2026.html'
OUT_PDF = HERE / 'PINITHUB-Company-Profile-2026.pdf'

CHROME = next((c for c in (
    Path(r'C:\Program Files\Google\Chrome\Application\chrome.exe'),
    Path(r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'),
    Path(r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'),
) if c.exists()), None)
if CHROME is None:
    sys.exit('No Chrome or Edge found to render the PDF.')

html = SRC.read_text(encoding='utf-8')

missing = []
for ref in sorted(set(re.findall(r'src="(screens/[^"]+)"', html))):
    path = HERE / ref
    if not path.exists():
        missing.append(ref)
        continue

    im = Image.open(path)
    buf = io.BytesIO()
    if im.mode in ('RGBA', 'LA', 'P'):
        # transparency to preserve — the logo and anything cut out
        im.save(buf, 'PNG', optimize=True)
        mime = 'png'
    else:
        # a lossless UI capture is several times larger than it needs to be
        im.convert('RGB').save(buf, 'JPEG', quality=90, optimize=True, progressive=True)
        mime = 'jpeg'

    data = buf.getvalue()
    print('  %-32s %5d KB -> %4d KB' % (ref, path.stat().st_size // 1024, len(data) // 1024))
    html = html.replace('src="%s"' % ref,
                        'src="data:image/%s;base64,%s"' % (mime, base64.b64encode(data).decode()))

if missing:
    print('\n  MISSING — these will print blank:')
    for m in missing:
        print('    ' + m)

OUT_HTML.write_text(html, encoding='utf-8')

try:
    r = subprocess.run(
        [str(CHROME), '--headless=new', '--disable-gpu', '--no-sandbox',
         '--no-pdf-header-footer', '--virtual-time-budget=25000',
         '--print-to-pdf=' + str(OUT_PDF), OUT_HTML.as_uri()],
        capture_output=True, text=True, timeout=300)
except subprocess.TimeoutExpired:
    sys.exit('Chrome timed out rendering the PDF.')

if 'written to file' not in (r.stdout + r.stderr):
    tail = (r.stderr or r.stdout).strip().splitlines()[-3:]
    sys.exit('PDF was not written — close it if it is open in a viewer.\n' + '\n'.join(tail))

print('\n  %-36s %5d KB' % (OUT_HTML.name, OUT_HTML.stat().st_size // 1024))
print('  %-36s %5d KB' % (OUT_PDF.name, OUT_PDF.stat().st_size // 1024))
