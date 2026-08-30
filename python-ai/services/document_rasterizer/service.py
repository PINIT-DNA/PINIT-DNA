"""
Document Rasterizer — renders PDF pages to PNG images.

Feeds PINIT's existing per-image pixel protection pipeline (DNA layers, pixel
HKCA tamper localization, patch-level local-DNA indexing) on a page-by-page
basis, so documents get the same pixel-level protection standalone images do.
"""
from __future__ import annotations

import base64
from typing import Any

from ..base import EnterpriseAIService, ServiceResult

try:
    import pymupdf as fitz  # PyMuPDF (the `fitz` module name is deprecated upstream)
except ImportError:
    fitz = None

DEFAULT_DPI = 150
MIN_DPI = 72
MAX_DPI = 300
DEFAULT_MAX_PAGES = 40


class DocumentRasterizerService(EnterpriseAIService):
    name = "document_rasterizer"

    def is_available(self) -> bool:
        return fitz is not None

    def status(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "available": self.is_available(),
            "engine": "PyMuPDF" if fitz is not None else None,
        }

    def rasterize_pdf(
        self,
        buffer: bytes,
        dpi: int = DEFAULT_DPI,
        max_pages: int = DEFAULT_MAX_PAGES,
    ) -> ServiceResult:
        if fitz is None:
            return ServiceResult(success=False, data={}, error="PyMuPDF not installed", module=self.name)

        dpi = max(MIN_DPI, min(MAX_DPI, dpi))
        zoom = dpi / 72.0
        matrix = fitz.Matrix(zoom, zoom)

        try:
            doc = fitz.open(stream=buffer, filetype="pdf")
        except Exception as exc:
            return ServiceResult(success=False, data={}, error=f"Failed to open PDF: {exc}", module=self.name)

        try:
            total_pages = doc.page_count
            pages_to_render = min(total_pages, max(0, max_pages))
            pages: list[dict[str, Any]] = []

            for i in range(pages_to_render):
                page = doc.load_page(i)
                pix = page.get_pixmap(matrix=matrix, alpha=False)
                png_bytes = pix.tobytes("png")
                pages.append({
                    "pageNumber": i + 1,
                    "width": pix.width,
                    "height": pix.height,
                    "imageBase64": base64.b64encode(png_bytes).decode("ascii"),
                })

            return ServiceResult(
                success=True,
                data={
                    "totalPages": total_pages,
                    "renderedPages": len(pages),
                    "truncated": total_pages > pages_to_render,
                    "dpi": dpi,
                    "pages": pages,
                },
                module=self.name,
            )
        except Exception as exc:
            return ServiceResult(success=False, data={}, error=f"Rasterization failed: {exc}", module=self.name)
        finally:
            doc.close()


document_rasterizer_service = DocumentRasterizerService()
