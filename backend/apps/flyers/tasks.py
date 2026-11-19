"""Flyer asset generation (queue: flyers).

Renders the A4 flyer HTML template to PDF (WeasyPrint) and PNG (Playwright screenshot at
300dpi), uploads both to the private bucket, marks the flyer active and broadcasts
`flyer.generated` over WebSockets.
"""

from __future__ import annotations

import logging
import uuid

from celery import shared_task
from django.conf import settings
from django.template.loader import render_to_string

from apps.common import storage

from .consumers import broadcast_flyer_generated
from .qr import QrService
from .selectors import get_flyer_by_id

logger = logging.getLogger(__name__)

A4_300DPI_PX = (2480, 3508)  # 210mm x 297mm at 300dpi


def render_flyer_html(flyer) -> str:  # noqa: ANN001
    template = "flyers/outreach.html" if flyer.mode == "outreach" else "flyers/emergency.html"
    target = flyer.qr_target_value or QrService.target_url(str(flyer.pk), settings.FRONTEND_BASE_URL)
    qr_svg = QrService.svg_for_url(target)
    # Deterministic design variant per flyer ID so every printed flyer looks unique.
    variant = int(flyer.pk.hex[:8], 16) % 4 + 1
    return render_to_string(
        template,
        {"flyer": flyer, "qr_svg": qr_svg, "pet": flyer.pet, "design_variant": variant},
    )


def render_flyer_pdf(html: str) -> bytes:
    """A4 PDF via WeasyPrint (print-fidelity vector output)."""
    from weasyprint import HTML

    return HTML(string=html, base_url=settings.FRONTEND_BASE_URL).write_pdf()


def render_flyer_png(html: str) -> bytes:
    """A4@300dpi PNG via Playwright (Chromium screenshot, deviceScaleFactor=300/96)."""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page(viewport={"width": A4_300DPI_PX[0], "height": A4_300DPI_PX[1]},
                                device_scale_factor=300 / 96)
        page.set_content(html, wait_until="networkidle")
        png = page.screenshot(full_page=True)
        browser.close()
    return png


@shared_task(name="apps.flyers.tasks.generate_flyer_assets", bind=True, max_retries=3)
def generate_flyer_assets(self, flyer_id: str) -> dict:
    flyer = get_flyer_by_id(uuid.UUID(flyer_id))
    if flyer is None:
        logger.warning("generate_flyer_assets: flyer %s not found", flyer_id)
        return {"flyer_id": flyer_id, "status": "missing"}
    html = render_flyer_html(flyer)
    pdf_bytes = render_flyer_pdf(html)
    png_bytes = render_flyer_png(html)
    pdf_key = f"flyers/{flyer.pk}/flyer.pdf"
    png_key = f"flyers/{flyer.pk}/flyer.png"
    storage.upload_bytes(pdf_key, pdf_bytes, content_type="application/pdf")
    storage.upload_bytes(png_key, png_bytes, content_type="image/png")
    from .models import Flyer

    Flyer.objects.filter(pk=flyer.pk).update(
        export_pdf_path=pdf_key, export_png_path=png_key, status=Flyer.Status.ACTIVE
    )
    broadcast_flyer_generated(
        flyer_id=str(flyer.pk),
        export_png_url=storage.signed_url(png_key),
        export_pdf_url=storage.signed_url(pdf_key),
    )
    return {"flyer_id": flyer_id, "status": "active"}
