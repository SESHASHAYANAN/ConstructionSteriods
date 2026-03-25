"""Router for advanced report export endpoints.

Provides crash-free advanced PDF + enhanced DOCX report generation.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
import io

import store
from services.report_advanced import generate_advanced_pdf_report

router = APIRouter(prefix="/export", tags=["Export"])


@router.get("/{project_id}/pdf-advanced")
async def export_advanced_pdf(project_id: str):
    """Export an advanced PDF report with compliance matrix, standards, and annotations."""

    project = store.projects.get(project_id)
    if not project:
        raise HTTPException(status_code=404, detail="Project not found")

    issues = store.get_project_issues(project_id)
    ncrs = store.get_project_ncrs(project_id)
    rfis = store.get_project_rfis(project_id)
    logs = store.audit_logs.get(project_id, [])

    try:
        pdf_bytes = generate_advanced_pdf_report(
            project_name=project.get("name", "Unnamed Project"),
            project_description=project.get("description", ""),
            building_codes=project.get("building_codes", []),
            issues=issues,
            ncrs=ncrs,
            rfis=rfis,
            summary=project.get("review_summary", {}),
            audit_logs=logs,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Report generation failed: {str(exc)}")

    safe_name = (project.get("name", "report") or "report").replace(" ", "_")
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{safe_name}_Advanced_QA_Report.pdf"'},
    )
