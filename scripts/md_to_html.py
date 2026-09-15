"""Convert Database_Structure markdown to standalone HTML with Mermaid diagrams."""

import html

import re

from pathlib import Path





def strip_md_inline(text: str) -> str:

    def repl_bold(m):

        return f"<strong>{html.escape(m.group(1))}</strong>"



    def repl_code(m):

        return f"<code>{html.escape(m.group(1))}</code>"



    text = re.sub(r"\*\*(.+?)\*\*", repl_bold, text)

    text = re.sub(r"`(.+?)`", repl_code, text)

    return text





def parse_table_rows(lines: list[str]) -> list[list[str]]:

    rows = []

    for line in lines:

        if not line.strip().startswith("|"):

            break

        cells = [c.strip() for c in line.strip().strip("|").split("|")]

        if all(re.match(r"^[-:\s]+$", c) for c in cells):

            continue

        rows.append(cells)

    return rows





def table_html(rows: list[list[str]]) -> str:

    if not rows:

        return ""

    out = ['<table>']

    out.append("<thead><tr>")

    for cell in rows[0]:

        out.append(f"<th>{strip_md_inline(cell)}</th>")

    out.append("</tr></thead>")

    out.append("<tbody>")

    for row in rows[1:]:

        out.append("<tr>")

        for cell in row:

            out.append(f"<td>{strip_md_inline(cell)}</td>")

        out.append("</tr>")

    out.append("</tbody></table>")

    return "\n".join(out)





def md_to_html_body(md_text: str) -> str:

    lines = md_text.splitlines()

    parts: list[str] = []

    i = 0

    in_code = False

    code_lang = ""

    code_lines: list[str] = []



    while i < len(lines):

        line = lines[i]



        if line.strip().startswith("```"):

            if not in_code:

                in_code = True

                code_lang = line.strip().removeprefix("```").strip()

                code_lines = []

            else:

                in_code = False

                content = "\n".join(code_lines)

                if code_lang == "mermaid":

                    parts.append(

                        '<div class="diagram-box">\n'

                        f'<div class="mermaid">\n{content}\n</div>\n'

                        "</div>"

                    )

                else:

                    parts.append(f"<pre><code>{html.escape(content)}</code></pre>")

                code_lines = []

            i += 1

            continue



        if in_code:

            code_lines.append(line)

            i += 1

            continue



        if line.strip() == "---":

            parts.append("<hr />")

            i += 1

            continue



        if line.startswith("# "):

            parts.append(f'<h1 id="{slug(line[2:])}">{strip_md_inline(line[2:])}</h1>')

            i += 1

            continue

        if line.startswith("## "):

            parts.append(f'<h2 id="{slug(line[3:])}">{strip_md_inline(line[3:])}</h2>')

            i += 1

            continue

        if line.startswith("### "):

            parts.append(f'<h3 id="{slug(line[4:])}">{strip_md_inline(line[4:])}</h3>')

            i += 1

            continue

        if line.startswith("#### "):

            parts.append(f'<h4 id="{slug(line[5:])}">{strip_md_inline(line[5:])}</h4>')

            i += 1

            continue



        if line.strip().startswith("|"):

            table_lines = []

            while i < len(lines) and lines[i].strip().startswith("|"):

                table_lines.append(lines[i])

                i += 1

            parts.append(table_html(parse_table_rows(table_lines)))

            continue



        if line.strip().startswith("*") and line.strip().endswith("*") and not line.strip().startswith("**"):

            parts.append(f"<p><em>{strip_md_inline(line.strip().strip('*'))}</em></p>")

            i += 1

            continue



        if line.strip():

            parts.append(f"<p>{strip_md_inline(line)}</p>")

        i += 1



    return "\n".join(parts)





def slug(text: str) -> str:

    s = re.sub(r"[^\w\s-]", "", text.lower())

    return re.sub(r"[\s_]+", "-", s).strip("-")[:60]





HTML_TEMPLATE = """<!DOCTYPE html>

<html lang="en">

<head>

  <meta charset="UTF-8" />

  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <title>Database Structure — Pinit Hub, Exchange &amp; Landing</title>

  <style>

    :root {

      --bg: #0b1220;

      --surface: #111827;

      --border: #1f2937;

      --text: #e5e7eb;

      --muted: #9ca3af;

      --accent: #3b82f6;

      --accent2: #22d3ee;

      --warn-bg: #1e3a5f;

      --warn-border: #3b82f6;

    }

    * { box-sizing: border-box; }

    body {

      margin: 0;

      font-family: "Segoe UI", system-ui, -apple-system, sans-serif;

      background: var(--bg);

      color: var(--text);

      line-height: 1.65;

    }

    .wrap {

      max-width: 1200px;

      margin: 0 auto;

      padding: 2rem 1.5rem 4rem;

    }

    .open-hint {

      background: var(--warn-bg);

      border: 1px solid var(--warn-border);

      border-radius: 8px;

      padding: .75rem 1rem;

      margin-bottom: 1.25rem;

      font-size: .9rem;

      color: #bfdbfe;

    }

    nav.toc {

      background: var(--surface);

      border: 1px solid var(--border);

      border-radius: 10px;

      padding: 1rem 1.25rem;

      margin-bottom: 2rem;

    }

    nav.toc strong { display: block; margin-bottom: .5rem; color: #fff; }

    nav.toc a {

      color: var(--accent2);

      text-decoration: none;

      margin-right: 1rem;

      font-size: .9rem;

    }

    nav.toc a:hover { text-decoration: underline; }

    header.doc-header {

      text-align: center;

      padding: 2rem 1rem;

      margin-bottom: 2rem;

      border: 1px solid var(--border);

      border-radius: 12px;

      background: linear-gradient(135deg, #111827 0%, #0f172a 100%);

    }

    header.doc-header h1 { margin: 0 0 .5rem; font-size: 1.85rem; color: #fff; }

    header.doc-header p { margin: .25rem 0; color: var(--muted); font-size: .95rem; }

    h1, h2, h3, h4 { color: #f9fafb; scroll-margin-top: 1rem; }

    h2 {

      margin-top: 2.5rem;

      padding-bottom: .4rem;

      border-bottom: 2px solid var(--accent);

      font-size: 1.45rem;

    }

    h3 { margin-top: 1.75rem; color: var(--accent2); font-size: 1.15rem; }

    h4 { margin-top: 1.25rem; font-size: 1rem; color: #cbd5e1; }

    p { margin: .75rem 0; }

    hr { border: none; border-top: 1px solid var(--border); margin: 2rem 0; }

    code {

      background: #1e293b;

      padding: .12rem .35rem;

      border-radius: 4px;

      font-size: .9em;

      color: #93c5fd;

    }

    pre {

      background: #0f172a;

      border: 1px solid var(--border);

      border-radius: 8px;

      padding: 1rem;

      overflow-x: auto;

      font-size: .85rem;

    }

    .diagram-box {

      background: #0f172a;

      border: 1px solid var(--border);

      border-radius: 10px;

      padding: 1.25rem;

      margin: 1.25rem 0 1.75rem;

      overflow-x: auto;

      min-height: 80px;

    }

    .diagram-box .mermaid {

      display: flex;

      justify-content: center;

    }

    .diagram-box svg {

      max-width: 100%;

      height: auto;

    }

    .diagram-box[data-error="1"] {

      border-color: #ef4444;

    }

    .diagram-box[data-error="1"]::before {

      content: "Diagram failed to render — open in Chrome/Edge browser";

      display: block;

      color: #fca5a5;

      font-size: .85rem;

      margin-bottom: .5rem;

    }

    table {

      width: 100%;

      border-collapse: collapse;

      margin: 1rem 0 1.5rem;

      font-size: .92rem;

      background: var(--surface);

      border: 1px solid var(--border);

      border-radius: 8px;

      overflow: hidden;

      display: block;

      overflow-x: auto;

    }

    thead, tbody { display: table; width: 100%; table-layout: auto; }

    th, td {

      border: 1px solid var(--border);

      padding: .55rem .75rem;

      text-align: left;

      vertical-align: top;

    }

    th { background: #1e293b; color: #f3f4f6; font-weight: 600; white-space: nowrap; }

    tr:nth-child(even) td { background: rgba(255,255,255,.02); }

    strong { color: #fff; }

    em { color: var(--muted); }

    footer {

      margin-top: 3rem;

      padding-top: 1rem;

      border-top: 1px solid var(--border);

      color: var(--muted);

      font-size: .85rem;

      text-align: center;

    }

    @media print {

      body { background: #fff; color: #111; }

      h1,h2,h3,h4,strong { color: #111; }

      table, th, td, pre, .diagram-box { border-color: #ccc; }

      th { background: #eee; }

      .open-hint, nav.toc { display: none; }

    }

  </style>

</head>

<body>

  <div class="wrap">

    <div class="open-hint">

      <strong>Interactive diagrams:</strong> Open this file in <strong>Chrome</strong> or <strong>Edge</strong>

      (double-click the .html file). Cursor/VS Code preview does not run Mermaid JavaScript.

    </div>

    <header class="doc-header">

      <h1>Database Structure — Pinit Hub, Exchange &amp; Landing</h1>

      <p>Full platform schema: Hub (public) · Exchange (exchange) · Landing (landing) · Supabase Storage</p>

      <p>Source: prisma/schema.prisma · exchange.postgres.sql · pinithub-landing/prisma/schema.prisma</p>

      <p>Last updated: August 2026</p>

    </header>

    <nav class="toc">

      <strong>Diagram sections</strong>

      <a href="#0-master-platform-map-hub-exchange-landing">0 · Master map</a>

      <a href="#1-platform-topology-one-supabase-postgres-project">1 · Topology</a>

      <a href="#2-pinit-hub-public-schema-77-models">2 · Hub ER</a>

      <a href="#3-pinit-exchange-exchange-schema-20-tables">3 · Exchange ER</a>

      <a href="#4-pinit-landing-landing-schema-cms">4 · Landing ER</a>

      <a href="#5-cross-system-logical-links-hub-exchange">5 · Hub↔Exchange links</a>

    </nav>

    <main>

{body}

    </main>

    <footer>Database Structure of Pinit Hub (full platform) — PINIT-DNA</footer>

  </div>

  <script src="vendor/mermaid.min.js"></script>

  <script>

    (function () {

      if (typeof mermaid === "undefined") {

        document.querySelectorAll(".diagram-box").forEach(function (el) {

          el.setAttribute("data-error", "1");

        });

        return;

      }

      mermaid.initialize({

        startOnLoad: false,

        theme: "dark",

        securityLevel: "loose",

        flowchart: { htmlLabels: true, curve: "basis", useMaxWidth: true },

        er: { useMaxWidth: true, layoutDirection: "TB" }

      });

      document.addEventListener("DOMContentLoaded", function () {

        mermaid.run({ querySelector: ".mermaid" }).catch(function (err) {

          console.error("Mermaid render error:", err);

          document.querySelectorAll(".diagram-box").forEach(function (el) {

            if (!el.querySelector("svg")) el.setAttribute("data-error", "1");

          });

        });

      });

    })();

  </script>

</body>

</html>

"""





def main():

    root = Path(__file__).resolve().parents[1]

    md_path = root / "docs" / "Database_Structure_Pinit_Hub.md"

    out_path = root / "docs" / "Database_Structure_Pinit_Hub.html"

    vendor = root / "docs" / "vendor" / "mermaid.min.js"

    if not vendor.exists():

        print(f"Warning: {vendor} missing — run: curl -o docs/vendor/mermaid.min.js https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js")

    md_text = md_path.read_text(encoding="utf-8")

    md_body = re.sub(r"^# Database Structure[^\n]*\n\n", "", md_text, count=1)

    body = md_to_html_body(md_body)

    out_path.write_text(HTML_TEMPLATE.replace("{body}", body), encoding="utf-8")

    diagram_count = body.count('class="mermaid"')

    table_count = body.count("<table>")

    print(f"Wrote {out_path}")

    print(f"  Diagrams: {diagram_count}  Tables: {table_count}")





if __name__ == "__main__":

    main()

