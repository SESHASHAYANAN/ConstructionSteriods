"""Build Scratch Analysis — AI-powered house drawing analysis.

Analyzes uploaded house floor plans to suggest materials, BOQ, electrical,
plumbing, and itemized cost estimates using Gemini Vision + Groq.
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import random
import time
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)


# ── Rate limiter (reuse pattern from agents.py) ─────────────────────────────

class _BuildRateLimiter:
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
                logger.info("Build rate limiter: waiting %.1fs", wait)
                await asyncio.sleep(wait)
            self._last_call = time.time()


_rate_limiter = _BuildRateLimiter()


# ── Gemini Vision Analysis ──────────────────────────────────────────────────

LAYOUT_ANALYSIS_PROMPT = """You are an expert architect and structural engineer analyzing a residential house floor plan drawing.

Analyze this floor plan image and extract the following information in a structured JSON format:

{
  "layout_summary": "Brief description of the floor plan layout",
  "total_area_sqft": <estimated total area in sq ft>,
  "rooms": [
    {
      "name": "Room name (e.g., Master Bedroom, Kitchen)",
      "type": "bedroom|kitchen|bathroom|living|dining|utility|garage|balcony|corridor",
      "estimated_area_sqft": <area>,
      "dimensions": "estimated LxW"
    }
  ],
  "floors": <number of floors visible>,
  "structural_elements": {
    "columns": <estimated count>,
    "beams": <estimated count>,
    "walls": "load-bearing wall description",
    "foundation_type": "raft|strip|isolated|pile"
  },
  "openings": {
    "doors": <count>,
    "windows": <count>,
    "ventilators": <count>
  },
  "special_features": ["list of special features like staircase, lift, balcony, terrace"],
  "building_type": "residential|commercial|mixed"
}

Be as accurate as possible based on what you can see in the drawing. If dimensions are marked, use them. Otherwise, estimate based on typical residential proportions."""


MATERIAL_BOQ_PROMPT = """You are a senior quantity surveyor and construction estimator with 25+ years of experience in residential construction.

Based on the following house layout analysis, generate a comprehensive Bill of Quantities (BOQ) with material recommendations and itemized cost estimates.

LAYOUT ANALYSIS:
{layout_data}

Generate the response as a structured JSON object:

{{
  "material_recommendations": {{
    "cement": {{
      "grade": "OPC 53 Grade / OPC 43 Grade / PPC",
      "brand_suggestions": ["UltraTech", "ACC", "Ambuja"],
      "estimated_bags": <number>,
      "rationale": "Why this grade"
    }},
    "bricks": {{
      "type": "Red clay / Fly ash / AAC blocks / Concrete blocks",
      "size": "standard dimensions",
      "estimated_quantity": <number>,
      "rationale": "Why this type"
    }},
    "steel": {{
      "grade": "Fe500 / Fe500D / Fe550D",
      "estimated_kg": <number>,
      "rationale": "Why this grade"
    }},
    "concrete": {{
      "grade": "M20 / M25 / M30",
      "estimated_cubic_meters": <number>,
      "rationale": "Why this grade"
    }},
    "sand": {{
      "type": "River / M-Sand / Manufactured",
      "estimated_cubic_meters": <number>
    }},
    "aggregate": {{
      "size": "20mm / 12mm",
      "estimated_cubic_meters": <number>
    }}
  }},
  "electrical": {{
    "points": <total electrical points>,
    "lighting_points": <count>,
    "power_points": <count>,
    "ac_points": <count>,
    "wiring_type": "PVC insulated copper",
    "wire_gauge": "1.0mm / 1.5mm / 2.5mm / 4.0mm",
    "estimated_wire_meters": <meters>,
    "mcb_rating": "MCB specifications",
    "db_boxes": <count>,
    "earthing": "pipe/plate earthing specification"
  }},
  "plumbing": {{
    "water_supply_points": <count>,
    "drainage_points": <count>,
    "pipe_type": "CPVC / uPVC / PPR",
    "pipe_sizes": ["20mm supply", "110mm drainage"],
    "water_tank_capacity_liters": <liters>,
    "fixtures": {{
      "toilets": <count>,
      "wash_basins": <count>,
      "kitchen_sinks": <count>,
      "shower_points": <count>
    }},
    "sump_capacity_liters": <liters>
  }},
  "boq": [
    {{
      "sno": 1,
      "item": "Item description",
      "unit": "Bags/Nos/Sqft/Cum/Kg/Rmt",
      "quantity": <number>,
      "unit_rate": <rate in INR>,
      "amount": <total in INR>,
      "category": "structural|finishing|electrical|plumbing|misc"
    }}
  ],
  "cost_summary": {{
    "structural": <total INR>,
    "finishing": <total INR>,
    "electrical": <total INR>,
    "plumbing": <total INR>,
    "miscellaneous": <total INR>,
    "grand_total": <total INR>,
    "cost_per_sqft": <rate>
  }}
}}

Use current Indian market rates (2024-2025). Be realistic and comprehensive.
Include at minimum 20 BOQ line items covering all major construction activities."""


async def analyze_house_drawing(image_b64: str, mime_type: str = "image/jpeg") -> dict[str, Any]:
    """Send house drawing to Gemini Vision for layout analysis."""

    api_key = settings.gemini_api_key
    if not api_key:
        raise ValueError("GEMINI_API_KEY not configured")

    await _rate_limiter.acquire()

    model_name = settings.gemini_model
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={api_key}"
    )

    payload = {
        "systemInstruction": {
            "parts": [{"text": LAYOUT_ANALYSIS_PROMPT}],
        },
        "contents": [{
            "parts": [
                {"text": "Analyze this house floor plan drawing and extract the layout information as structured JSON."},
                {"inlineData": {"mimeType": mime_type, "data": image_b64}},
            ],
        }],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096,
        },
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        for attempt in range(3):
            try:
                response = await client.post(url, json=payload, headers={"Content-Type": "application/json"})
                if response.status_code == 429:
                    delay = 8.0 * (2 ** attempt) + random.uniform(1, 3)
                    logger.warning("Gemini 429 for build analysis, waiting %.1fs", delay)
                    await asyncio.sleep(delay)
                    continue
                response.raise_for_status()
                data = response.json()
                break
            except Exception as exc:
                if attempt == 2:
                    raise RuntimeError(f"Gemini Vision failed: {exc}")
                await asyncio.sleep(3)

    # Parse response
    candidates = data.get("candidates", [])
    if not candidates:
        return {"error": "No response from Gemini", "layout_summary": "Analysis unavailable"}

    text = ""
    try:
        text = candidates[0]["content"]["parts"][0]["text"]
    except (KeyError, IndexError):
        return {"error": "Empty Gemini response", "layout_summary": "Analysis unavailable"}

    # Parse JSON from response
    return _parse_json_response(text)


async def generate_material_boq(layout_data: dict[str, Any]) -> dict[str, Any]:
    """Generate material recommendations and BOQ from layout analysis using Groq."""

    from langchain_groq import ChatGroq

    llm = ChatGroq(
        model="llama-3.3-70b-versatile",
        api_key=settings.groq_api_key,
        temperature=0.1,
        max_tokens=8192,
    )

    prompt = MATERIAL_BOQ_PROMPT.format(layout_data=json.dumps(layout_data, indent=2))

    for attempt in range(3):
        try:
            response = await asyncio.to_thread(
                llm.invoke,
                [
                    {"role": "system", "content": "You are a senior construction quantity surveyor. Return ONLY valid JSON, no markdown fences."},
                    {"role": "user", "content": prompt},
                ],
            )
            result = _parse_json_response(response.content)
            return result
        except Exception as exc:
            logger.warning("BOQ generation attempt %d failed: %s", attempt + 1, exc)
            if attempt == 2:
                return _fallback_boq(layout_data)
            await asyncio.sleep(2)


def _fallback_boq(layout_data: dict) -> dict:
    """Generate a basic fallback BOQ when AI fails."""
    area = layout_data.get("total_area_sqft", 1200)
    rooms = layout_data.get("rooms", [])
    num_rooms = len(rooms)
    bathrooms = sum(1 for r in rooms if r.get("type") == "bathroom")

    return {
        "material_recommendations": {
            "cement": {"grade": "OPC 53 Grade", "estimated_bags": int(area * 0.4), "rationale": "Standard residential"},
            "bricks": {"type": "Red Clay Bricks", "estimated_quantity": int(area * 8), "rationale": "Conventional construction"},
            "steel": {"grade": "Fe500D", "estimated_kg": int(area * 4), "rationale": "Earthquake resistant"},
            "concrete": {"grade": "M25", "estimated_cubic_meters": int(area * 0.035), "rationale": "Residential standard"},
        },
        "electrical": {
            "points": num_rooms * 6 + 10,
            "wiring_type": "PVC insulated copper",
        },
        "plumbing": {
            "water_supply_points": bathrooms * 4 + 3,
            "drainage_points": bathrooms * 3 + 2,
            "pipe_type": "CPVC for supply, uPVC for drainage",
        },
        "boq": [
            {"sno": 1, "item": "Excavation", "unit": "Cum", "quantity": int(area * 0.02), "unit_rate": 350, "amount": int(area * 0.02 * 350), "category": "structural"},
            {"sno": 2, "item": "PCC (1:4:8)", "unit": "Cum", "quantity": int(area * 0.008), "unit_rate": 5500, "amount": int(area * 0.008 * 5500), "category": "structural"},
            {"sno": 3, "item": "RCC (M25)", "unit": "Cum", "quantity": int(area * 0.035), "unit_rate": 8500, "amount": int(area * 0.035 * 8500), "category": "structural"},
            {"sno": 4, "item": "Steel Reinforcement (Fe500D)", "unit": "Kg", "quantity": int(area * 4), "unit_rate": 75, "amount": int(area * 4 * 75), "category": "structural"},
            {"sno": 5, "item": "Brickwork", "unit": "Cum", "quantity": int(area * 0.025), "unit_rate": 6500, "amount": int(area * 0.025 * 6500), "category": "structural"},
            {"sno": 6, "item": "Plastering", "unit": "Sqm", "quantity": int(area * 2.8), "unit_rate": 45, "amount": int(area * 2.8 * 45), "category": "finishing"},
            {"sno": 7, "item": "Flooring (Vitrified tiles)", "unit": "Sqft", "quantity": int(area), "unit_rate": 85, "amount": int(area * 85), "category": "finishing"},
            {"sno": 8, "item": "Painting (Interior + Exterior)", "unit": "Sqft", "quantity": int(area * 3.5), "unit_rate": 22, "amount": int(area * 3.5 * 22), "category": "finishing"},
            {"sno": 9, "item": "Electrical Wiring", "unit": "Points", "quantity": num_rooms * 6, "unit_rate": 1800, "amount": num_rooms * 6 * 1800, "category": "electrical"},
            {"sno": 10, "item": "Plumbing", "unit": "Points", "quantity": bathrooms * 4, "unit_rate": 2500, "amount": bathrooms * 4 * 2500, "category": "plumbing"},
        ],
        "cost_summary": {
            "structural": int(area * 1200),
            "finishing": int(area * 450),
            "electrical": int(area * 180),
            "plumbing": int(area * 120),
            "miscellaneous": int(area * 100),
            "grand_total": int(area * 2050),
            "cost_per_sqft": 2050,
        },
    }


def _parse_json_response(text: str) -> dict[str, Any]:
    """Parse JSON from AI response with multiple strategies."""
    import re

    cleaned = text.strip()
    # Remove markdown fences
    cleaned = re.sub(r'^```(?:json)?\s*\n?', '', cleaned)
    cleaned = re.sub(r'\n?```\s*$', '', cleaned)
    cleaned = cleaned.strip()

    # Strategy 1: Direct parse
    try:
        return json.loads(cleaned)
    except (json.JSONDecodeError, ValueError):
        pass

    # Strategy 2: Find { } boundaries
    first = cleaned.find("{")
    last = cleaned.rfind("}")
    if first != -1 and last > first:
        try:
            return json.loads(cleaned[first:last + 1])
        except (json.JSONDecodeError, ValueError):
            pass

    # Strategy 3: Return as text
    return {"raw_text": cleaned, "parse_error": True}


def compress_upload_image(file_bytes: bytes, max_bytes: int = 3_000_000) -> tuple[str, str]:
    """Compress uploaded image for Gemini API."""
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(file_bytes))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Resize if needed
        max_dim = 2048
        if max(img.size) > max_dim:
            ratio = max_dim / max(img.size)
            img = img.resize((int(img.size[0] * ratio), int(img.size[1] * ratio)), Image.LANCZOS)

        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=80, optimize=True)

        if len(buf.getvalue()) > max_bytes:
            buf = io.BytesIO()
            img = img.resize((int(img.size[0] * 0.7), int(img.size[1] * 0.7)), Image.LANCZOS)
            img.save(buf, format="JPEG", quality=60, optimize=True)

        return base64.b64encode(buf.getvalue()).decode("utf-8"), "image/jpeg"
    except ImportError:
        return base64.b64encode(file_bytes).decode("utf-8"), "image/png"
