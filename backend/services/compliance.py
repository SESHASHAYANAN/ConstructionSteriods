"""Predictive Code Compliance — AI-powered pre-construction violation detection.

Uses Groq LLM to analyze draft engineering documents, specifications, and
drawings text to predict potential building code violations BEFORE drawings
are finalized. This extends the existing QA system with proactive compliance.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from services.agents import _groq_chat_completion_async, _strip_markdown_fences

logger = logging.getLogger(__name__)


# ── Building Code Reference ─────────────────────────────────────────────────

BUILDING_CODES_DB = {
    "IBC": {
        "name": "International Building Code",
        "editions": ["IBC 2021", "IBC 2018", "IBC 2015"],
        "key_areas": ["Structural", "Fire Safety", "Egress", "Accessibility", "Seismic"],
    },
    "ACI 318": {
        "name": "Building Code Requirements for Structural Concrete",
        "editions": ["ACI 318-19", "ACI 318-14"],
        "key_areas": ["Concrete Design", "Reinforcement", "Durability", "Seismic Detailing"],
    },
    "AISC 360": {
        "name": "Specification for Structural Steel Buildings",
        "editions": ["AISC 360-22", "AISC 360-16"],
        "key_areas": ["Steel Design", "Connections", "Stability", "Seismic"],
    },
    "ASCE 7": {
        "name": "Minimum Design Loads and Associated Criteria",
        "editions": ["ASCE 7-22", "ASCE 7-16"],
        "key_areas": ["Dead Loads", "Live Loads", "Wind", "Seismic", "Snow", "Rain"],
    },
    "Eurocode": {
        "name": "European Standards for Structural Design",
        "editions": ["EN 1990-1994", "EN 1995-1999"],
        "key_areas": ["Basis of Design", "Actions", "Concrete", "Steel", "Timber", "Masonry"],
    },
    "BS EN": {
        "name": "British/European Standards",
        "editions": ["BS EN 1992", "BS EN 1993", "BS EN 1996"],
        "key_areas": ["Concrete", "Steel", "Masonry", "Geotechnical"],
    },
    "IS (Indian)": {
        "name": "Indian Standard Codes",
        "editions": ["IS 456:2000", "IS 800:2007", "IS 1893:2016"],
        "key_areas": ["Concrete", "Steel", "Seismic", "Foundation"],
    },
    "NFPA": {
        "name": "National Fire Protection Association",
        "editions": ["NFPA 101", "NFPA 13", "NFPA 72"],
        "key_areas": ["Life Safety", "Sprinklers", "Fire Alarm", "Egress"],
    },
    "ADA/ADAAG": {
        "name": "Americans with Disabilities Act Accessibility Guidelines",
        "editions": ["2010 ADA Standards"],
        "key_areas": ["Accessibility", "Ramps", "Doorways", "Restrooms", "Signage"],
    },
    "ASHRAE": {
        "name": "American Society of Heating, Refrigerating, and Air-Conditioning Engineers",
        "editions": ["ASHRAE 90.1-2019", "ASHRAE 62.1-2019"],
        "key_areas": ["Energy Efficiency", "Ventilation", "HVAC Design"],
    },
}


# ── Predictive Compliance Prompt ─────────────────────────────────────────────

PREDICTIVE_COMPLIANCE_PROMPT = """You are a Principal Code Compliance Officer and Building Code Expert with 30+ years of experience across all major international building codes. You are performing a PREDICTIVE compliance review of DRAFT engineering documents — the goal is to catch violations BEFORE drawings are finalized.

This is a PROACTIVE, PREDICTIVE review. You must:
1. Identify POTENTIAL violations that could arise from the content as written
2. Flag areas where the design APPROACHES code limits (early warnings)
3. Highlight MISSING information that will likely cause code compliance issues later
4. Predict COORDINATION conflicts that could lead to non-compliance

### REVIEW CATEGORIES:

#### A. STRUCTURAL CODE COMPLIANCE
- Concrete member sizing vs minimum code requirements (ACI 318, Eurocode 2)
- Reinforcement ratios, cover, spacing, and development lengths
- Seismic detailing requirements for the applicable SDC
- Foundation bearing capacity and settlement considerations
- Steel connection design and capacity verification
- Load path continuity and lateral force resistance

#### B. FIRE & LIFE SAFETY
- Fire-resistance ratings for structural elements and assemblies
- Egress path dimensions, distances, and dead-end corridors
- Fire separation requirements between occupancy types
- Sprinkler/fire alarm coverage gaps
- Smoke control and compartmentation

#### C. ACCESSIBILITY
- Ramp slopes, landing sizes, and handrail requirements
- Door widths, maneuvering clearances, and threshold heights
- Accessible route continuity
- Restroom accessibility requirements

#### D. MEP COORDINATION
- Penetrations through fire-rated assemblies
- Mechanical equipment clearance and access requirements
- Electrical panel accessibility and working space
- Plumbing fixture count requirements

#### E. ENERGY CODE
- Envelope insulation minimum values
- Fenestration area limits and U-value requirements
- HVAC efficiency requirements
- Lighting power density limits

#### F. EARLY WARNING INDICATORS
- Dimensions that are at or near code minimums (may fail with tolerances)
- Design assumptions that may not hold as the project progresses
- Missing coordination notes that will likely cause RFIs
- Specification references to outdated or superseded standards

Return your analysis as a JSON object with these exact fields:
{
  "risk_score": 0-100,
  "risk_level": "Low" | "Medium" | "High" | "Critical",
  "violations": [
    {
      "code": "string — e.g. ACI 318-19 §25.4.2.1",
      "category": "Structural" | "Fire Safety" | "Accessibility" | "MEP" | "Energy" | "General",
      "severity": "Critical" | "Major" | "Minor",
      "type": "Violation" | "Warning" | "Prediction",
      "description": "string — detailed description of the potential violation",
      "location": "string — where in the document this applies",
      "recommendation": "string — specific corrective action"
    }
  ],
  "warnings": [
    {
      "code": "string",
      "description": "string — early warning about a potential future issue",
      "risk_probability": "High" | "Medium" | "Low"
    }
  ],
  "missing_information": [
    {
      "item": "string — what information is missing",
      "impact": "string — why it matters for compliance",
      "urgency": "High" | "Medium" | "Low"
    }
  ],
  "recommendations": [
    {
      "priority": "Immediate" | "Before Finalization" | "During Construction",
      "action": "string — specific recommended action",
      "code_reference": "string — supporting code clause"
    }
  ],
  "applicable_codes": ["list of all codes referenced in the analysis"],
  "summary": "string — 3-5 sentence executive summary of compliance status"
}

Return ONLY the JSON object. Be predictive — think about what WILL go wrong, not just what IS wrong now. Every finding must have a specific code clause reference."""


# ── Analysis Function ────────────────────────────────────────────────────────

async def predict_compliance(
    text: str,
    building_codes: list[str] | None = None,
    discipline: str = "General",
    project_name: str = "",
) -> dict[str, Any]:
    """Run predictive code compliance analysis on draft content.

    Args:
        text: Draft document text / specification content to analyze
        building_codes: List of applicable building codes (e.g., ["IBC", "ACI 318"])
        discipline: Engineering discipline (Structural, MEP, Architectural, Civil)
        project_name: Optional project name for context

    Returns:
        Structured compliance analysis dict
    """
    if not text or len(text.strip()) < 20:
        return {
            "risk_score": 0,
            "risk_level": "Low",
            "violations": [],
            "warnings": [],
            "missing_information": [{
                "item": "Document content",
                "impact": "No content was provided for compliance review.",
                "urgency": "High",
            }],
            "recommendations": [],
            "applicable_codes": [],
            "summary": "No document content was provided for analysis.",
        }

    # Build codes context
    codes_context = ""
    if building_codes:
        codes_context = "\n\nApplicable Building Codes:\n"
        for code_key in building_codes:
            if code_key in BUILDING_CODES_DB:
                info = BUILDING_CODES_DB[code_key]
                codes_context += (
                    f"- {code_key}: {info['name']} "
                    f"(Editions: {', '.join(info['editions'])}; "
                    f"Key Areas: {', '.join(info['key_areas'])})\n"
                )
            else:
                codes_context += f"- {code_key}\n"
    else:
        codes_context = "\n\nNote: No specific building codes were specified. Apply IBC 2021, ACI 318-19, and ASCE 7-22 as defaults.\n"

    user_msg = (
        f"Project: {project_name or 'Draft Engineering Document'}\n"
        f"Discipline: {discipline}\n"
        f"{codes_context}\n\n"
        f"--- DRAFT DOCUMENT CONTENT ---\n{text[:15000]}\n\n"
        f"Perform a predictive code compliance analysis. Focus on catching potential "
        f"violations BEFORE the drawings are finalized. Flag early warnings and "
        f"missing information that could cause compliance issues."
    )

    messages = [
        {"role": "system", "content": PREDICTIVE_COMPLIANCE_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    try:
        response_text = await _groq_chat_completion_async(
            messages, temperature=0.1, max_tokens=8192
        )

        cleaned = _strip_markdown_fences(response_text.strip())

        # Try direct JSON parse
        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

        # Try brace extraction
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            try:
                result = json.loads(cleaned[first_brace:last_brace + 1])
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, ValueError):
                pass

        # Fallback
        return {
            "risk_score": 50,
            "risk_level": "Medium",
            "violations": [],
            "warnings": [],
            "missing_information": [],
            "recommendations": [],
            "applicable_codes": building_codes or [],
            "summary": response_text[:500],
            "raw_analysis": response_text,
        }

    except Exception as exc:
        logger.error("Compliance analysis failed: %s", exc)
        return {
            "risk_score": 0,
            "risk_level": "Low",
            "violations": [],
            "warnings": [],
            "missing_information": [],
            "recommendations": [],
            "applicable_codes": building_codes or [],
            "summary": f"Analysis failed: {str(exc)[:200]}",
            "error": str(exc)[:200],
        }
