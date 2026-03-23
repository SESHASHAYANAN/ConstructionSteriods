"""Compliance router: Predictive Code Compliance analysis."""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from pydantic import BaseModel, Field
from routers.auth import get_current_user
from services.compliance import predict_compliance, BUILDING_CODES_DB
from services.file_parser import parse_file
import store

router = APIRouter(prefix="/compliance", tags=["Predictive Compliance"])
logger = logging.getLogger(__name__)


class ComplianceRequest(BaseModel):
    text: str
    building_codes: list[str] = Field(default_factory=list)
    discipline: str = "General"
    project_id: Optional[str] = None


@router.get("/codes")
def get_building_codes(_: dict = Depends(get_current_user)):
    """Return the building codes reference database for frontend selectors."""
    return {
        code_key: {
            "name": info["name"],
            "editions": info["editions"],
            "key_areas": info["key_areas"],
        }
        for code_key, info in BUILDING_CODES_DB.items()
    }


@router.post("/predict")
async def predict(body: ComplianceRequest, _: dict = Depends(get_current_user)):
    """Run predictive code compliance analysis on draft document text.

    Analyzes the provided text against applicable building codes and flags
    potential violations, early warnings, and missing information.
    """
    if not body.text or len(body.text.strip()) < 20:
        raise HTTPException(status_code=400, detail="Content must be at least 20 characters.")

    project_name = ""
    if body.project_id and body.project_id in store.projects:
        project_name = store.projects[body.project_id].get("name", "")

    try:
        result = await predict_compliance(
            text=body.text,
            building_codes=body.building_codes,
            discipline=body.discipline,
            project_name=project_name,
        )
        return result
    except Exception as exc:
        logger.error("Compliance prediction endpoint error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Compliance analysis failed: {str(exc)[:200]}")


@router.post("/predict-upload")
async def predict_upload(
    file: UploadFile = File(...),
    building_codes: str = Form(""),
    discipline: str = Form("General"),
    project_id: str = Form(""),
    _: dict = Depends(get_current_user),
):
    """Upload a document (PDF/DOCX) for predictive compliance analysis.

    Parses the file into text chunks using the existing file parser,
    then runs the compliance engine on the extracted content.
    """
    ext = Path(file.filename or "file").suffix.lower()
    if ext not in (".pdf", ".docx", ".xlsx", ".txt"):
        raise HTTPException(
            status_code=400,
            detail="Only PDF, DOCX, XLSX, and TXT files are supported.",
        )

    # Save temp file for parsing
    import tempfile
    import os

    tmp_dir = tempfile.mkdtemp()
    tmp_path = Path(tmp_dir) / (file.filename or "upload" + ext)
    try:
        with open(tmp_path, "wb") as buf:
            shutil.copyfileobj(file.file, buf)

        # Parse into text chunks
        chunks = parse_file(str(tmp_path))
        text_content = "\n\n".join(
            f"[{c.get('source', '')} — {c.get('page', c.get('section', ''))}]\n{c.get('content', '')}"
            for c in chunks
            if c.get("has_text") != "false" and c.get("content", "").strip()
        )

        if not text_content or len(text_content.strip()) < 20:
            raise HTTPException(
                status_code=400,
                detail="Could not extract sufficient text content from the uploaded file.",
            )

        # Parse building codes from comma-separated string
        codes_list = [c.strip() for c in building_codes.split(",") if c.strip()] if building_codes else []

        project_name = ""
        if project_id and project_id in store.projects:
            project_name = store.projects[project_id].get("name", "")

        result = await predict_compliance(
            text=text_content,
            building_codes=codes_list,
            discipline=discipline,
            project_name=project_name,
        )
        return result

    except HTTPException:
        raise
    except Exception as exc:
        logger.error("Compliance upload endpoint error: %s", exc)
        raise HTTPException(status_code=502, detail=f"Compliance analysis failed: {str(exc)[:200]}")
    finally:
        # Cleanup temp files
        shutil.rmtree(tmp_dir, ignore_errors=True)
