"""Materials router: Material Quality Analysis via AI Vision."""

from __future__ import annotations

import base64
import logging

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from routers.auth import get_current_user
from services.material_analysis import analyze_material_image, MATERIAL_STANDARDS

router = APIRouter(prefix="/materials", tags=["Material Analysis"])
logger = logging.getLogger(__name__)


@router.get("/standards")
def get_material_standards(_: dict = Depends(get_current_user)):
    """Return the material standards reference database for frontend dropdowns."""
    return {
        material_type: {
            "standards": info["standards"],
            "key_checks": info["key_checks"],
        }
        for material_type, info in MATERIAL_STANDARDS.items()
    }


@router.post("/analyze")
async def analyze_material(
    file: UploadFile = File(...),
    material_type: str = Form("Auto-Detect"),
    expected_spec: str = Form(""),
    _: dict = Depends(get_current_user),
):
    """Upload a material photo for AI-powered quality analysis.

    Accepts an image file along with optional material type and expected spec.
    Returns structured quality analysis with verdict, issues, and recommendations.
    """
    # Validate file type
    if file.content_type and not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only image files are accepted.")

    try:
        image_bytes = await file.read()
        if len(image_bytes) > 20_000_000:  # 20MB limit
            raise HTTPException(status_code=400, detail="Image file too large (max 20MB).")

        image_b64 = base64.b64encode(image_bytes).decode("utf-8")

        result = await analyze_material_image(
            image_b64=image_b64,
            material_type=material_type,
            expected_spec=expected_spec,
        )
        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Material analysis endpoint error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Material analysis failed: {str(exc)[:200]}")
