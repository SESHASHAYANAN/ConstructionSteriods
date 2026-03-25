"""AI Design Generator — Optimized design alternatives with cost-reduction strategies.

Uses Gemini for design description generation and Groq for cost analysis.
Produces SVG-based floor plan visualizations.
Respects GEMINI_RPM_LIMIT via rate limiting.
"""

from __future__ import annotations

import asyncio
import json
import logging
import random
import time
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)


# ── Rate limiter ─────────────────────────────────────────────────────────────

class _DesignRateLimiter:
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._lock = asyncio.Semaphore(1)
            cls._instance._last_call = 0.0
        return cls._instance

    async def acquire(self):
        async with self._lock:
            now = time.time()
            min_gap = 60.0 / max(settings.gemini_rpm_limit, 1)
            elapsed = now - self._last_call
            if elapsed < min_gap:
                wait = min_gap - elapsed + random.uniform(0.5, 1.5)
                logger.info("Design rate limiter: waiting %.1fs", wait)
                await asyncio.sleep(wait)
            self._last_call = time.time()

_rate_limiter = _DesignRateLimiter()

# ── Prompts ──────────────────────────────────────────────────────────────────

DESIGN_ALTERNATIVES_PROMPT = """You are a world-class architect and construction optimizer with 30+ years of experience in sustainable, cost-effective design.

Based on the following project context, generate 3 optimized design alternatives with cost-reduction strategies.

PROJECT CONTEXT:
{project_context}

OPTIMIZATION GOALS: {goals}

For each alternative, respond with a JSON object:

{{
  "alternatives": [
    {{
      "id": 1,
      "name": "Alternative name (e.g., 'Cost-Optimized Standard')",
      "strategy": "Brief strategy description",
      "key_changes": [
        "List of specific design changes"
      ],
      "cost_reduction_percent": <estimated % reduction>,
      "trade_offs": [
        "List of trade-offs or compromises"
      ],
      "materials_changed": {{
        "original": "Original material/spec",
        "proposed": "Proposed replacement",
        "savings_reason": "Why this saves cost"
      }},
      "structural_impact": "Impact on structural integrity (None/Low/Medium)",
      "energy_efficiency": "Impact on energy efficiency (Improved/Same/Reduced)",
      "timeline_impact_days": <change in construction days, positive=longer>,
      "sustainability_score": <1-10>,
      "floor_plan": {{
        "rooms": [
          {{
            "name": "Room name",
            "x": <x position 0-100>,
            "y": <y position 0-100>,
            "width": <width 0-100>,
            "height": <height 0-100>,
            "color": "#hex color"
          }}
        ],
        "total_area_sqft": <area>,
        "dimensions": {{
          "width_ft": <width>,
          "length_ft": <length>
        }}
      }}
    }}
  ],
  "comparison": {{
    "original_estimated_cost": <INR>,
    "alternative_costs": [<cost1>, <cost2>, <cost3>],
    "recommended": <id of recommended alternative>,
    "recommendation_reason": "Why this is recommended"
  }},
  "general_recommendations": [
    "List of general cost-reduction tips applicable to this project"
  ]
}}

Be specific, practical, and grounded in real construction economics. Use Indian market context (INR, local materials, IS codes)."""


COST_ANALYSIS_PROMPT = """You are a senior construction cost consultant. Analyze the following design alternatives and provide detailed cost breakdowns.

ALTERNATIVES:
{alternatives_data}

PROJECT CONTEXT:
{project_context}

Provide a cost comparison as JSON:

{{
  "cost_breakdown": [
    {{
      "alternative_id": 1,
      "structural_cost": <INR>,
      "finishing_cost": <INR>,
      "mep_cost": <INR>,
      "exterior_cost": <INR>,
      "total_cost": <INR>,
      "cost_per_sqft": <INR>,
      "roi_years": <payback years if applicable>,
      "lifecycle_cost_10yr": <INR>
    }}
  ],
  "savings_analysis": {{
    "max_savings_percent": <percent>,
    "min_quality_impact": "Which alternative has least quality impact",
    "best_value": "Which alternative offers best value"
  }}
}}

Use realistic 2024-2025 Indian market rates."""


async def generate_design_alternatives(
    project_name: str,
    project_description: str = "",
    issues: list[dict] | None = None,
    building_codes: list[str] | None = None,
    optimization_goals: list[str] | None = None,
) -> dict[str, Any]:
    """Generate optimized design alternatives using Gemini."""

    api_key = settings.gemini_api_key
    if not api_key:
        raise ValueError("GEMINI_API_KEY not configured")

    goals = optimization_goals or ["cost_reduction"]
    issues = issues or []
    building_codes = building_codes or []

    # Build project context
    context_parts = [
        f"Project: {project_name}",
        f"Description: {project_description or 'N/A'}",
        f"Building Codes: {', '.join(building_codes) if building_codes else 'Standard IS codes'}",
        f"Total Issues Found: {len(issues)}",
    ]

    # Add key issues for context
    critical = [i for i in issues if i.get("severity") == "Critical"]
    if critical:
        context_parts.append("Key Critical Issues:")
        for c in critical[:5]:
            context_parts.append(f"  - {c.get('issue_type', 'N/A')}: {c.get('description', 'N/A')[:100]}")

    project_context = "\n".join(context_parts)
    goals_str = ", ".join(g.replace("_", " ").title() for g in goals)

    await _rate_limiter.acquire()

    model_name = settings.gemini_model
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={api_key}"
    )

    payload = {
        "contents": [{
            "parts": [{
                "text": DESIGN_ALTERNATIVES_PROMPT.format(
                    project_context=project_context,
                    goals=goals_str,
                )
            }],
        }],
        "generationConfig": {
            "temperature": 0.3,
            "maxOutputTokens": 8192,
        },
    }

    async with httpx.AsyncClient(timeout=90.0) as client:
        for attempt in range(3):
            try:
                response = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
                if response.status_code == 429:
                    delay = 8.0 * (2 ** attempt) + random.uniform(1, 3)
                    logger.warning("Gemini 429 for design gen, waiting %.1fs", delay)
                    await asyncio.sleep(delay)
                    continue
                response.raise_for_status()
                data = response.json()
                break
            except Exception as exc:
                if attempt == 2:
                    logger.error("Design generation failed: %s", exc)
                    return _fallback_alternatives(project_name)
                await asyncio.sleep(3)

    # Parse response
    candidates = data.get("candidates", [])
    if not candidates:
        return _fallback_alternatives(project_name)

    try:
        text = candidates[0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return _fallback_alternatives(project_name)

    return _parse_json_response(text)


async def generate_cost_comparison(
    alternatives: dict[str, Any],
    project_context: str = "",
) -> dict[str, Any]:
    """Generate cost comparison using Groq."""
    from langchain_groq import ChatGroq

    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=settings.groq_api_key,
        temperature=0.1,
        max_tokens=4096,
    )

    prompt = COST_ANALYSIS_PROMPT.format(
        alternatives_data=json.dumps(alternatives, indent=2)[:3000],
        project_context=project_context,
    )

    try:
        response = await asyncio.to_thread(
            llm.invoke,
            [
                {"role": "system", "content": "You are a construction cost analyst. Return ONLY valid JSON."},
                {"role": "user", "content": prompt},
            ],
        )
        return _parse_json_response(response.content)
    except Exception as exc:
        logger.warning("Cost comparison failed: %s", exc)
        return {"error": str(exc), "cost_breakdown": []}


def generate_svg_floor_plan(rooms: list[dict], width: int = 500, height: int = 400) -> str:
    """Generate SVG markup for a floor plan visualization."""

    svg_parts = [
        f'<svg viewBox="0 0 {width} {height}" xmlns="http://www.w3.org/2000/svg" '
        f'style="background:#f8fafc;border-radius:12px">',
        f'<rect width="{width}" height="{height}" fill="#0f172a" rx="12"/>',
    ]

    # Grid lines
    for i in range(0, width, 50):
        svg_parts.append(f'<line x1="{i}" y1="0" x2="{i}" y2="{height}" stroke="#1e293b" stroke-width="0.5"/>')
    for i in range(0, height, 50):
        svg_parts.append(f'<line x1="0" y1="{i}" x2="{width}" y2="{i}" stroke="#1e293b" stroke-width="0.5"/>')

    colors = {
        "bedroom": "#3b82f6", "kitchen": "#f59e0b", "bathroom": "#8b5cf6",
        "living": "#22c55e", "dining": "#ef4444", "utility": "#6b7280",
        "garage": "#78716c", "balcony": "#06b6d4", "corridor": "#94a3b8",
    }

    for room in rooms:
        x = room.get("x", 10) * width / 100
        y = room.get("y", 10) * height / 100
        w = room.get("width", 20) * width / 100
        h = room.get("height", 20) * height / 100
        color = room.get("color") or colors.get(room.get("type", "").lower(), "#64748b")
        name = room.get("name", "Room")

        svg_parts.extend([
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" fill="{color}" fill-opacity="0.2" '
            f'stroke="{color}" stroke-width="2" rx="4"/>',
            f'<text x="{x + w/2}" y="{y + h/2}" text-anchor="middle" fill="{color}" '
            f'font-size="11" font-family="Calibri,sans-serif" font-weight="bold">{name}</text>',
        ])

    svg_parts.append('</svg>')
    return '\n'.join(svg_parts)


def _fallback_alternatives(project_name: str) -> dict[str, Any]:
    """Fallback design alternatives when AI fails."""
    return {
        "alternatives": [
            {
                "id": 1,
                "name": "Cost-Optimized Standard",
                "strategy": "Replace premium materials with cost-effective alternatives without compromising structural integrity",
                "key_changes": [
                    "Use AAC blocks instead of red clay bricks (30% lighter, better insulation)",
                    "Use fly ash-based cement (PPC) instead of OPC 53 for non-structural elements",
                    "Pre-fabricated door/window frames instead of custom carpentry",
                    "M-Sand instead of river sand as per IS 383:2016",
                ],
                "cost_reduction_percent": 12,
                "trade_offs": ["Slightly longer curing time with PPC", "Limited custom design options for doors/windows"],
                "structural_impact": "None",
                "energy_efficiency": "Improved",
                "timeline_impact_days": -5,
                "sustainability_score": 8,
                "floor_plan": {
                    "rooms": [
                        {"name": "Living", "x": 5, "y": 5, "width": 35, "height": 40, "color": "#22c55e"},
                        {"name": "Kitchen", "x": 40, "y": 5, "width": 25, "height": 25, "color": "#f59e0b"},
                        {"name": "Bedroom 1", "x": 5, "y": 50, "width": 30, "height": 45, "color": "#3b82f6"},
                        {"name": "Bedroom 2", "x": 40, "y": 35, "width": 30, "height": 30, "color": "#3b82f6"},
                        {"name": "Bath", "x": 72, "y": 5, "width": 23, "height": 25, "color": "#8b5cf6"},
                    ],
                },
            },
            {
                "id": 2,
                "name": "Green Sustainable Design",
                "strategy": "Maximize energy efficiency and sustainability for long-term savings",
                "key_changes": [
                    "Solar panel integration on roof (3kW system)",
                    "Rainwater harvesting system",
                    "Cross-ventilation optimized room layout",
                    "Low-VOC paints and eco-friendly finishes",
                ],
                "cost_reduction_percent": -5,
                "trade_offs": ["Higher upfront cost", "ROI over 5-7 years through energy savings"],
                "structural_impact": "None",
                "energy_efficiency": "Significantly Improved",
                "timeline_impact_days": 10,
                "sustainability_score": 10,
                "floor_plan": {
                    "rooms": [
                        {"name": "Living", "x": 5, "y": 5, "width": 40, "height": 35, "color": "#22c55e"},
                        {"name": "Kitchen", "x": 50, "y": 5, "width": 20, "height": 30, "color": "#f59e0b"},
                        {"name": "Bedroom 1", "x": 5, "y": 45, "width": 35, "height": 50, "color": "#3b82f6"},
                        {"name": "Bedroom 2", "x": 45, "y": 40, "width": 25, "height": 28, "color": "#3b82f6"},
                        {"name": "Bath", "x": 75, "y": 5, "width": 20, "height": 25, "color": "#8b5cf6"},
                    ],
                },
            },
            {
                "id": 3,
                "name": "Maximum Value Engineering",
                "strategy": "Aggressive cost optimization through value engineering across all trades",
                "key_changes": [
                    "Reduce wall thickness from 9\" to 6\" for partition walls",
                    "Use UPVC windows instead of aluminum",
                    "Vitrified tiles replaced with ceramic tiles in non-wet areas",
                    "Combine electrical and data conduits",
                    "Optimize foundation design with geotechnical data",
                ],
                "cost_reduction_percent": 20,
                "trade_offs": ["Slightly lower sound insulation", "Lower premium feel on finishes"],
                "structural_impact": "Low",
                "energy_efficiency": "Same",
                "timeline_impact_days": -10,
                "sustainability_score": 6,
                "floor_plan": {
                    "rooms": [
                        {"name": "Living", "x": 5, "y": 5, "width": 45, "height": 35, "color": "#22c55e"},
                        {"name": "Kitchen", "x": 55, "y": 5, "width": 20, "height": 25, "color": "#f59e0b"},
                        {"name": "Bed 1", "x": 5, "y": 45, "width": 30, "height": 50, "color": "#3b82f6"},
                        {"name": "Bed 2", "x": 40, "y": 45, "width": 25, "height": 25, "color": "#3b82f6"},
                        {"name": "Bath", "x": 75, "y": 5, "width": 20, "height": 20, "color": "#8b5cf6"},
                    ],
                },
            },
        ],
        "comparison": {
            "original_estimated_cost": 2500000,
            "alternative_costs": [2200000, 2625000, 2000000],
            "recommended": 1,
            "recommendation_reason": "Best balance of cost savings and quality retention",
        },
        "general_recommendations": [
            "Use local materials to reduce transportation costs",
            "Plan construction during dry season to avoid weather delays",
            "Bundle procurement for bulk discount on cement and steel",
            "Use pre-cast elements where possible for faster construction",
        ],
    }


def _parse_json_response(text: str) -> dict[str, Any]:
    """Parse JSON from AI response."""
    import re
    cleaned = text.strip()
    cleaned = re.sub(r'^```(?:json)?\s*\n?', '', cleaned)
    cleaned = re.sub(r'\n?```\s*$', '', cleaned)
    cleaned = cleaned.strip()

    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        pass

    first = cleaned.find("{")
    last = cleaned.rfind("}")
    if first != -1 and last > first:
        try:
            return json.loads(cleaned[first:last + 1])
        except (json.JSONDecodeError, ValueError):
            pass

    return {"raw_text": cleaned[:2000], "parse_error": True}
