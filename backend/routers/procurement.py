"""Procurement router: Smart AI-powered procurement analysis."""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from routers.auth import get_current_user
from services.procurement import analyze_procurement
import store

router = APIRouter(prefix="/procurement", tags=["Smart Procurement"])
logger = logging.getLogger(__name__)


class ProcurementItem(BaseModel):
    name: str
    quantity: str = ""
    unit: str = ""
    spec: str = ""


class ProcurementRequest(BaseModel):
    items: list[ProcurementItem]
    project_id: Optional[str] = None
    region: str = "General"
    budget_preference: str = "Mid-Range"


@router.post("/analyze")
async def analyze(body: ProcurementRequest, _: dict = Depends(get_current_user)):
    """Analyze procurement requirements and get AI-powered supplier recommendations.

    Accepts a list of material items and returns cost analysis,
    supplier recommendations, savings opportunities, and risk assessment.
    """
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one item is required.")

    # Get project name for context if project_id is provided
    project_name = ""
    if body.project_id and body.project_id in store.projects:
        project_name = store.projects[body.project_id].get("name", "")

    items_list = [item.model_dump() for item in body.items]

    try:
        result = await analyze_procurement(
            items=items_list,
            project_name=project_name,
            region=body.region,
            budget_preference=body.budget_preference,
        )
        return result
    except Exception as exc:
        logger.error("Procurement analysis endpoint error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Procurement analysis failed: {str(exc)[:200]}")
