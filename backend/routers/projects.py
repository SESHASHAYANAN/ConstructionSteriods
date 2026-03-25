"""Projects router: CRUD, file upload, async review trigger, SSE streaming, report export."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import shutil
import traceback
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, Request, UploadFile, File
from fastapi.responses import Response, StreamingResponse

from config import settings
from models import ProjectCreate, ProjectOut, ReviewStatus
from routers.auth import get_current_user
from services.file_parser import parse_file, extract_pdf_page_images, get_pdf_page_count, extract_image_as_b64
from services.agents import (
    run_groq_agent, run_openai_agent, run_vision_agent,
    run_summary_agent, deduplicate_findings,
)
from services.report import generate_issue_report_docx
import store

router = APIRouter(prefix="/projects", tags=["Projects"])
logger = logging.getLogger(__name__)

# In-memory cache of page images per project for the vision agent
_project_page_images: dict[str, list[dict[str, str]]] = {}


def _project_out(pid: str) -> ProjectOut:
    p = store.projects[pid]
    files = store.project_files.get(pid, [])
    issues = store.get_project_issues(pid)
    review = store.project_reviews.get(pid, {})
    return ProjectOut(
        id=pid,
        name=p["name"],
        description=p.get("description", ""),
        building_codes=p.get("building_codes", []),
        created_at=p["created_at"],
        file_count=len(files),
        issue_count=len(issues),
        health_score=store.compute_health_score(pid),
        review_status=ReviewStatus(review.get("status", "Pending")),
    )


@router.get("", response_model=list[ProjectOut])
def list_projects(_: dict = Depends(get_current_user)):
    return [_project_out(pid) for pid in store.projects]


@router.post("", response_model=ProjectOut, status_code=201)
def create_project(body: ProjectCreate, _: dict = Depends(get_current_user)):
    pid = store.gen_id()
    store.projects[pid] = {
        "id": pid,
        "name": body.name,
        "description": body.description,
        "building_codes": body.building_codes,
        "created_at": store.now_iso(),
    }
    store.project_files[pid] = []
    store.project_chunks[pid] = []
    # Create upload directory
    upload_dir = Path(settings.upload_dir) / pid
    upload_dir.mkdir(parents=True, exist_ok=True)
    return _project_out(pid)


@router.get("/{project_id}", response_model=ProjectOut)
def get_project(project_id: str, _: dict = Depends(get_current_user)):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return _project_out(project_id)


@router.post("/{project_id}/upload")
async def upload_files(
    project_id: str,
    files: list[UploadFile] = File(...),
    _: dict = Depends(get_current_user),
):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")

    upload_dir = Path(settings.upload_dir) / project_id
    upload_dir.mkdir(parents=True, exist_ok=True)
    uploaded: list[dict] = []

    for f in files:
        ext = Path(f.filename or "file").suffix.lower()
        if ext not in (".pdf", ".docx", ".xlsx", ".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"):
            continue

        file_id = uuid.uuid4().hex[:8]
        safe_name = f"{file_id}_{f.filename}"
        dest = upload_dir / safe_name

        with open(dest, "wb") as buf:
            shutil.copyfileobj(f.file, buf)

        # Parse into text chunks
        chunks = parse_file(str(dest))
        store.project_chunks.setdefault(project_id, []).extend(chunks)
        logger.info("[UPLOAD] Parsed %s: %d chunks (text: %d, image-only: %d)",
                    f.filename, len(chunks),
                    sum(1 for c in chunks if c.get('has_text') == 'true'),
                    sum(1 for c in chunks if c.get('has_text') == 'false'))

        # Extract page images for vision analysis (PDFs only)
        if ext == ".pdf":
            try:
                page_imgs = extract_pdf_page_images(str(dest))
                _project_page_images.setdefault(project_id, []).extend(page_imgs)
                logger.info("[UPLOAD] Extracted %d page images from %s", len(page_imgs), f.filename)
            except Exception as img_exc:
                logger.warning("[UPLOAD] Image extraction failed for %s: %s", f.filename, img_exc)

        # Extract images from standalone image files
        if ext in (".png", ".jpg", ".jpeg", ".tiff", ".tif", ".bmp"):
            try:
                img_list = extract_image_as_b64(str(dest))
                _project_page_images.setdefault(project_id, []).extend(img_list)
                logger.info("[UPLOAD] Loaded %d images from %s", len(img_list), f.filename)
            except Exception as img_exc:
                logger.warning("[UPLOAD] Image load failed for %s: %s", f.filename, img_exc)

        # Use actual PDF page count, not chunk count (chunks can be 0 for
        # image-only engineering drawings; pages should reflect the real count)
        if ext == ".pdf":
            actual_page_count = get_pdf_page_count(str(dest))
        else:
            actual_page_count = len(chunks)

        file_meta = {
            "id": file_id,
            "filename": f.filename,
            "stored_name": safe_name,
            "size": os.path.getsize(dest),
            "type": ext.lstrip("."),
            "pages": actual_page_count,
            "uploaded_at": store.now_iso(),
        }
        store.project_files.setdefault(project_id, []).append(file_meta)
        uploaded.append(file_meta)

    # Auto-trigger review after upload
    if uploaded:
        total_chunks = len(store.project_chunks.get(project_id, []))
        total_images = len(_project_page_images.get(project_id, []))
        logger.info("[UPLOAD] Auto-triggering review for project %s: %d chunks, %d page images",
                    project_id, total_chunks, total_images)
        store.project_reviews[project_id] = {
            "status": "Pending",
            "started_at": store.now_iso(),
            "finding_count": 0,
        }
        store.review_progress[project_id] = {}
        asyncio.create_task(_run_review_async(project_id))

    return {"uploaded": uploaded, "total_chunks": len(store.project_chunks.get(project_id, []))}


# ── Async Review Pipeline ────────────────────────────────────────────────────

async def _update_progress(project_id: str, agent: str, pct: int, finding_count: int):
    """Update progress tracking for SSE streaming."""
    if project_id not in store.review_progress:
        store.review_progress[project_id] = {}
    store.review_progress[project_id][agent] = {
        "progress": pct,
        "findings": finding_count,
        "status": "complete" if pct >= 100 else "running",
    }


async def _run_review_async(project_id: str):
    """Async review job: runs agents with concurrency where possible.

    Each agent phase is individually wrapped in try/except so a failure
    in one agent doesn't crash the entire pipeline.
    """
    print(f"\n{'='*60}")
    print(f"[REVIEW] === STARTING REVIEW for project {project_id} ===")
    print(f"{'='*60}")
    logger.info("[REVIEW] Starting review for project %s", project_id)
    try:
        store.project_reviews[project_id]["status"] = "In Progress"
        store.review_progress[project_id] = {
            "overall": {"stage": "starting", "progress": 0},
        }

        chunks = store.project_chunks.get(project_id, [])
        page_images = _project_page_images.get(project_id, [])
        text_chunks = [c for c in chunks if c.get('has_text') == 'true']
        img_chunks = [c for c in chunks if c.get('has_text') == 'false']
        print(f"[REVIEW] Chunks: {len(chunks)} total ({len(text_chunks)} text, {len(img_chunks)} image-only)")
        print(f"[REVIEW] Page images for vision: {len(page_images)}")
        logger.info("[REVIEW] Project %s: %d chunks (%d text, %d image-only), %d page images",
                    project_id, len(chunks), len(text_chunks), len(img_chunks), len(page_images))

        # Even if no text chunks exist, we may have page images for the vision agent
        if not chunks and not page_images:
            logger.warning("[REVIEW] No chunks or images for project %s, completing early", project_id)
            print(f"[REVIEW] WARNING: No content to review for project {project_id}")
            store.project_reviews[project_id]["status"] = "Complete"
            store.project_reviews[project_id]["finding_count"] = 0
            store.review_progress[project_id]["overall"] = {"stage": "complete", "progress": 100}
            return

        # Get checklist rules
        proj_settings = store.project_settings.get(project_id, {})
        rules_list = proj_settings.get("checklist_rules", [])
        checklist_text = "\n".join(
            f"- [{r.get('severity', 'Major')}] {r.get('category', '')}: {r.get('description', '')}"
            for r in rules_list
        ) if rules_list else "Use standard QA/QC engineering checklist rules."

        # Create a progress callback bound to this project
        async def progress_cb(agent: str, pct: int, count: int):
            await _update_progress(project_id, agent, pct, count)

        groq_findings = []
        vision_findings = []
        openai_findings = []

        # ── OCR is merged into Vision agent (one Gemini call does both OCR + QA/QC) ──
        # No separate OCR phase needed — this halves Gemini API calls and prevents 429s

        # ── Phase 1: Run Groq + Vision agents CONCURRENTLY ──
        store.review_progress[project_id]["overall"] = {"stage": "agents_phase1", "progress": 10}

        phase1_tasks = []
        if chunks:
            phase1_tasks.append(("groq", run_groq_agent(chunks, checklist_text, progress_cb)))
        if page_images:
            phase1_tasks.append(("vision", run_vision_agent(page_images, progress_cb)))

        if phase1_tasks:
            logger.info("[Project %s] Running Phase 1: %s concurrently...",
                       project_id, " + ".join(t[0] for t in phase1_tasks))
            results = await asyncio.gather(
                *[t[1] for t in phase1_tasks], return_exceptions=True
            )

            for (agent_name, _), result in zip(phase1_tasks, results):
                if isinstance(result, Exception):
                    logger.error("[Project %s] %s agent failed in Phase 1: %s",
                               project_id, agent_name, result)
                    await _update_progress(project_id, agent_name, 100, 0)
                elif isinstance(result, list):
                    if agent_name == "groq":
                        groq_findings = result
                    elif agent_name == "vision":
                        vision_findings = result
                    await _update_progress(project_id, agent_name, 100, len(result))
                    logger.info("[Project %s] %s agent found %d issues",
                              project_id, agent_name, len(result))

        logger.info("[Project %s] Phase 1 complete: Groq=%d, Vision=%d findings",
                     project_id, len(groq_findings), len(vision_findings))

        # ── Phase 2: Reasoning Agent (needs Phase 1 results) ──
        store.review_progress[project_id]["overall"] = {"stage": "agents_phase2", "progress": 50}

        try:
            logger.info("[Project %s] Running Phase 2: Deep Reasoning Agent...", project_id)
            openai_findings = await run_openai_agent(
                chunks, groq_findings, vision_findings, progress_cb
            )
            logger.info("[Project %s] Reasoning agent found %d issues",
                       project_id, len(openai_findings))
        except Exception as exc:
            logger.error("[Project %s] Reasoning agent failed: %s", project_id, exc)
            openai_findings = []

        await _update_progress(project_id, "openai", 100, len(openai_findings))

        # ── Phase 3: Deduplicate + Summary Agent ──
        store.review_progress[project_id]["overall"] = {"stage": "dedup_summary", "progress": 80}

        merged = deduplicate_findings(groq_findings, openai_findings, vision_findings)
        logger.info("[Project %s] Merged to %d unique findings", project_id, len(merged))

        # Run summary agent
        summary = {}
        try:
            logger.info("[Project %s] Running Summary Agent...", project_id)
            summary = await run_summary_agent(merged)
        except Exception as exc:
            logger.error("[Project %s] Summary agent failed: %s", project_id, exc)
            critical = sum(1 for f in merged if f.get("severity") == "Critical")
            major = sum(1 for f in merged if f.get("severity") == "Major")
            minor = sum(1 for f in merged if f.get("severity") == "Minor")
            summary = {
                "executive_summary": f"Review completed with {len(merged)} findings ({critical} Critical, {major} Major, {minor} Minor).",
                "total_findings": len(merged),
                "critical_count": critical,
                "major_count": major,
                "minor_count": minor,
                "top_risk_areas": [],
                "overall_confidence": 0.5,
                "confidence_reasoning": "Summary agent failed; basic statistics provided.",
            }
        await _update_progress(project_id, "summary", 100, 0)

        # Store as issues + auto-generate NCRs and RFIs
        # Get first uploaded file for linking drawing images to issues
        project_file_list = store.project_files.get(project_id, [])
        first_file_id = project_file_list[0]["id"] if project_file_list else None

        for f in merged:
            issue_id = store.gen_id()
            severity = f.get("severity", "Minor")
            drawing_ref = f.get("drawing_ref", "") or "N/A"
            description = f.get("description", "") or "No description provided."
            issue_type = f.get("issue_type", "") or "N/A"
            code_clause = f.get("code_clause", "") or ""

            store.issues[issue_id] = {
                "id": issue_id,
                "project_id": project_id,
                "drawing_ref": drawing_ref,
                "location": f.get("location", "") or "N/A",
                "issue_type": issue_type,
                "severity": severity,
                "description": description,
                "suggested_fix": f.get("suggested_fix", "") or "Review and address manually.",
                "code_clause": code_clause,
                "agent_source": f.get("agent_source", "") or "unknown",
                "status": "Open",
                "created_at": store.now_iso(),
                "file_id": first_file_id,
            }

            # Auto-generate NCR for ALL findings (Non-Conformance Report)
            ncr_id = store.gen_id()
            store.ncrs[ncr_id] = {
                "id": ncr_id,
                "issue_id": issue_id,
                "project_id": project_id,
                "drawing_ref": drawing_ref,
                "description": description,
                "code_clause": code_clause,
                "severity": severity,
                "created_at": store.now_iso(),
            }
            store.issues[issue_id]["status"] = "Accepted"

            # Also auto-generate RFI for Minor findings (needs clarification)
            if severity == "Minor":
                rfi_id = store.gen_id()
                store.rfis[rfi_id] = {
                    "id": rfi_id,
                    "issue_id": issue_id,
                    "project_id": project_id,
                    "drawing_ref": drawing_ref,
                    "question": f"Clarification needed: {issue_type} — {description[:200]}",
                    "description": description,
                    "created_at": store.now_iso(),
                }
                store.issues[issue_id]["status"] = "Escalated"

        store.project_reviews[project_id]["status"] = "Complete"
        store.project_reviews[project_id]["finding_count"] = len(merged)
        store.project_reviews[project_id]["summary"] = summary
        store.review_progress[project_id]["overall"] = {"stage": "complete", "progress": 100}

        print(f"\n{'='*60}")
        print(f"[REVIEW] === REVIEW COMPLETE for project {project_id}: {len(merged)} findings ===")
        print(f"{'='*60}")
        logger.info("[REVIEW] Review COMPLETE for project %s: %d findings stored", project_id, len(merged))

        # Clean up page images to free memory
        _project_page_images.pop(project_id, None)

    except Exception as exc:
        print(f"\n{'!'*60}")
        print(f"[REVIEW] !!! REVIEW FAILED for project {project_id}: {exc}")
        print(f"{'!'*60}")
        logger.error("[REVIEW] REVIEW FAILED for project %s: %s", project_id, exc, exc_info=True)
        traceback.print_exc()
        store.project_reviews[project_id]["status"] = "Failed"
        store.project_reviews[project_id]["error"] = str(exc)
        store.review_progress.get(project_id, {})["overall"] = {"stage": "failed", "progress": 0}


@router.post("/{project_id}/review")
async def trigger_review(
    project_id: str,
    _: dict = Depends(get_current_user),
):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")

    store.project_reviews[project_id] = {
        "status": "Pending",
        "started_at": store.now_iso(),
        "finding_count": 0,
    }
    store.review_progress[project_id] = {}

    print(f"[REVIEW] Trigger review for project {project_id}, chunks={len(store.project_chunks.get(project_id, []))}")

    # Launch async review as a background coroutine
    asyncio.create_task(_run_review_async(project_id))
    return {"message": "Review started", "status": "Pending"}


# ── SSE Streaming Endpoint ───────────────────────────────────────────────────

@router.get("/{project_id}/review/stream")
async def review_stream(project_id: str, request: Request):
    """Server-Sent Events endpoint for live review progress updates."""
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")

    async def event_generator():
        last_data = None
        while True:
            # Check if client disconnected
            if await request.is_disconnected():
                break

            progress = store.review_progress.get(project_id, {})
            review = store.project_reviews.get(project_id, {})

            data = {
                "status": review.get("status", "Pending"),
                "agents": {},
                "finding_count": review.get("finding_count", 0),
                "overall": progress.get("overall", {"stage": "waiting", "progress": 0}),
            }

            # Add per-agent progress
            for agent in ["ocr", "groq", "vision", "openai", "summary"]:
                if agent in progress:
                    data["agents"][agent] = progress[agent]

            # Include summary if complete
            if review.get("summary"):
                data["summary"] = review["summary"]

            # Only send if data changed
            data_json = json.dumps(data)
            if data_json != last_data:
                yield f"data: {data_json}\n\n"
                last_data = data_json

            # Stop streaming when review is done
            if review.get("status") in ("Complete", "Failed"):
                # Send one final event
                yield f"data: {data_json}\n\n"
                break

            await asyncio.sleep(1)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{project_id}/review/status")
def review_status(project_id: str, _: dict = Depends(get_current_user)):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    review = store.project_reviews.get(project_id, {"status": "Pending"})
    progress = store.review_progress.get(project_id, {})
    return {**review, "progress": progress}


@router.get("/{project_id}/issues")
def get_issues(project_id: str, _: dict = Depends(get_current_user)):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return store.get_project_issues(project_id)


@router.get("/{project_id}/ncrs")
def get_ncrs(project_id: str, _: dict = Depends(get_current_user)):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return store.get_project_ncrs(project_id)


@router.get("/{project_id}/rfis")
def get_rfis(project_id: str, _: dict = Depends(get_current_user)):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return store.get_project_rfis(project_id)



@router.get("/{project_id}/report/docx")
def export_report_docx(project_id: str, user: dict = Depends(get_current_user)):
    """Generate and download a professional Word document report."""
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    project = store.projects[project_id]
    issues = store.get_project_issues(project_id)
    ncrs = store.get_project_ncrs(project_id)
    rfis = store.get_project_rfis(project_id)
    review = store.project_reviews.get(project_id, {})
    summary = review.get("summary")
    audit_logs = store.get_project_audit_logs(project_id)

    # Gather version history for each issue
    version_data = {}
    for iss in issues:
        versions = store.get_issue_versions(iss["id"])
        if versions:
            version_data[iss["id"]] = versions

    docx_bytes = generate_issue_report_docx(
        project_name=project["name"],
        project_description=project.get("description", ""),
        building_codes=project.get("building_codes", []),
        issues=issues,
        ncrs=ncrs,
        rfis=rfis,
        summary=summary,
        audit_logs=audit_logs,
        version_data=version_data,
    )

    store.add_audit_log(
        project_id=project_id,
        action="report_exported",
        user_email=user.get("email", ""),
        details="Word (DOCX) report exported",
    )

    return Response(
        content=docx_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{project["name"]}_QA_Report.docx"'},
    )


@router.get("/{project_id}/audit-log")
def get_audit_log(project_id: str, _: dict = Depends(get_current_user)):
    """Return audit log entries for a project."""
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return store.get_project_audit_logs(project_id)


@router.get("/{project_id}/drawing-image")
def get_drawing_image(project_id: str, _: dict = Depends(get_current_user)):
    """Return the URL and metadata of the project's first uploaded drawing file."""
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    files = store.project_files.get(project_id, [])
    if not files:
        raise HTTPException(status_code=404, detail="No files uploaded")
    first_file = files[0]
    return {
        "file_id": first_file["id"],
        "filename": first_file["filename"],
        "url": f"/uploads/{project_id}/{first_file['stored_name']}",
        "type": first_file["type"],
    }


@router.get("/{project_id}/files")
def list_files(project_id: str, _: dict = Depends(get_current_user)):
    if project_id not in store.projects:
        raise HTTPException(status_code=404, detail="Project not found")
    return store.project_files.get(project_id, [])


@router.get("/{project_id}/files/{file_id}/url")
def get_file_url(project_id: str, file_id: str, _: dict = Depends(get_current_user)):
    """Return the file path for serving. In production, this would be a signed URL."""
    files = store.project_files.get(project_id, [])
    for f in files:
        if f["id"] == file_id:
            return {"url": f"/uploads/{project_id}/{f['stored_name']}"}
    raise HTTPException(status_code=404, detail="File not found")
