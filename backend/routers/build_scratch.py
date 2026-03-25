"""Router for Build Scratch — AI house drawing analysis.

Upload a floor plan image → get material recommendations, BOQ, and cost estimates.
"""

from __future__ import annotations

import base64
import logging
from typing import Optional

from fastapi import APIRouter, File, UploadFile, Form, HTTPException
from pydantic import BaseModel

from services.build_analysis import (
    analyze_house_drawing,
    generate_material_boq,
    compress_upload_image,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/build-scratch", tags=["Build Scratch"])


class BuildAnalysisResponse(BaseModel):
    status: str = "success"
    layout: dict = {}
    materials: dict = {}
    error: Optional[str] = None


@router.post("/analyze", response_model=BuildAnalysisResponse)
async def analyze_drawing(
    file: UploadFile = File(...),
    area_sqft: Optional[float] = Form(None),
    location: Optional[str] = Form(None),
):
    """Analyze an uploaded house floor plan drawing.

    Returns layout analysis, material recommendations, BOQ, and cost estimates.
    """

    # Validate file type
    allowed_types = ["image/jpeg", "image/png", "image/webp", "image/tiff", "application/pdf"]
    content_type = file.content_type or ""
    if not any(t in content_type for t in ["image", "pdf"]):
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {content_type}. Upload JPEG, PNG, WebP, or PDF.",
        )

    # Read file
    try:
        file_bytes = await file.read()
        if len(file_bytes) > 20_000_000:  # 20MB limit
            raise HTTPException(status_code=400, detail="File too large. Maximum 20MB.")
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {exc}")

    # Compress for Gemini
    try:
        image_b64, mime_type = compress_upload_image(file_bytes)
    except Exception as exc:
        logger.error("Image compression failed: %s", exc)
        raise HTTPException(status_code=500, detail="Failed to process image")

    # Step 1: Gemini Vision layout analysis
    try:
        layout_data = await analyze_house_drawing(image_b64, mime_type)
    except Exception as exc:
        logger.error("Layout analysis failed: %s", exc)
        return BuildAnalysisResponse(
            status="partial",
            layout={"error": str(exc), "layout_summary": "Analysis failed - using defaults"},
            materials={},
            error=f"Layout analysis failed: {str(exc)[:200]}",
        )

    # Inject user-provided area if available
    if area_sqft and not layout_data.get("parse_error"):
        layout_data["total_area_sqft"] = area_sqft

    if location:
        layout_data["location"] = location

    # Step 2: Material & BOQ generation via Groq
    try:
        material_data = await generate_material_boq(layout_data)
    except Exception as exc:
        logger.error("Material BOQ generation failed: %s", exc)
        material_data = {"error": str(exc)}

    return BuildAnalysisResponse(
        status="success",
        layout=layout_data,
        materials=material_data,
    )


@router.get("/sample")
async def get_sample_analysis():
    """Return a sample analysis for demo purposes."""
    from services.build_analysis import _fallback_boq

    sample_layout = {
        "layout_summary": "2BHK residential unit with open kitchen",
        "total_area_sqft": 1200,
        "rooms": [
            {"name": "Living Room", "type": "living", "estimated_area_sqft": 250, "dimensions": "16x16"},
            {"name": "Master Bedroom", "type": "bedroom", "estimated_area_sqft": 180, "dimensions": "15x12"},
            {"name": "Bedroom 2", "type": "bedroom", "estimated_area_sqft": 144, "dimensions": "12x12"},
            {"name": "Kitchen", "type": "kitchen", "estimated_area_sqft": 100, "dimensions": "10x10"},
            {"name": "Bathroom 1", "type": "bathroom", "estimated_area_sqft": 48, "dimensions": "8x6"},
            {"name": "Bathroom 2", "type": "bathroom", "estimated_area_sqft": 36, "dimensions": "6x6"},
            {"name": "Balcony", "type": "balcony", "estimated_area_sqft": 60, "dimensions": "10x6"},
        ],
        "floors": 1,
        "structural_elements": {"columns": 8, "beams": 12, "walls": "Load-bearing on perimeter"},
        "openings": {"doors": 8, "windows": 10, "ventilators": 3},
    }

    materials = _fallback_boq(sample_layout)

    return BuildAnalysisResponse(
        status="success",
        layout=sample_layout,
        materials=materials,
    )
