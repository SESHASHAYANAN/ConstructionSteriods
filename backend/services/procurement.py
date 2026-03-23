"""Smart Procurement — AI-powered pricing engine for construction materials.

Uses Groq LLM to analyze material requirements and generate supplier
recommendations, cost comparisons, and procurement optimization strategies.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from services.agents import _groq_chat_completion_async, _strip_markdown_fences

logger = logging.getLogger(__name__)

# ── Procurement Analysis Prompt ──────────────────────────────────────────────

PROCUREMENT_PROMPT = """You are a Senior Construction Procurement Engineer and Quantity Surveyor with 25+ years of experience in construction supply chain management, vendor evaluation, and cost optimization.

You will receive a list of construction material/equipment items with quantities and specifications. Analyze the procurement requirements and provide comprehensive recommendations.

### YOUR ANALYSIS TASKS:

#### A. SUPPLIER RECOMMENDATIONS
For each material category, recommend 3-5 suppliers with:
- Supplier name (use realistic, well-known construction material suppliers)
- Estimated unit price range (provide realistic market rates)
- Lead time estimate
- Quality rating (1-5 stars)
- Advantages and disadvantages
- Minimum order quantities

#### B. COST ANALYSIS
- Calculate estimated total costs per item at different price points (budget, mid-range, premium)
- Identify the highest-cost items that offer the most savings potential
- Compare package/bulk pricing vs individual ordering
- Factor in delivery costs and logistics for the specified region

#### C. SAVINGS OPPORTUNITIES
- Bulk purchase discounts (volume tiers)
- Seasonal pricing strategies (when to buy for best rates)
- Alternative material/brand suggestions that maintain quality while reducing cost
- Framework agreement / annual rate contract opportunities
- Just-in-time vs advance procurement trade-offs

#### D. RISK ASSESSMENT
- Supply chain reliability for each major item
- Price volatility assessment
- Quality risk with budget alternatives
- Lead time risks and mitigation strategies

Return your analysis as a JSON object with these exact fields:
{
  "suppliers": [
    {
      "category": "string — material category",
      "recommendations": [
        {
          "name": "string — supplier name",
          "price_range": "string — e.g. $45-52/bag",
          "lead_time": "string — e.g. 3-5 business days",
          "quality_rating": 4.5,
          "moq": "string — minimum order quantity",
          "advantages": ["list of advantages"],
          "disadvantages": ["list of disadvantages"]
        }
      ]
    }
  ],
  "cost_analysis": {
    "items": [
      {
        "name": "string",
        "quantity": "string",
        "unit": "string",
        "budget_price": "string",
        "mid_price": "string",
        "premium_price": "string",
        "budget_total": "string",
        "mid_total": "string",
        "premium_total": "string"
      }
    ],
    "total_budget": "string",
    "total_mid": "string",
    "total_premium": "string",
    "currency": "string"
  },
  "savings_opportunities": [
    {
      "strategy": "string — savings strategy name",
      "potential_savings": "string — e.g. 8-12%",
      "description": "string — detailed description",
      "effort_level": "Low" | "Medium" | "High",
      "timeline": "string — when savings kick in"
    }
  ],
  "risk_assessment": [
    {
      "item": "string",
      "risk_type": "string — Supply | Price | Quality | Lead Time",
      "risk_level": "Low" | "Medium" | "High",
      "description": "string",
      "mitigation": "string"
    }
  ],
  "executive_summary": "string — 3-5 sentence summary of the overall procurement strategy",
  "total_estimated_budget": "string — overall budget estimate",
  "recommended_approach": "string — one paragraph on the recommended procurement approach"
}

Return ONLY the JSON object. Use realistic, current market prices. Be specific and actionable."""


# ── Analysis Function ────────────────────────────────────────────────────────

async def analyze_procurement(
    items: list[dict[str, str]],
    project_name: str = "",
    region: str = "General",
    budget_preference: str = "Mid-Range",
) -> dict[str, Any]:
    """Analyze procurement requirements using Groq LLM.

    Args:
        items: List of material items, each with name, quantity, unit, spec
        project_name: Optional project name for context
        region: Geographic region for pricing context
        budget_preference: Budget tier preference

    Returns:
        Structured procurement analysis dict
    """
    if not items:
        return {
            "executive_summary": "No items provided for analysis.",
            "suppliers": [],
            "cost_analysis": {"items": [], "total_budget": "$0", "total_mid": "$0", "total_premium": "$0"},
            "savings_opportunities": [],
            "risk_assessment": [],
        }

    # Build the items description
    items_text = "## Material Requirements:\n\n"
    for i, item in enumerate(items, 1):
        items_text += (
            f"{i}. **{item.get('name', 'Unknown')}**\n"
            f"   - Quantity: {item.get('quantity', 'N/A')} {item.get('unit', '')}\n"
            f"   - Specification: {item.get('spec', 'Standard')}\n\n"
        )

    user_msg = (
        f"Project: {project_name or 'Construction Project'}\n"
        f"Region/Market: {region}\n"
        f"Budget Preference: {budget_preference}\n\n"
        f"{items_text}\n"
        f"Provide a comprehensive procurement analysis with supplier recommendations, "
        f"cost comparisons, savings opportunities, and risk assessment for the above materials."
    )

    messages = [
        {"role": "system", "content": PROCUREMENT_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    try:
        response_text = await _groq_chat_completion_async(
            messages, temperature=0.2, max_tokens=8192
        )

        cleaned = _strip_markdown_fences(response_text.strip())

        # Try direct JSON parse
        try:
            result = json.loads(cleaned)
            if isinstance(result, dict):
                return result
        except (json.JSONDecodeError, ValueError):
            pass

        # Try extracting JSON from braces
        first_brace = cleaned.find("{")
        last_brace = cleaned.rfind("}")
        if first_brace != -1 and last_brace > first_brace:
            try:
                result = json.loads(cleaned[first_brace:last_brace + 1])
                if isinstance(result, dict):
                    return result
            except (json.JSONDecodeError, ValueError):
                pass

        # Return basic structure with raw text
        return {
            "executive_summary": response_text[:500],
            "suppliers": [],
            "cost_analysis": {"items": [], "total_budget": "N/A", "total_mid": "N/A", "total_premium": "N/A"},
            "savings_opportunities": [],
            "risk_assessment": [],
            "raw_analysis": response_text,
        }

    except Exception as exc:
        logger.error("Procurement analysis failed: %s", exc)
        return {
            "executive_summary": f"Analysis failed: {str(exc)[:200]}",
            "suppliers": [],
            "cost_analysis": {"items": [], "total_budget": "Error", "total_mid": "Error", "total_premium": "Error"},
            "savings_opportunities": [],
            "risk_assessment": [],
            "error": str(exc)[:200],
        }
