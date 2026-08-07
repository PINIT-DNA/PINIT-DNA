#!/usr/bin/env python3
"""Convert PINIT-DNA-USER-TEST-FLOW.md to Word .docx."""

from pathlib import Path
import importlib.util

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "md-to-docx.py"

# Load md-to-docx as a module, then override paths and convert
spec = importlib.util.spec_from_file_location("md_to_docx", SCRIPT)
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

mod.MD_PATH = ROOT / "docs" / "PINIT-DNA-USER-TEST-FLOW.md"
mod.OUT_PATH = ROOT / "docs" / "PINIT-DNA-USER-TEST-FLOW.docx"
mod.convert()
