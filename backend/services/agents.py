"""AI Agent system: Multi-agent pipeline for AEC document review.

Agent 1 (Speed): Groq LLaMA 3 70B for fast checklist screening.
Agent 2 (Reasoning): Groq LLaMA 3.3 70B Versatile for deep code compliance review.
Vision Agent: Google Gemini Vision API for engineering drawing image analysis.
Summary Agent: Groq LLaMA 3.3 70B Versatile for executive summary generation.
Async-first design: all agents run concurrently where possible for faster review times.

Key improvements:
- Every agent phase is individually isolated; one failure doesn't crash the pipeline
- Image-only chunks (engineering drawings) are smartly routed to vision agent only
- Robust retry with exponential backoff + jitter
- Spec generator works even with 0 uploaded documents
"""

from __future__ import annotations

import asyncio
import base64
import difflib
import io
import json
import logging
import random
import time
from pathlib import Path
from typing import Any

import httpx

from config import settings

logger = logging.getLogger(__name__)

# ── Gemini Rate Limiter ──────────────────────────────────────────────────────

class GeminiRateLimiter:
    """Simple rate limiter for Gemini API — enforces minimum interval between requests."""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._lock = asyncio.Semaphore(1)
            cls._instance._last_call = 0.0
        return cls._instance

    async def acquire(self):
        """Wait until it's safe to make another Gemini API call."""
        async with self._lock:
            now = time.time()
            # Enforce minimum 8 seconds between requests (~7.5 RPM, well under any free tier limit)
            min_gap = 8.0
            elapsed = now - self._last_call
            if elapsed < min_gap:
                wait = min_gap - elapsed + random.uniform(0.2, 1.0)
                logger.info("Gemini rate limiter: waiting %.1fs before next request", wait)
                await asyncio.sleep(wait)
            self._last_call = time.time()


_gemini_limiter = GeminiRateLimiter()


# ── Agent Memory (agentic workflow context) ──────────────────────────────────

class AgentMemory:
    """Shared memory across agent phases for multi-step reasoning."""
    def __init__(self):
        self.ocr_texts: dict[str, str] = {}      # page_key -> extracted text
        self.structural_elements: list[str] = []  # detected structural elements
        self.measurements: list[str] = []          # extracted measurements
        self.plan_notes: list[str] = []            # planning observations
        self.phase_findings: dict[str, list] = {}  # agent_name -> findings

    def add_ocr_result(self, page_key: str, text: str):
        self.ocr_texts[page_key] = text

    def add_findings(self, agent: str, findings: list):
        self.phase_findings[agent] = findings

    def get_context_summary(self) -> str:
        parts = []
        if self.structural_elements:
            parts.append(f"Detected structural elements: {', '.join(self.structural_elements[:20])}")
        if self.measurements:
            parts.append(f"Extracted measurements: {', '.join(self.measurements[:20])}")
        if self.plan_notes:
            parts.append(f"Planning notes: {'; '.join(self.plan_notes[:10])}")
        return "\n".join(parts) if parts else "No prior context available."


OCR_SYSTEM_PROMPT = """You are an expert OCR engine specialized in reading engineering and construction drawings. Your task is to extract ALL readable text from this drawing image with perfect accuracy.

Extract and return:
1. **Title Block**: Project name, drawing number, revision, date, scale, firm name, all signatures
2. **Dimensions**: Every measurement, dimension line value, level marker, offset, and spacing annotation
3. **Labels & Tags**: All element tags (beam B1, column C3, etc.), equipment IDs, room names/numbers
4. **Notes**: General notes, construction notes, material specifications written on the drawing
5. **Grid References**: All grid line labels (A, B, C... and 1, 2, 3...)
6. **Schedules**: Any tabular data (door schedules, window schedules, finish schedules, rebar schedules)
7. **Symbols & Legends**: Section cut references, detail callout numbers, north arrow orientation
8. **Annotations**: Revision clouds text, leader text, callout text
9. **Structural Details**: Reinforcement callouts (e.g., "4T20", "T12@200"), concrete grades, steel grades
10. **MEP Details**: Pipe sizes, duct dimensions, electrical ratings, equipment specs

Return the extracted text in a structured format:
```json
{
  "title_block": { "project": "", "drawing_no": "", "revision": "", "date": "", "scale": "" },
  "dimensions": ["list of all dimensions found"],
  "labels": ["list of all element tags and labels"],
  "notes": ["list of all notes text"],
  "grid_refs": ["list of grid references"],
  "schedules": ["tabular data as text"],
  "structural_elements": ["beams, columns, slabs detected with their IDs"],
  "measurements": ["specific measurements with units"],
  "full_text": "Complete concatenated text from the drawing in reading order"
}
```

Be exhaustive. Extract EVERY piece of text visible on the drawing, no matter how small."""

# ── Prompt Templates ─────────────────────────────────────────────────────────

GROQ_SYSTEM_PROMPT = """You are a Principal QA/QC Engineer with 25+ years of experience in AEC (Architecture, Engineering, and Construction) design review. You are performing a rapid, systematic checklist review of engineering drawings for a construction design project.

For every drawing page provided, perform the following comprehensive checks:

### STRUCTURAL REVIEW
- Missing or incomplete title block (project name, drawing number, revision, date, scale, designer, checker, approver)
- Missing or incorrect drawing scales, scale bars, or north arrows
- Missing structural dimensions, level markers, grid references, or section callouts
- Untagged structural elements (beams, columns, slabs, foundations, shear walls)
- Missing reinforcement details, bar bending schedules, or rebar callouts
- Incomplete or missing structural notes and general arrangement references
- Missing connection details or references to standard detail sheets
- Unreferenced detail bubbles or section cuts

### MEP REVIEW
- Untagged mechanical, electrical, or plumbing equipment
- Missing equipment schedules or cross-references to specification sections
- Missing duct/pipe sizes, routing, or elevation callouts
- Incomplete electrical panel schedules or single-line diagrams
- Missing fire protection device coverage or spacing violations

### GENERAL DRAWING QA
- Missing revision clouds on updated sheets or unlogged revisions in the revision table
- Incomplete schedules (door, window, finish, equipment, valve)
- Drawing/detail references that point to non-existent sheets
- Text overlaps, illegible annotations, or broken leaders/callouts
- Missing legend or abbreviation list for symbols used
- Inconsistent layer naming or line weight violations
- Missing coordination notes between disciplines

Return findings ONLY as a JSON array. Each finding MUST have these exact fields:
- "drawing_ref" (string): The drawing number and sheet reference
- "location" (string): Specific zone, grid intersection, or area on the drawing
- "issue_type" (string): Classification (e.g. "Missing Title Block Info", "Untagged Equipment", "Unreferenced Detail")
- "severity" ("Critical" | "Major" | "Minor")
- "description" (string): Detailed description of the deficiency found
- "suggested_fix" (string): Specific corrective action required

SEVERITY GUIDELINES:
- Critical: Missing structural dimensions, untagged load-bearing elements, potential safety issues
- Major: Missing schedules, unreferenced details, incomplete title blocks
- Minor: Text overlaps, minor annotation gaps, formatting inconsistencies

Do not add any explanation outside the JSON array. Apply all checklist rules provided below the document content."""

OPENAI_SYSTEM_PROMPT = """You are a Principal Construction Engineering Consultant and Code Compliance Expert with 30+ years of experience across structural, civil, MEP, and architectural disciplines. You are performing a detailed code compliance, coordination, and constructability review.

You will receive:
1. Engineering drawing content (text extracted from drawings)
2. Relevant code clauses and standards
3. Preliminary findings from the fast-check QA agent

### YOUR DETAILED REVIEW TASKS:

#### A. CODE COMPLIANCE ANALYSIS
- Verify every structural element against applicable building codes (ACI 318, AISC 360, IBC, Eurocode, BS EN, etc.)
- Check concrete cover requirements, minimum reinforcement ratios, and development lengths
- Verify fire-resistance ratings match code requirements for occupancy classification
- Check structural member sizing against load requirements implied by the drawings
- Verify seismic detailing requirements for the applicable Seismic Design Category
- Check accessibility compliance (ADA, DDA) for architectural elements
- Verify egress requirements (corridor widths, exit distances, stairway dimensions)

#### B. CROSS-DISCIPLINE COORDINATION
- Check MEP penetrations through structural elements (beams, slabs, shear walls) for conflicts
- Verify ceiling void height adequacy for duct/pipe routing
- Check electrical conduit routing conflicts with post-tension cables or reinforcement
- Verify that equipment pads and openings are shown on structural drawings
- Check drainage slope coordination between architectural, structural, and MEP
- Verify fire-rated wall/floor penetration seal requirements

#### C. CONSTRUCTABILITY & DETAILING
- Flag impractical reinforcement congestion at beam-column joints
- Identify areas where construction sequence is unclear or impossible
- Check for adequate working space around MEP equipment for maintenance access
- Verify that specified materials and sections are commercially available
- Flag tolerance and fit-up issues at connection details

#### D. SPECIFICATION REVIEW
- Check for internal contradictions between specification clauses
- Identify outdated standard references (superseded codes or withdrawn standards)
- Verify mandatory clauses are included (submittals, testing, QC requirements)
- Check for ambiguous language that could lead to disputes

#### E. REVIEW OF PREVIOUS FINDINGS
- Expand, correct, or confirm findings from the first-pass agent with added code references
- Upgrade severity of any first-pass finding if code compliance is actually at stake
- Add any findings the first agent missed

Return findings ONLY as a JSON array with these exact fields:
- "drawing_ref" (string)
- "location" (string)
- "issue_type" (string)
- "severity" ("Critical" | "Major" | "Minor")
- "description" (string): Detailed technical description
- "suggested_fix" (string): Specific corrective action with code reference
- "code_clause" (string): Exact standard, clause number, and edition (e.g. "ACI 318-19 §18.6.3.1", "IBC 2021 §1607.1")

EVERY finding MUST include a specific code_clause citation. If no specific code applies, cite the relevant general engineering standard of care or best practice reference."""

VISION_SYSTEM_PROMPT = """You are an expert AEC (Architecture, Engineering, Construction) drawing reviewer with advanced visual analysis capabilities. You are analyzing an engineering drawing image in detail.

Perform a thorough visual inspection and identify ALL of the following:

### VISUAL ELEMENTS TO CHECK:
1. **Title Block Completeness**: Project name, drawing number, revision, date, scale, signatures
2. **Dimensions & Annotations**: Missing dimensions, unreadable text, broken leaders, overlapping annotations
3. **Structural Elements**: Beams, columns, slabs — verify they are tagged, dimensioned, and referenced
4. **MEP Elements**: Equipment tags, pipe/duct sizes, routing clarity
5. **Symbols & Legend**: Missing legend entries, undefined symbols, inconsistent symbol usage
6. **Revision Tracking**: Revision clouds present for updated areas, revision history in title block
7. **Section Cuts & Details**: All section/detail callouts point to valid drawing references
8. **Scale & Orientation**: Scale bar present, north arrow (for plans), level markers
9. **Drawing Quality**: Line weight consistency, layer organization, hatching clarity
10. **Coordination Marks**: Cross-reference marks to other discipline drawings

### FOR STRUCTURAL DRAWINGS SPECIFICALLY:
- Reinforcement callouts on every structural member
- Grid lines labeled and consistent
- Foundation details and bearing capacity notes
- Connection details referenced and complete
- Bar bending schedule references

### FOR MEP DRAWINGS SPECIFICALLY:
- Equipment schedule cross-references
- Pipe/duct sizing on every run
- Control valve locations and types
- Electrical panel schedule references
- Fire protection device spacing

IMPORTANT: Return your findings ONLY as a JSON array. Do NOT include an "extracted_text" field or any wrapper object. Return ONLY the array.

Each finding in the array must have these exact fields:
- "drawing_ref" (string): Sheet/drawing reference visible on the drawing
- "location" (string): Specific area of the drawing (grid ref, zone, quadrant)
- "issue_type" (string): Classification of the issue found
- "severity" ("Critical" | "Major" | "Minor")
- "description" (string): What you visually observe is wrong or missing
- "suggested_fix" (string): Corrective action needed

Be highly specific about locations. Reference grid lines, zones, or quadrants visible on the drawing.

Example response (return ONLY the array, no wrapper):
```json
[{"drawing_ref": "S-201", "location": "Grid B-3", "issue_type": "Missing Dimension", "severity": "Major", "description": "Beam B1 at grid B-3 is missing depth dimension", "suggested_fix": "Add beam depth dimension to section callout"}]
```"""

SPEC_GENERATOR_PROMPT = """You are a senior construction specification writer with 25+ years of expertise in CSI MasterFormat (2018 edition) and NBS standards. You are generating a REAL, PROJECT-SPECIFIC specification document.

CRITICAL RULES:
1. You MUST use the actual project data, building codes, and document content provided below.
2. Do NOT produce generic boilerplate. Every section must reference the specific project name, applicable codes, and data from the uploaded documents.
3. If project document content is provided, extract specific materials, equipment, dimensions, and requirements from it and incorporate them into the specification.
4. If no document content is available, state assumptions clearly and tailor the spec to the discipline and building codes provided.

Generate a comprehensive, production-ready specification document following CSI Division structure:

### PART 1 – GENERAL
- 1.01 Summary (scope of work specific to this project)
- 1.02 References (list ALL applicable standards with edition years — ASTM, ACI, AISC, ASHRAE, NFPA, IEEE, etc.)
- 1.03 Definitions and Abbreviations
- 1.04 Submittals (shop drawings, product data, test reports, certificates — with specific quantities and review periods)
- 1.05 Quality Assurance (installer qualifications, testing lab requirements, mock-up requirements)
- 1.06 Delivery, Storage, and Handling (specific requirements for the materials in this discipline)
- 1.07 Project Conditions (site conditions, environmental limitations, sequencing constraints)
- 1.08 Warranty (specific terms, durations, coverage)

### PART 2 – PRODUCTS
- 2.01 Materials (specific grades, classes, types with standard references)
- 2.02 Manufacturers (acceptable manufacturers list with "or approved equal" clause)
- 2.03 Fabrication (tolerances, shop assembly requirements)
- 2.04 Finishes (specific coating systems, surface preparation)
- 2.05 Source Quality Control (factory testing, inspection, certification)

### PART 3 – EXECUTION
- 3.01 Examination (verification of conditions before installation)
- 3.02 Preparation (surface prep, layout, protection of adjacent work)
- 3.03 Installation/Application (step-by-step procedures, tolerances, workmanship standards)
- 3.04 Field Quality Control (testing types, frequencies, acceptance criteria with pass/fail thresholds)
- 3.05 Cleaning (interim and final cleaning procedures)
- 3.06 Protection (protection of installed work during remaining construction)
- 3.07 Schedules (if applicable — fixture schedules, finish schedules)

Output in clean professional Markdown format with proper heading hierarchy. Each section MUST contain real, actionable content — not placeholder text."""

WORD_REVIEW_PROMPT = """You are a senior construction engineering consultant reviewing a specification document.
Perform a detailed review for:
- Internal contradictions between specification clauses
- Outdated or superseded standard references (check edition years)
- Missing mandatory clauses (submittals, QC, testing, warranties)
- Inconsistent terminology or conflicting requirements
- Ambiguous language that could lead to contractual disputes
- Missing coordination requirements with other specification sections
- Non-compliant clauses against current building codes

Return findings ONLY as a JSON array with fields:
drawing_ref, location, issue_type, severity, description, suggested_fix, code_clause."""

EXCEL_REVIEW_PROMPT = """You are a senior construction engineer and quantity surveyor validating schedule/quantity data.
Perform a detailed validation for:
- Mismatched equipment tags between schedules and drawing references
- Quantity calculation errors, unit rate inconsistencies
- Missing line items that should be present for the given scope
- Inconsistent units of measurement across related items
- Cross-reference errors between BOQ items and specification sections
- Missing testing and inspection allowances
- Incorrect totals or formula-driven errors visible in the data

Return findings ONLY as a JSON array with fields:
drawing_ref, location, issue_type, severity, description, suggested_fix, code_clause."""

ITP_GENERATOR_PROMPT = """You are a senior QA/QC engineer with 20+ years of experience generating Inspection and Test Plans (ITPs).

CRITICAL RULES:
1. Generate ITP rows SPECIFIC to the project data and discipline provided.
2. If project document content is provided, extract actual activities, materials, and test requirements from it.
3. Reference the SPECIFIC building codes and standards applicable to this project.
4. Do NOT produce generic rows — each row must be tailored to the project scope.

Generate ITP rows following ISO 19650 / ISO 10005 structure.
Each row must have these columns:
- item_no (string): Sequential numbering (1.0, 1.1, 2.0, etc.)
- activity (string): Specific inspection/test activity
- inspection_type (string): "Hold Point" | "Witness Point" | "Review Record"
- acceptance_criteria (string): Measurable pass/fail criteria with tolerances
- reference_standard (string): Exact standard clause (e.g., "ACI 318-19 §26.5.2.1")
- hold_point (boolean): true if work must stop for inspection
- remarks (string): Additional notes, testing frequency, or coordination needs

Include all critical inspection stages from material receipt through final handover.
Cover: material verification, shop drawing review, installation milestones, in-process testing, final testing, commissioning, handover documentation.
Return as a JSON array of row objects."""

SUMMARY_SYSTEM_PROMPT = """You are a Principal QA/QC Manager preparing an executive summary of all findings from a multi-agent engineering document review.

You will receive a JSON array of all deduplicated findings from the review.

Produce a JSON object with these exact fields:
- "executive_summary" (string): A 3-5 sentence executive summary of the overall document quality, key risk areas, and recommended priority actions.
- "total_findings" (integer): Total number of findings
- "critical_count" (integer): Number of Critical findings
- "major_count" (integer): Number of Major findings
- "minor_count" (integer): Number of Minor findings
- "top_risk_areas" (array of strings): Top 3-5 risk categories by severity and frequency
- "overall_confidence" (float 0.0-1.0): Your confidence that the review was thorough and accurate
- "confidence_reasoning" (string): Brief justification for the confidence score

Return ONLY the JSON object, no additional text."""


# ── Groq LLM Helpers ────────────────────────────────────────────────────────

MAX_RETRIES = 3
BASE_DELAY = 2.0  # seconds


def _get_groq_llm(model: str = "llama-3.3-70b-versatile", temperature: float = 0.1, max_tokens: int = 4096):
    """Create a Groq LLM instance."""
    from langchain_groq import ChatGroq
    return ChatGroq(
        model=model,
        api_key=settings.groq_api_key,
        temperature=temperature,
        max_tokens=max_tokens,
    )


def _groq_chat_completion(
    messages: list[dict],
    temperature: float = 0.1,
    max_tokens: int = 4096,
    model: str = "llama-3.3-70b-versatile",
) -> str:
    """Call Groq chat completions (sync) with retry + exponential backoff."""
    llm = _get_groq_llm(model=model, temperature=temperature, max_tokens=max_tokens)
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = llm.invoke(messages)
            content = response.content
            if content and len(content.strip()) > 10:
                return content
            logger.warning("Groq returned empty/short response (attempt %d/%d, len=%d)",
                           attempt, MAX_RETRIES, len(content or ""))
        except Exception as exc:
            last_exc = exc
            logger.warning("Groq API error (attempt %d/%d): %s", attempt, MAX_RETRIES, exc)
        if attempt < MAX_RETRIES:
            delay = BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(0, 1)
            logger.info("Retrying in %.1fs...", delay)
            time.sleep(delay)
    raise RuntimeError(
        f"Groq API failed after {MAX_RETRIES} attempts. "
        f"Last error: {last_exc or 'Empty response from AI model'}"
    )


async def _groq_chat_completion_async(
    messages: list[dict],
    temperature: float = 0.1,
    max_tokens: int = 4096,
    model: str = "llama-3.3-70b-versatile",
) -> str:
    """Call Groq chat completions (async) with retry + exponential backoff."""
    llm = _get_groq_llm(model=model, temperature=temperature, max_tokens=max_tokens)
    last_exc = None
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = await asyncio.to_thread(llm.invoke, messages)
            content = response.content
            if content and len(content.strip()) > 10:
                return content
            logger.warning("Groq returned empty/short response (attempt %d/%d, len=%d)",
                           attempt, MAX_RETRIES, len(content or ""))
        except Exception as exc:
            last_exc = exc
            logger.warning("Groq API error (attempt %d/%d): %s", attempt, MAX_RETRIES, exc)
        if attempt < MAX_RETRIES:
            delay = BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(0, 1)
            logger.info("Retrying in %.1fs...", delay)
            await asyncio.sleep(delay)
    raise RuntimeError(
        f"Groq API failed after {MAX_RETRIES} attempts. "
        f"Last error: {last_exc or 'Empty response from AI model'}"
    )


# ── JSON Parsing ─────────────────────────────────────────────────────────────

def _strip_markdown_fences(text: str) -> str:
    """Remove markdown code fences (```json ... ```) from response text."""
    import re
    # Match ```json or ``` at start/end, single or multi-block
    stripped = text.strip()
    # Remove opening fence (```json or ```)
    stripped = re.sub(r'^```(?:json)?\s*\n?', '', stripped)
    # Remove closing fence
    stripped = re.sub(r'\n?```\s*$', '', stripped)
    return stripped.strip()


def _extract_findings_bracket_match(text: str) -> list[dict[str, Any]] | None:
    """Use bracket-depth matching to extract the 'findings' JSON array from text.

    This is resilient to broken JSON in sibling keys like 'extracted_text' because
    it locates the exact substring for the 'findings' array value and parses
    only that portion.
    """
    import re
    match = re.search(r'"findings"\s*:\s*\[', text)
    if not match:
        return None

    start = match.end() - 1  # position of the opening [
    depth = 0
    end = start
    in_string = False
    escape_next = False
    for i in range(start, len(text)):
        ch = text[i]
        if escape_next:
            escape_next = False
            continue
        if ch == '\\':
            if in_string:
                escape_next = True
            continue
        if ch == '"' and not escape_next:
            in_string = not in_string
            continue
        if in_string:
            continue
        if ch == '[':
            depth += 1
        elif ch == ']':
            depth -= 1
            if depth == 0:
                end = i + 1
                break

    if end <= start:
        return None

    try:
        findings = json.loads(text[start:end])
        if isinstance(findings, list):
            return findings
    except (json.JSONDecodeError, ValueError):
        # Try repairing truncated JSON by closing open structures
        fragment = text[start:end]
        for repair_suffix in [']', '}"]', '}]']:
            try:
                findings = json.loads(fragment + repair_suffix)
                if isinstance(findings, list):
                    logger.info("Parsed findings via bracket match with repair")
                    return findings
            except (json.JSONDecodeError, ValueError):
                continue
    return None


def _parse_json_findings(text: str) -> list[dict[str, Any]]:
    """Extract JSON array from model response with robust multi-strategy parsing.

    Strategies (in order):
    1. Direct JSON parse after stripping markdown fences
    2. Find outermost { } and parse as dict with "findings" key
    3. Find outermost [ ] and parse as findings array
    4. Bracket-depth matching to extract just the "findings" array
       (resilient to broken sibling fields like extracted_text)
    5. Strip extracted_text field via regex, then re-parse the remainder
    6. Scan for individual JSON objects that look like findings
    7. Return a structured error finding
    """
    import re

    raw = text.strip()

    # ── Strategy 1: Strip markdown fences and parse directly ──
    cleaned = _strip_markdown_fences(raw)
    try:
        data = json.loads(cleaned)
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            if "findings" in data and isinstance(data["findings"], list):
                return data["findings"]
            # Single finding dict (has required fields like drawing_ref)
            if "drawing_ref" in data or "issue_type" in data:
                return [data]
    except (json.JSONDecodeError, ValueError):
        pass

    # ── Strategy 2: Find { } boundaries and parse as dict ──
    first_brace = cleaned.find("{")
    last_brace = cleaned.rfind("}")
    if first_brace != -1 and last_brace > first_brace:
        try:
            obj = json.loads(cleaned[first_brace : last_brace + 1])
            if isinstance(obj, dict) and "findings" in obj:
                findings = obj["findings"]
                if isinstance(findings, list):
                    return findings
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Strategy 3: Find [ ] boundaries and parse as array ──
    first_bracket = cleaned.find("[")
    last_bracket = cleaned.rfind("]")
    if first_bracket != -1 and last_bracket > first_bracket:
        try:
            arr = json.loads(cleaned[first_bracket : last_bracket + 1])
            if isinstance(arr, list):
                return arr
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Strategy 4: Bracket-depth matching for "findings" array ──
    # This handles cases where extracted_text has unescaped chars that break
    # the full JSON, by isolating just the findings array substring.
    bracket_result = _extract_findings_bracket_match(cleaned)
    if bracket_result is not None:
        logger.info("Parsed findings via bracket-depth extraction (%d items)", len(bracket_result))
        return bracket_result

    # ── Strategy 5: Strip extracted_text field, then re-parse ──
    # The "extracted_text" value from OCR often has unescaped quotes, newlines,
    # and special chars that break JSON parsing. Remove it and parse the rest.
    stripped_et = re.sub(
        r'"extracted_text"\s*:\s*"(?:[^"\\]|\\.)*"\s*,?',
        '',
        cleaned,
        flags=re.DOTALL,
    )
    if stripped_et != cleaned:
        try:
            data = json.loads(stripped_et)
            if isinstance(data, dict) and "findings" in data:
                findings = data["findings"]
                if isinstance(findings, list):
                    logger.info("Parsed findings after stripping extracted_text (%d items)", len(findings))
                    return findings
            if isinstance(data, list):
                logger.info("Parsed findings array after stripping extracted_text (%d items)", len(data))
                return data
        except (json.JSONDecodeError, ValueError):
            pass

    # Also try a more aggressive approach: find "findings" key position and
    # take everything from there to the end, wrap in { } and parse.
    findings_key_pos = cleaned.find('"findings"')
    if findings_key_pos != -1:
        remainder = '{' + cleaned[findings_key_pos:].rstrip().rstrip('}') + '}'
        try:
            data = json.loads(remainder)
            if isinstance(data, dict) and "findings" in data:
                findings = data["findings"]
                if isinstance(findings, list):
                    logger.info("Parsed findings via key-position extraction (%d items)", len(findings))
                    return findings
        except (json.JSONDecodeError, ValueError):
            pass

    # ── Strategy 6: Scan for individual finding objects ──
    # Last resort: find all JSON objects that look like findings by scanning
    # for known field markers like "issue_type", "severity", "drawing_ref".
    individual_findings = _scan_for_finding_objects(cleaned)
    if individual_findings:
        logger.info("Recovered %d findings via individual object scanning", len(individual_findings))
        return individual_findings

    # ── Strategy 7: Return structured error ──
    logger.warning("Could not parse JSON from agent response (len=%d). First 300 chars: %s",
                   len(text), text[:300])
    return [{
        "drawing_ref": "N/A",
        "location": "N/A",
        "issue_type": "Agent Parse Error",
        "severity": "Minor",
        "description": f"The AI agent returned a response that could not be parsed as structured findings. Raw response length: {len(text)} chars. First 200 chars: {text[:200]}",
        "suggested_fix": "Re-run the review or manually inspect the document.",
        "agent_source": "system",
    }]


def _scan_for_finding_objects(text: str) -> list[dict[str, Any]]:
    """Scan text for individual JSON objects that look like findings.

    This is a last-resort strategy that finds { } delimited objects containing
    known finding fields and parses them individually.
    """
    import re
    findings = []
    # Find all potential object boundaries
    i = 0
    while i < len(text):
        # Find next { that might start a finding object
        brace_start = text.find('{', i)
        if brace_start == -1:
            break
        # Check if this object has finding-like fields nearby
        next_200 = text[brace_start:brace_start+200]
        has_finding_fields = any(field in next_200 for field in [
            '"issue_type"', '"severity"', '"drawing_ref"', '"description"',
        ])
        if not has_finding_fields:
            i = brace_start + 1
            continue
        # Try to match balanced braces
        depth = 0
        in_str = False
        esc = False
        end = brace_start
        for j in range(brace_start, len(text)):
            ch = text[j]
            if esc:
                esc = False
                continue
            if ch == '\\' and in_str:
                esc = True
                continue
            if ch == '"' and not esc:
                in_str = not in_str
                continue
            if in_str:
                continue
            if ch == '{':
                depth += 1
            elif ch == '}':
                depth -= 1
                if depth == 0:
                    end = j + 1
                    break
        if end > brace_start:
            try:
                obj = json.loads(text[brace_start:end])
                if isinstance(obj, dict) and ('issue_type' in obj or 'severity' in obj):
                    findings.append(obj)
            except (json.JSONDecodeError, ValueError):
                pass
        i = max(end, brace_start + 1)
    return findings


# ── Chunk Classification ────────────────────────────────────────────────────

def _is_image_only_chunk(chunk: dict[str, str]) -> bool:
    """Check if a chunk represents an image-only page (no extractable text)."""
    return chunk.get("has_text") == "false"


def _get_text_chunks(chunks: list[dict[str, str]]) -> list[dict[str, str]]:
    """Return only chunks with extractable text content."""
    return [c for c in chunks if not _is_image_only_chunk(c)]


# ── Async Agent Runners ─────────────────────────────────────────────────────

CHUNK_BATCH_SIZE = 3  # Process this many chunks concurrently within each agent
VISION_BATCH_SIZE = 2  # Process vision images in small batches
VISION_INTER_REQUEST_DELAY = 0.5  # Minimal delay — rate limiter handles pacing


async def _process_groq_chunk(
    llm, chunk: dict[str, str], checklist_rules: str
) -> list[dict[str, Any]]:
    """Process a single chunk with the Groq agent."""
    # Skip image-only chunks — the vision agent handles these
    if _is_image_only_chunk(chunk):
        return []

    page_ref = chunk.get("page", chunk.get("section", chunk.get("sheet", "unknown")))
    source = chunk.get("source", "unknown")
    user_msg = (
        f"Document: {source}, Page/Section: {page_ref}\n\n"
        f"--- CONTENT ---\n{chunk['content']}\n\n"
        f"--- CHECKLIST RULES ---\n{checklist_rules}\n"
    )
    try:
        response = await asyncio.to_thread(
            llm.invoke,
            [
                {"role": "system", "content": GROQ_SYSTEM_PROMPT},
                {"role": "user", "content": user_msg},
            ],
        )
        findings = _parse_json_findings(response.content)
        for f in findings:
            f["agent_source"] = "groq"
            if not f.get("drawing_ref"):
                f["drawing_ref"] = source
        return findings
    except Exception as exc:
        logger.error("Groq agent error on chunk %s/%s: %s", source, page_ref, exc)
        return [{
            "drawing_ref": source,
            "location": f"Page/Section: {page_ref}",
            "issue_type": "Agent Error",
            "severity": "Minor",
            "description": f"Groq speed agent failed on this chunk: {str(exc)[:200]}",
            "suggested_fix": "Re-run the review for this section.",
            "agent_source": "groq",
        }]


async def run_groq_agent(
    chunks: list[dict[str, str]],
    checklist_rules: str,
    progress_callback=None,
) -> list[dict[str, Any]]:
    """Agent 1: Fast checklist screening via Groq LLaMA 3 (async, concurrent chunks).

    Automatically skips image-only chunks (handled by vision agent).
    """
    from langchain_groq import ChatGroq

    text_chunks = _get_text_chunks(chunks)
    if not text_chunks:
        logger.info("No text chunks to process with Groq agent (all image-only)")
        if progress_callback:
            await progress_callback("groq", 100, 0)
        return []

    llm = ChatGroq(
        model="llama3-70b-8192",
        api_key=settings.groq_api_key,
        temperature=0.0,
        max_tokens=4096,
    )

    all_findings: list[dict[str, Any]] = []
    total = len(text_chunks)

    for i in range(0, total, CHUNK_BATCH_SIZE):
        batch = text_chunks[i : i + CHUNK_BATCH_SIZE]
        tasks = [_process_groq_chunk(llm, chunk, checklist_rules) for chunk in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                logger.error("Groq batch error: %s", result)
            elif isinstance(result, list):
                all_findings.extend(result)

        if progress_callback:
            pct = min(100, int(((i + len(batch)) / total) * 100))
            await progress_callback("groq", pct, len(all_findings))

    return all_findings


def _compress_image_b64(b64: str, max_bytes: int = 3_000_000) -> tuple[str, str]:
    """Compress a base64 image if it exceeds max_bytes.

    Returns (compressed_b64, mime_type). Converts PNG to JPEG for smaller payloads.
    """
    raw = base64.b64decode(b64)

    # If already small enough, just return as-is but use jpeg for efficiency
    if len(raw) <= max_bytes:
        # Try to convert PNG to JPEG for smaller payload
        try:
            from PIL import Image
            img = Image.open(io.BytesIO(raw))
            if img.mode in ("RGBA", "P"):
                img = img.convert("RGB")
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=80, optimize=True)
            jpeg_b64 = base64.b64encode(buf.getvalue()).decode("utf-8")
            if len(buf.getvalue()) < len(raw):
                return jpeg_b64, "image/jpeg"
        except ImportError:
            pass
        return b64, "image/png"

    # Image too large — resize and compress
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(raw))
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")

        # Reduce resolution progressively until under limit
        for quality in [75, 60, 45]:
            # Scale down if very large
            max_dim = 2048
            if max(img.size) > max_dim:
                ratio = max_dim / max(img.size)
                new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
                img = img.resize(new_size, Image.LANCZOS)

            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=quality, optimize=True)
            if len(buf.getvalue()) <= max_bytes:
                return base64.b64encode(buf.getvalue()).decode("utf-8"), "image/jpeg"

        # Last resort: aggressive resize
        ratio = 0.5
        new_size = (int(img.size[0] * ratio), int(img.size[1] * ratio))
        img = img.resize(new_size, Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=50, optimize=True)
        return base64.b64encode(buf.getvalue()).decode("utf-8"), "image/jpeg"
    except ImportError:
        logger.warning("Pillow not installed; sending large image as-is")
        return b64, "image/png"


async def _process_vision_image(img_data: dict[str, str]) -> list[dict[str, Any]]:
    """Process a single page image with the Google Gemini Vision API."""
    source = img_data.get("source", "unknown")
    page = img_data.get("page", "unknown")
    b64 = img_data.get("image_b64", "")

    if not b64:
        return []

    # Compress image to reduce payload size
    compressed_b64, mime_type = _compress_image_b64(b64)
    logger.info("Vision image for %s page %s: original=%dKB, compressed=%dKB (%s)",
                source, page,
                len(b64) * 3 // 4 // 1024,
                len(compressed_b64) * 3 // 4 // 1024,
                mime_type)

    # Build Gemini API request — use free-tier model from settings
    api_key = settings.gemini_api_key
    if not api_key:
        logger.error("GEMINI_API_KEY not set — cannot run vision agent")
        return [{
            "drawing_ref": f"{source} (Page {page})",
            "location": f"Page {page}",
            "issue_type": "Configuration Error",
            "severity": "Critical",
            "description": "GEMINI_API_KEY is not configured. Set it in .env to enable vision analysis.",
            "suggested_fix": "Add GEMINI_API_KEY=your_key to the .env file.",
            "agent_source": "vision",
        }]

    # Rate-limit before making the request
    await _gemini_limiter.acquire()

    model_name = settings.gemini_model  # gemini-2.5-flash-lite (free tier)
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={api_key}"
    )

    user_text = (
        f"Analyze this engineering drawing image.\n"
        f"Document: {source}, Page: {page}\n"
        f"Perform a complete visual QA/QC inspection and return all findings as a JSON array."
    )

    payload = {
        "systemInstruction": {
            "parts": [{"text": VISION_SYSTEM_PROMPT}],
        },
        "contents": [
            {
                "parts": [
                    {"text": user_text},
                    {
                        "inlineData": {
                            "mimeType": mime_type,
                            "data": compressed_b64,
                        }
                    },
                ],
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
            "maxOutputTokens": 4096,
        },
    }

    last_exc = None
    max_vision_retries = 3  # Reduced retries for faster failure
    for attempt in range(1, max_vision_retries + 1):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(
                    url,
                    headers={"Content-Type": "application/json"},
                    json=payload,
                )

                # Handle 429 specifically with smarter backoff
                if response.status_code == 429:
                    retry_after = response.headers.get("Retry-After")
                    if retry_after:
                        try:
                            delay = float(retry_after) + random.uniform(0.5, 2.0)
                        except (ValueError, TypeError):
                            delay = 5.0 + random.uniform(0.5, 2.0)
                    else:
                        # Exponential backoff starting at 5s for 429s
                        delay = 5.0 * (2 ** (attempt - 1)) + random.uniform(0.5, 2.0)
                    delay = min(delay, 30.0)  # Cap at 30 seconds
                    logger.warning(
                        "Vision agent 429 rate limited on %s page %s (attempt %d/%d), "
                        "waiting %.1fs before retry",
                        source, page, attempt, max_vision_retries, delay,
                    )
                    if attempt < max_vision_retries:
                        await asyncio.sleep(delay)
                        continue
                    else:
                        last_exc = RuntimeError(f"429 Too Many Requests after {max_vision_retries} retries")
                        break

                response.raise_for_status()
                data = response.json()

            # Robust response parsing — handle blocked/filtered/empty responses
            candidates = data.get("candidates", [])
            if not candidates:
                # Check if content was filtered
                block_reason = data.get("promptFeedback", {}).get("blockReason", "")
                if block_reason:
                    logger.warning("Vision agent: content blocked on %s page %s: %s", source, page, block_reason)
                    return [{
                        "drawing_ref": f"{source} (Page {page})",
                        "location": f"Page {page}",
                        "issue_type": "Content Filtered",
                        "severity": "Minor",
                        "description": f"Gemini filtered this image (reason: {block_reason}). This is likely a benign drawing.",
                        "suggested_fix": "Review this page manually.",
                        "agent_source": "vision",
                    }]
                logger.warning("Vision agent: empty response from Gemini for %s page %s", source, page)
                return []

            # Extract text safely
            try:
                response_text = candidates[0]["content"]["parts"][0]["text"]
            except (KeyError, IndexError, TypeError) as parse_exc:
                finish_reason = candidates[0].get("finishReason", "UNKNOWN")
                logger.warning("Vision agent: could not parse response for %s page %s (finishReason=%s): %s",
                             source, page, finish_reason, parse_exc)
                return []

            # Parse the findings — now expecting a JSON array directly
            findings = _parse_json_findings(response_text)
            # Filter out any meta "Agent Parse Error" entries if we also got real findings
            real = [f for f in findings if f.get("issue_type") != "Agent Parse Error"]
            if real:
                findings = real

            for f in findings:
                f["agent_source"] = "vision"
                if not f.get("drawing_ref"):
                    f["drawing_ref"] = f"{source} (Page {page})"
            logger.info("Vision agent (Gemini) found %d issues on %s page %s", len(findings), source, page)
            return findings
        except httpx.HTTPStatusError as exc:
            last_exc = exc
            logger.warning("Vision agent (Gemini) HTTP error on %s page %s (attempt %d/%d): %s",
                          source, page, attempt, max_vision_retries, exc)
            if attempt < max_vision_retries:
                delay = BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(0, 2)
                await asyncio.sleep(delay)
        except Exception as exc:
            last_exc = exc
            logger.warning("Vision agent (Gemini) error on %s page %s (attempt %d/%d): %s",
                          source, page, attempt, max_vision_retries, exc)
            if attempt < max_vision_retries:
                delay = BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(0, 1)
                await asyncio.sleep(delay)

    logger.error("Vision agent (Gemini) failed on %s page %s after %d attempts", source, page, max_vision_retries)
    return [{
        "drawing_ref": f"{source} (Page {page})",
        "location": f"Page {page}",
        "issue_type": "Agent Error",
        "severity": "Minor",
        "description": f"Vision agent failed on this page after {max_vision_retries} attempts: {str(last_exc)[:200]}",
        "suggested_fix": "Re-run the review for this drawing page.",
        "agent_source": "vision",
    }]


async def run_vision_agent(
    page_images: list[dict[str, str]],
    progress_callback=None,
) -> list[dict[str, Any]]:
    """Vision Agent: Analyze engineering drawing images via Google Gemini Vision API (async).

    Processes images SEQUENTIALLY with inter-request delays to respect
    Gemini free-tier rate limits (~15 RPM).
    """
    all_findings: list[dict[str, Any]] = []
    total = len(page_images)

    if not total:
        if progress_callback:
            await progress_callback("vision", 100, 0)
        return []

    logger.info("Vision agent processing %d images (rate limiter handles pacing)", total)

    # Cap pages to stay within free-tier limits (8 RPM = max ~5 pages/min safely)
    MAX_VISION_PAGES = 5
    if total > MAX_VISION_PAGES:
        logger.warning("Vision agent: capping from %d to %d pages to respect rate limits", total, MAX_VISION_PAGES)
        page_images = page_images[:MAX_VISION_PAGES]
        total = MAX_VISION_PAGES

    for idx, img in enumerate(page_images):
        # Rate limiter in _process_vision_image handles pacing — no extra delay needed

        try:
            result = await _process_vision_image(img)
            if isinstance(result, list):
                all_findings.extend(result)
        except Exception as exc:
            logger.error("Vision error on image %d/%d: %s", idx + 1, total, exc)

        if progress_callback:
            pct = min(100, int(((idx + 1) / total) * 100))
            await progress_callback("vision", pct, len(all_findings))

    return all_findings


async def _process_reasoning_chunk(
    chunk: dict[str, str],
    prior_findings: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Process a single chunk with the Groq reasoning agent."""
    # Skip image-only chunks — the vision agent handles these
    if _is_image_only_chunk(chunk):
        return []

    page_ref = chunk.get("page", chunk.get("section", chunk.get("sheet", "unknown")))
    source = chunk.get("source", "unknown")
    prior_json = json.dumps(prior_findings[:20], indent=2)  # Limit context to avoid token overflow

    user_msg = (
        f"Document: {source}, Page/Section: {page_ref}\n\n"
        f"--- DRAWING/SPEC CONTENT ---\n{chunk['content']}\n\n"
        f"--- PRELIMINARY FINDINGS FROM FAST-CHECK AGENT ---\n{prior_json}\n"
    )

    messages = [
        {"role": "system", "content": OPENAI_SYSTEM_PROMPT},
        {"role": "user", "content": user_msg},
    ]

    try:
        response_text = await _groq_chat_completion_async(messages, temperature=0.1, max_tokens=4096)
        findings = _parse_json_findings(response_text)
        for f in findings:
            f["agent_source"] = "groq_reasoning"
            if not f.get("drawing_ref"):
                f["drawing_ref"] = source
        return findings
    except Exception as exc:
        logger.error("Reasoning agent error on chunk %s/%s: %s", source, page_ref, exc)
        return [{
            "drawing_ref": source,
            "location": f"Page/Section: {page_ref}",
            "issue_type": "Agent Error",
            "severity": "Minor",
            "description": f"Groq reasoning agent failed on this chunk: {str(exc)[:200]}",
            "suggested_fix": "Re-run the review for this section.",
            "agent_source": "groq_reasoning",
        }]


async def run_openai_agent(
    chunks: list[dict[str, str]],
    groq_findings: list[dict[str, Any]],
    vision_findings: list[dict[str, Any]] | None = None,
    progress_callback=None,
) -> list[dict[str, Any]]:
    """Agent 2: Deep reasoning via Groq LLaMA 3.3 70B Versatile (async).

    Automatically skips image-only chunks (handled by vision agent).
    """
    text_chunks = _get_text_chunks(chunks)
    if not text_chunks:
        logger.info("No text chunks to process with reasoning agent (all image-only)")
        if progress_callback:
            await progress_callback("openai", 100, 0)
        return []

    all_findings: list[dict[str, Any]] = []
    prior_findings = groq_findings + (vision_findings or [])
    total = len(text_chunks)

    for i in range(0, total, CHUNK_BATCH_SIZE):
        batch = text_chunks[i : i + CHUNK_BATCH_SIZE]
        tasks = [_process_reasoning_chunk(c, prior_findings) for c in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for result in results:
            if isinstance(result, Exception):
                logger.error("Reasoning batch error: %s", result)
            elif isinstance(result, list):
                all_findings.extend(result)

        if progress_callback:
            pct = min(100, int(((i + len(batch)) / total) * 100))
            await progress_callback("openai", pct, len(all_findings))

    return all_findings


# ── Summary Agent ────────────────────────────────────────────────────────────

async def run_summary_agent(merged_findings: list[dict[str, Any]]) -> dict[str, Any]:
    """Summary Agent: Generate executive summary via Groq."""
    if not merged_findings:
        return {
            "executive_summary": "No findings were identified during the review. The documents appear to meet the reviewed criteria.",
            "total_findings": 0,
            "critical_count": 0,
            "major_count": 0,
            "minor_count": 0,
            "top_risk_areas": [],
            "overall_confidence": 0.5,
            "confidence_reasoning": "No findings to assess; review may not have had sufficient content.",
        }

    findings_json = json.dumps(merged_findings[:50], indent=2)  # Limit to avoid token overflow
    messages = [
        {"role": "system", "content": SUMMARY_SYSTEM_PROMPT},
        {"role": "user", "content": f"Here are all the deduplicated findings from the multi-agent review:\n\n{findings_json}"},
    ]

    try:
        response_text = await _groq_chat_completion_async(messages, temperature=0.1, max_tokens=2048)
        cleaned = response_text.strip()
        if cleaned.startswith("```"):
            lines = cleaned.split("\n")
            lines = [l for l in lines if not l.strip().startswith("```")]
            cleaned = "\n".join(lines)
        summary = json.loads(cleaned)
        return summary
    except Exception as exc:
        logger.error("Summary agent error: %s", exc)
        # Compute basic stats as fallback
        critical = sum(1 for f in merged_findings if f.get("severity") == "Critical")
        major = sum(1 for f in merged_findings if f.get("severity") == "Major")
        minor = sum(1 for f in merged_findings if f.get("severity") == "Minor")
        return {
            "executive_summary": f"Review completed with {len(merged_findings)} findings ({critical} Critical, {major} Major, {minor} Minor). Manual review of the executive summary is recommended.",
            "total_findings": len(merged_findings),
            "critical_count": critical,
            "major_count": major,
            "minor_count": minor,
            "top_risk_areas": [],
            "overall_confidence": 0.6,
            "confidence_reasoning": "Summary agent encountered an error; basic statistics computed as fallback.",
        }


# ── Sync wrappers (for non-async callers) ────────────────────────────────────

def run_openai_simple(system_prompt: str, user_content: str) -> str:
    """Run a one-shot Groq call (for spec gen, word review, etc.)."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    return _groq_chat_completion(messages, temperature=0.2, max_tokens=8192)


async def run_openai_simple_async(system_prompt: str, user_content: str) -> str:
    """Async version of run_openai_simple for non-blocking spec generation."""
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": user_content},
    ]
    return await _groq_chat_completion_async(messages, temperature=0.2, max_tokens=8192)


# ── Fuzzy Deduplication ──────────────────────────────────────────────────────

def _fuzzy_match(a: str, b: str, threshold: float = 0.75) -> bool:
    """Check if two strings are fuzzy matches using SequenceMatcher."""
    if not a or not b:
        return a == b
    return difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() >= threshold


def deduplicate_findings(
    groq_findings: list[dict[str, Any]],
    openai_findings: list[dict[str, Any]],
    vision_findings: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Merge findings from all agents with fuzzy deduplication.

    Uses SequenceMatcher for semantic similarity instead of exact string matching.
    When duplicates exist, keep the finding with the richer description and code_clause.
    """
    merged: list[dict[str, Any]] = []
    all_input = groq_findings + openai_findings + (vision_findings or [])

    # Filter out "Agent Error" and "Agent Parse Error" findings if we have real findings
    real_findings = [f for f in all_input if f.get("issue_type") not in ("Agent Error", "Agent Parse Error")]
    error_findings = [f for f in all_input if f.get("issue_type") in ("Agent Error", "Agent Parse Error")]

    # Use real findings if available, otherwise fall back to error findings
    findings_to_process = real_findings if real_findings else error_findings

    for f in findings_to_process:
        is_duplicate = False
        for i, existing in enumerate(merged):
            # Check if drawing_ref matches (exact or fuzzy)
            ref_match = _fuzzy_match(
                f.get("drawing_ref", "").strip(),
                existing.get("drawing_ref", "").strip(),
                0.8,
            )
            # Check if issue_type matches (fuzzy)
            type_match = _fuzzy_match(
                f.get("issue_type", "").strip(),
                existing.get("issue_type", "").strip(),
                0.7,
            )
            # Check if description is similar (fuzzy)
            desc_match = _fuzzy_match(
                f.get("description", "").strip(),
                existing.get("description", "").strip(),
                0.6,
            )

            if ref_match and (type_match or desc_match):
                is_duplicate = True
                # Prefer the finding with richer content
                new_richer = len(f.get("description", "")) > len(existing.get("description", ""))
                new_has_clause = bool(f.get("code_clause")) and not bool(existing.get("code_clause"))
                if new_richer or new_has_clause:
                    if existing.get("code_clause") and not f.get("code_clause"):
                        f["code_clause"] = existing["code_clause"]
                    merged[i] = f
                elif existing.get("code_clause") is None and f.get("code_clause"):
                    existing["code_clause"] = f["code_clause"]
                break

        if not is_duplicate:
            merged.append(f)

    # Apply final severity rules
    for f in merged:
        issue_type_lower = f.get("issue_type", "").lower()
        desc_lower = f.get("description", "").lower()
        combined = issue_type_lower + " " + desc_lower

        if any(term in combined for term in [
            "code violation", "non-compliance", "non-conformance",
            "structural inadequacy", "insufficient cover", "under-reinforced",
        ]):
            f["severity"] = "Critical"
        elif any(term in combined for term in [
            "coordination", "clash", "conflict", "penetration through",
            "safety", "egress", "fire rating",
        ]):
            f["severity"] = "Critical"
        elif any(term in combined for term in [
            "missing annotation", "missing dimension", "missing schedule",
            "incomplete title block", "unreferenced detail",
        ]):
            f["severity"] = "Major"
        elif any(term in combined for term in [
            "schedule error", "quantity mismatch", "outdated standard",
        ]):
            f["severity"] = "Major"

    return merged


# ── OCR Agent (Gemini-based text extraction) ─────────────────────────────────

async def _ocr_single_image(img_data: dict[str, str]) -> dict[str, Any]:
    """Extract text from a single page image using Gemini OCR."""
    source = img_data.get("source", "unknown")
    page = img_data.get("page", "unknown")
    b64 = img_data.get("image_b64", "")

    if not b64:
        return {"source": source, "page": page, "text": "", "structured": {}}

    api_key = settings.gemini_api_key
    if not api_key:
        return {"source": source, "page": page, "text": "[GEMINI_API_KEY not configured]", "structured": {}}

    compressed_b64, mime_type = _compress_image_b64(b64)

    # Rate limit
    await _gemini_limiter.acquire()

    model_name = settings.gemini_model
    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent"
        f"?key={api_key}"
    )

    payload = {
        "systemInstruction": {"parts": [{"text": OCR_SYSTEM_PROMPT}]},
        "contents": [{
            "parts": [
                {"text": f"Extract ALL text from this engineering drawing. Document: {source}, Page: {page}"},
                {"inlineData": {"mimeType": mime_type, "data": compressed_b64}},
            ],
        }],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 4096},
    }

    for attempt in range(1, 4):
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, headers={"Content-Type": "application/json"}, json=payload)

                if response.status_code == 429:
                    delay = 5.0 * (2 ** (attempt - 1)) + random.uniform(0.5, 2.0)
                    logger.warning("OCR agent 429 on %s page %s, waiting %.1fs", source, page, delay)
                    if attempt < 3:
                        await asyncio.sleep(min(delay, 120.0))
                        continue
                    break

                response.raise_for_status()
                data = response.json()

            text = data["candidates"][0]["content"]["parts"][0]["text"]

            # Try to parse structured JSON from response
            structured = {}
            try:
                cleaned = text.strip()
                if cleaned.startswith("```"):
                    lines = cleaned.split("\n")
                    lines = [l for l in lines if not l.strip().startswith("```")]
                    cleaned = "\n".join(lines)
                structured = json.loads(cleaned)
                full_text = structured.get("full_text", text)
            except (json.JSONDecodeError, KeyError):
                full_text = text

            logger.info("OCR agent extracted %d chars from %s page %s", len(full_text), source, page)
            return {"source": source, "page": page, "text": full_text, "structured": structured}

        except Exception as exc:
            logger.warning("OCR agent error on %s page %s (attempt %d): %s", source, page, attempt, exc)
            if attempt < 3:
                await asyncio.sleep(BASE_DELAY * (2 ** (attempt - 1)) + random.uniform(0, 1))

    logger.error("OCR agent failed on %s page %s", source, page)
    return {"source": source, "page": page, "text": "", "structured": {}}


async def run_ocr_agent(
    page_images: list[dict[str, str]],
    memory: AgentMemory | None = None,
    progress_callback=None,
) -> tuple[list[dict[str, str]], AgentMemory]:
    """OCR Agent: Extract text from image-only pages using Gemini 1.5 Flash.

    Returns (enriched_chunks, memory) where enriched_chunks contain OCR-extracted
    text that can augment the original parsed chunks for analysis agents.
    """
    if memory is None:
        memory = AgentMemory()

    enriched_chunks: list[dict[str, str]] = []
    total = len(page_images)

    if not total:
        if progress_callback:
            await progress_callback("ocr", 100, 0)
        return enriched_chunks, memory

    logger.info("OCR Agent: processing %d page images via Gemini %s", total, settings.gemini_model)

    for idx, img in enumerate(page_images):
        result = await _ocr_single_image(img)
        text = result.get("text", "")
        structured = result.get("structured", {})

        if text and len(text.strip()) > 20:
            page_key = f"{result['source']}_page_{result['page']}"
            memory.add_ocr_result(page_key, text)

            # Extract structural elements and measurements into memory
            if isinstance(structured, dict):
                memory.structural_elements.extend(structured.get("structural_elements", []))
                memory.measurements.extend(structured.get("measurements", []))

            enriched_chunks.append({
                "source": result["source"],
                "page": result["page"],
                "content": text,
                "has_text": "true",
                "ocr_extracted": "true",
            })

        if progress_callback:
            pct = min(100, int(((idx + 1) / total) * 100))
            await progress_callback("ocr", pct, len(enriched_chunks))

    logger.info("OCR Agent: extracted text from %d/%d pages", len(enriched_chunks), total)
    memory.add_findings("ocr", enriched_chunks)
    return enriched_chunks, memory


def create_agent_memory() -> AgentMemory:
    """Factory to create a new AgentMemory instance for a review session."""
    return AgentMemory()
