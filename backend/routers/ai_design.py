"""Router for AI Design — Optimized design alternatives with cost-reduction strategies.

Uses Gemini for design generation (within RPM limit) and Groq for cost analysis.
"""

from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import store
from services.design_generator import (
    generate_design_alternatives,
    generate_cost_comparison,
    generate_svg_floor_plan,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai-design", tags=["AI Design"])


class DesignRequest(BaseModel):
    project_id: str
    optimization_goals: list[str] = ["cost_reduction"]


class DesignResponse(BaseModel):
    status: str = "success"
    alternatives: dict = {}
    cost_comparison: dict = {}
    svg_plans: list[str] = []
    error: Optional[str] = None


@router.post("/generate", response_model=DesignResponse)
async def generate_design(request: DesignRequest):
    """Generate optimized design alternatives for a project."""

    project = store.projects.get(request.project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    issues = store.get_project_issues(request.project_id)
    issues_dicts = issues

    # Step 1: Generate design alternatives via Gemini
    try:
        alternatives = await generate_design_alternatives(
            project_name=project.get("name", "Unnamed"),
            project_description=project.get("description", ""),
            issues=issues_dicts,
            building_codes=project.get("building_codes", []),
            optimization_goals=request.optimization_goals,
        )
    except Exception as exc:
        logger.error("Design generation failed: %s", exc)
        return DesignResponse(
            status="partial",
            error=f"Design generation failed: {str(exc)[:200]}",
        )

    # Step 2: Cost comparison via Groq
    cost_data = {}
    try:
        project_context = f"Project: {project.get('name', 'N/A')}, Issues: {len(issues)}"
        cost_data = await generate_cost_comparison(alternatives, project_context)
    except Exception as exc:
        logger.warning("Cost comparison failed: %s", exc)
        cost_data = {"error": str(exc)}

    # Step 3: Generate SVG floor plans for each alternative
    svg_plans = []
    for alt in alternatives.get("alternatives", []):
        rooms = alt.get("floor_plan", {}).get("rooms", [])
        if rooms:
            svg = generate_svg_floor_plan(rooms)
            svg_plans.append(svg)
        else:
            svg_plans.append("")

    return DesignResponse(
        status="success",
        alternatives=alternatives,
        cost_comparison=cost_data,
        svg_plans=svg_plans,
    )


@router.get("/sample")
async def get_sample_design():
    """Return sample design alternatives for demo purposes."""
    from services.design_generator import _fallback_alternatives, generate_svg_floor_plan

    alternatives = _fallback_alternatives("Sample Project")

    svg_plans = []
    for alt in alternatives.get("alternatives", []):
        rooms = alt.get("floor_plan", {}).get("rooms", [])
        svg_plans.append(generate_svg_floor_plan(rooms) if rooms else "")

    return DesignResponse(
        status="success",
        alternatives=alternatives,
        cost_comparison={
            "cost_breakdown": [
                {"alternative_id": 1, "total_cost": 2200000, "cost_per_sqft": 1833},
                {"alternative_id": 2, "total_cost": 2625000, "cost_per_sqft": 2187},
                {"alternative_id": 3, "total_cost": 2000000, "cost_per_sqft": 1667},
            ],
        },
        svg_plans=svg_plans,
    )
