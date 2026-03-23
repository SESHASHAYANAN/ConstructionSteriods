"""Material Quality Analysis — AI Vision service for verifying construction materials.

Uses Google Gemini Vision API to inspect site photos of cement, bricks, rebar, etc.
and compare visible specs against expected standards.
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
from services.agents import (
    GeminiRateLimiter,
    _compress_image_b64,
    _strip_markdown_fences,
)

logger = logging.getLogger(__name__)

_gemini_limiter = GeminiRateLimiter()

# ── Material Standards Reference Database ────────────────────────────────────

MATERIAL_STANDARDS = {
    "Cement": {
        "standards": [
            {"code": "IS 269:2015", "name": "Ordinary Portland Cement (OPC) — 33, 43, 53 Grade"},
            {"code": "IS 1489:1991", "name": "Portland Pozzolana Cement (PPC)"},
            {"code": "ASTM C150", "name": "Standard Specification for Portland Cement"},
            {"code": "EN 197-1", "name": "Cement — Composition, Specifications"},
            {"code": "BS 12:1996", "name": "Specification for Portland Cement"},
        ],
        "key_checks": [
            "Grade marking (OPC 33/43/53, PPC)",
            "ISI/BIS certification mark",
            "Manufacturing date and expiry",
            "Bag weight (50 kg standard)",
            "Physical condition — no lumps, moisture damage",
            "Brand name and batch number",
            "Fineness and color consistency",
        ],
    },
    "Bricks": {
        "standards": [
            {"code": "IS 1077:1992", "name": "Common Burnt Clay Building Bricks"},
            {"code": "IS 3495", "name": "Methods of Tests for Burnt Clay Building Bricks"},
            {"code": "ASTM C62", "name": "Standard Specification for Building Brick"},
            {"code": "ASTM C216", "name": "Standard Specification for Facing Brick"},
            {"code": "EN 771-1", "name": "Specification for Masonry Units — Clay Masonry Units"},
        ],
        "key_checks": [
            "Class/Grade designation (A, B, C)",
            "Dimensional uniformity (standard: 190×90×90mm or 230×110×75mm)",
            "Color uniformity — consistent red/brown",
            "Sound test — metallic ring when struck",
            "Surface texture — no cracks, chips, or warping",
            "Efflorescence — white salt deposits",
            "Compressive strength markings",
        ],
    },
    "Rebar": {
        "standards": [
            {"code": "IS 1786:2008", "name": "High Strength Deformed Steel Bars for Concrete Reinforcement"},
            {"code": "ASTM A615", "name": "Standard Specification for Deformed Steel Bars"},
            {"code": "ASTM A706", "name": "Low-Alloy Steel Deformed Bars for Concrete Reinforcement"},
            {"code": "BS 4449:2005", "name": "Steel for Reinforcement of Concrete"},
            {"code": "EN 10080", "name": "Steel for Reinforcement of Concrete"},
        ],
        "key_checks": [
            "Grade marking (Fe 415, Fe 500, Fe 550, Fe 600)",
            "Rib pattern and deformation geometry",
            "Diameter verification (8mm, 10mm, 12mm, 16mm, 20mm, 25mm, 32mm)",
            "Mill certificate / heat number",
            "Rust condition — surface vs deep corrosion",
            "Bundle tag with manufacturer and grade",
            "Bend test indicators — no cracks at bends",
        ],
    },
    "Aggregate": {
        "standards": [
            {"code": "IS 383:2016", "name": "Coarse and Fine Aggregates for Concrete"},
            {"code": "ASTM C33", "name": "Standard Specification for Concrete Aggregates"},
            {"code": "BS 882:1992", "name": "Specification for Aggregates from Natural Sources"},
            {"code": "EN 12620", "name": "Aggregates for Concrete"},
        ],
        "key_checks": [
            "Grading/size classification (10mm, 20mm, 40mm coarse; Zone I-IV fine)",
            "Shape — angular vs rounded vs flaky/elongated",
            "Cleanliness — free from clay, silt, organic matter",
            "Color and mineral consistency",
            "Moisture condition — SSD, oven-dry, wet",
            "Presence of deleterious materials",
        ],
    },
    "Steel": {
        "standards": [
            {"code": "IS 2062:2011", "name": "Hot Rolled Structural Steel"},
            {"code": "ASTM A36", "name": "Standard Specification for Carbon Structural Steel"},
            {"code": "ASTM A992", "name": "Standard Specification for Structural Steel Shapes"},
            {"code": "EN 10025", "name": "Hot Rolled Products of Structural Steels"},
            {"code": "BS 4360", "name": "Specification for Weldable Structural Steels"},
        ],
        "key_checks": [
            "Grade designation (E250, E350, A36, S275, S355)",
            "Section profile and dimensions",
            "Mill certificate and heat number",
            "Surface condition — rust, pitting, mill scale",
            "Straightness and dimensional tolerances",
            "Weldability markings",
        ],
    },
    "Timber": {
        "standards": [
            {"code": "IS 883:1994", "name": "Design of Structural Timber in Building"},
            {"code": "IS 1141:1993", "name": "Code of Practice for Seasoning of Timber"},
            {"code": "ASTM D245", "name": "Standard Practice for Establishing Structural Grades for Lumber"},
            {"code": "EN 338", "name": "Structural Timber — Strength Classes"},
        ],
        "key_checks": [
            "Species and grade marking",
            "Moisture content (should be ≤19% for structural use)",
            "Grain pattern and defects (knots, splits, shakes, wane)",
            "Treatment/preservation markings (CCA, ACQ)",
            "Dimensional accuracy",
            "Signs of decay, insect damage, or fungal growth",
        ],
    },
}


# ── Gemini Vision Prompt for Material Analysis ───────────────────────────────

MATERIAL_ANALYSIS_PROMPT = """You are an expert Construction Material Quality Inspector with 25+ years of field experience. You are analyzing a site photograph of construction materials to verify quality and specification compliance.

Perform a comprehensive visual inspection and evaluate:

### IDENTIFICATION
1. **Material Type**: Identify the exact material shown (cement bags, bricks, rebar bundles, aggregate piles, steel sections, timber, etc.)
2. **Brand/Manufacturer**: Read any visible brand names, logos, or manufacturer markings
3. **Grade/Spec Markings**: Read ALL visible grade stamps, certification marks, ISI/BIS marks, ASTM references, batch numbers

### QUALITY ASSESSMENT
4. **Physical Condition**: Check for damage, moisture, contamination, deformation, corrosion, cracks, chips
5. **Dimensional Conformity**: Assess visible dimensional consistency (if measurable from the image)
6. **Storage Conditions**: Evaluate if the material is being stored properly (covered, elevated, ventilated, protected from elements)
7. **Certification Marks**: Look for quality certification stamps (ISI, BIS, CE, ASTM compliance)
8. **Quantity/Packaging**: Note bag counts, bundle sizes, stacking condition

### COMPLIANCE CHECK
9. **Standard Conformity**: Compare visible specs against the expected specification provided
10. **Defect Identification**: Flag any visible defects, damage, or non-conformances
11. **Shelf Life**: Check for manufacturing dates, expiry dates, batch numbers on packaging

Return your analysis as a JSON object with these exact fields:
{
  "verdict": "PASS" | "FAIL" | "REVIEW",
  "confidence": 0.0-1.0,
  "material_detected": "string — what material you see in the image",
  "brand_identified": "string or null",
  "grade_markings": ["list of all visible grade/standard markings"],
  "physical_condition": "Excellent" | "Good" | "Fair" | "Poor" | "Rejected",
  "storage_assessment": "Proper" | "Acceptable" | "Improper" | "N/A",
  "issues": [
    {
      "type": "string — issue category",
      "severity": "Critical" | "Major" | "Minor",
      "description": "string — detailed description",
      "standard_reference": "string — applicable standard clause"
    }
  ],
  "spec_comparison": {
    "expected": "string — the expected spec",
    "observed": "string — what was actually observed",
    "conformity": "Conforms" | "Partial" | "Non-Conforming" | "Cannot Determine"
  },
  "recommendations": ["list of specific actionable recommendations"],
  "summary": "string — 2-3 sentence executive summary"
}

Return ONLY the JSON object, no additional text. Be extremely thorough and specific in your observations."""


# ── Analysis Function ────────────────────────────────────────────────────────

async def analyze_material_image(
    image_b64: str,
    material_type: str = "Auto-Detect",
    expected_spec: str = "",
) -> dict[str, Any]:
    """Analyze a construction material image using Gemini Vision API.

    Args:
        image_b64: Base64-encoded image data
        material_type: Type of material (e.g., "Cement", "Bricks", "Rebar")
        expected_spec: Expected specification to verify against

    Returns:
        Structured analysis result dict
    """
    api_key = settings.gemini_api_key
    if not api_key:
        return {
            "verdict": "FAIL",
            "confidence": 0.0,
            "material_detected": "Unknown",
            "issues": [{
                "type": "Configuration Error",
                "severity": "Critical",
                "description": "GEMINI_API_KEY is not configured. Set it in .env to enable material analysis.",
                "standard_reference": "N/A",
            }],
            "recommendations": ["Add GEMINI_API_KEY=your_key to the .env file."],
            "summary": "Analysis could not be performed — API key missing.",
        }

    # Compress image for API
    compressed_b64, mime_type = _compress_image_b64(image_b64)

    # Build user prompt with material context
    standards_info = ""
    if material_type in MATERIAL_STANDARDS:
        std = MATERIAL_STANDARDS[material_type]
        standards_info = (
            f"\n\nApplicable Standards for {material_type}:\n"
            + "\n".join(f"- {s['code']}: {s['name']}" for s in std["standards"])
            + "\n\nKey Quality Checks:\n"
            + "\n".join(f"- {c}" for c in std["key_checks"])
        )

    user_text = (
        f"Analyze this construction material photograph.\n"
        f"Material Type: {material_type}\n"
        f"Expected Specification: {expected_spec or 'Not specified — identify from image'}\n"
        f"{standards_info}\n\n"
        f"Perform a complete visual quality inspection and return the structured analysis."
    )

    # Rate-limit before making the request
    await _gemini_limiter.acquire()

    model_name = settings.gemini_model
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={api_key}"
    )

    payload = {
        "systemInstruction": {"parts": [{"text": MATERIAL_ANALYSIS_PROMPT}]},
        "contents": [{
            "parts": [
                {"text": user_text},
                {"inlineData": {"mimeType": mime_type, "data": compressed_b64}},
            ],
        }],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 4096},
    }

    last_exc = None
    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json=payload,
                )

                if response.status_code == 429:
                    delay = 5.0 * (2 ** (attempt - 1)) + random.uniform(0.5, 2.0)
                    logger.warning("Material analysis 429 (attempt %d/3), waiting %.1fs", attempt, delay)
                    if attempt < 3:
                        await asyncio.sleep(min(delay, 30.0))
                        continue
                    break

                response.raise_for_status()
                data = response.json()

            candidates = data.get("candidates", [])
            if not candidates:
                block_reason = data.get("promptFeedback", {}).get("blockReason", "")
                return {
                    "verdict": "REVIEW",
                    "confidence": 0.0,
                    "material_detected": "Unknown",
                    "issues": [{
                        "type": "Content Filtered",
                        "severity": "Minor",
                        "description": f"Image was filtered by the AI service (reason: {block_reason or 'unknown'}).",
                        "standard_reference": "N/A",
                    }],
                    "recommendations": ["Try uploading a clearer photo of the material."],
                    "summary": "Analysis could not be completed — content was filtered.",
                }

            response_text = candidates[0]["content"]["parts"][0]["text"]
            cleaned = _strip_markdown_fences(response_text)

            try:
                result = json.loads(cleaned)
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, ValueError):
                pass

            # Try to extract JSON from the response
            first_brace = cleaned.find("{")
            last_brace = cleaned.rfind("}")
            if first_brace != -1 and last_brace > first_brace:
                try:
                    result = json.loads(cleaned[first_brace:last_brace + 1])
                    if isinstance(result, dict):
                        return result
                except (json.JSONDecodeError, ValueError):
                    pass

            # Return raw text as summary if JSON parsing fails
            return {
                "verdict": "REVIEW",
                "confidence": 0.5,
                "material_detected": material_type,
                "issues": [],
                "recommendations": ["AI returned unstructured response. Review manually."],
                "summary": response_text[:500],
            }

        except httpx.HTTPStatusError as exc:
            last_exc = exc
            logger.warning("Material analysis HTTP error (attempt %d/3): %s", attempt, exc)
            if attempt < 3:
                await asyncio.sleep(2.0 * (2 ** (attempt - 1)) + random.uniform(0, 1))
        except Exception as exc:
            last_exc = exc
            logger.warning("Material analysis error (attempt %d/3): %s", attempt, exc)
            if attempt < 3:
                await asyncio.sleep(2.0 * (2 ** (attempt - 1)) + random.uniform(0, 1))

    return {
        "verdict": "FAIL",
        "confidence": 0.0,
        "material_detected": "Unknown",
        "issues": [{
            "type": "Analysis Error",
            "severity": "Major",
            "description": f"Material analysis failed after 3 attempts: {str(last_exc)[:200]}",
            "standard_reference": "N/A",
        }],
        "recommendations": ["Check API configuration and try again."],
        "summary": f"Analysis failed: {str(last_exc)[:100]}",
    }
