"""Issues router: update status, create NCR, create RFI, apply fix, image upload, versioning."""

from __future__ import annotations

import os
import shutil
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse

from models import IssueUpdate, IssueStatus
from routers.auth import get_current_user
import store

router = APIRouter(prefix="/issues", tags=["Issues"])

ISSUE_IMAGES_DIR = Path("uploads/issue_images")
ISSUE_IMAGES_DIR.mkdir(parents=True, exist_ok=True)


def _get_user_email(user: dict) -> str:
    return user.get("email", "unknown")


@router.patch("/{issue_id}")
def update_issue(
    issue_id: str,
    body: IssueUpdate,
    user: dict = Depends(get_current_user),
):
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    old_status = store.issues[issue_id]["status"]
    new_status = body.status.value
    store.issues[issue_id]["status"] = new_status

    # Track version
    store.add_version_entry(
        issue_id=issue_id,
        field_changed="status",
        old_value=old_status,
        new_value=new_status,
        user_email=_get_user_email(user),
    )

    # Audit log
    project_id = store.issues[issue_id].get("project_id", "")
    store.add_audit_log(
        project_id=project_id,
        action="status_change",
        user_email=_get_user_email(user),
        issue_id=issue_id,
        details=f"Status changed from '{old_status}' to '{new_status}'",
    )

    return store.issues[issue_id]


@router.post("/{issue_id}/ncr")
def create_ncr(issue_id: str, user: dict = Depends(get_current_user)):
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = store.issues[issue_id]
    old_status = issue["status"]
    if issue["status"] != IssueStatus.ACCEPTED.value:
        issue["status"] = IssueStatus.ACCEPTED.value
        store.add_version_entry(issue_id, "status", old_status, IssueStatus.ACCEPTED.value, _get_user_email(user))

    ncr_id = store.gen_id()
    ncr = {
        "id": ncr_id,
        "issue_id": issue_id,
        "project_id": issue["project_id"],
        "drawing_ref": issue["drawing_ref"],
        "description": issue["description"],
        "code_clause": issue.get("code_clause", ""),
        "severity": issue["severity"],
        "created_at": store.now_iso(),
    }
    store.ncrs[ncr_id] = ncr

    store.add_audit_log(
        project_id=issue["project_id"],
        action="ncr_created",
        user_email=_get_user_email(user),
        issue_id=issue_id,
        details=f"NCR {ncr_id} created for issue {issue_id}",
    )

    return ncr


@router.post("/{issue_id}/rfi")
def create_rfi(issue_id: str, user: dict = Depends(get_current_user)):
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = store.issues[issue_id]
    rfi_id = store.gen_id()
    rfi = {
        "id": rfi_id,
        "issue_id": issue_id,
        "project_id": issue["project_id"],
        "drawing_ref": issue["drawing_ref"],
        "question": f"Clarification needed: {issue['issue_type']} — {issue['description'][:200]}",
        "description": issue["description"],
        "created_at": store.now_iso(),
    }
    store.rfis[rfi_id] = rfi

    old_status = issue["status"]
    issue["status"] = IssueStatus.ESCALATED.value
    store.add_version_entry(issue_id, "status", old_status, IssueStatus.ESCALATED.value, _get_user_email(user))

    store.add_audit_log(
        project_id=issue["project_id"],
        action="rfi_created",
        user_email=_get_user_email(user),
        issue_id=issue_id,
        details=f"RFI {rfi_id} created for issue {issue_id}",
    )

    return rfi


@router.post("/{issue_id}/apply-fix")
def apply_fix(issue_id: str, user: dict = Depends(get_current_user)):
    """Auto-apply fix: updates status to Fixed with audit trail."""
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    issue = store.issues[issue_id]
    old_status = issue["status"]
    issue["status"] = IssueStatus.FIXED.value

    store.add_version_entry(
        issue_id=issue_id,
        field_changed="status",
        old_value=old_status,
        new_value=IssueStatus.FIXED.value,
        user_email=_get_user_email(user),
    )

    store.add_audit_log(
        project_id=issue["project_id"],
        action="fix_applied",
        user_email=_get_user_email(user),
        issue_id=issue_id,
        details=f"Auto-fix applied. Suggested fix: {issue.get('suggested_fix', 'N/A')[:200]}",
    )

    return {"message": "Fix applied successfully", "issue": issue}


@router.post("/{issue_id}/image")
async def upload_issue_image(
    issue_id: str,
    file: UploadFile = File(...),
    annotation_x: float = Form(0),
    annotation_y: float = Form(0),
    annotation_radius: float = Form(30),
    user: dict = Depends(get_current_user),
):
    """Upload an image for an issue with optional circle annotation data."""
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    ext = Path(file.filename or "image.png").suffix.lower()
    if ext not in (".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp"):
        raise HTTPException(status_code=400, detail="Invalid image format")

    file_name = f"{issue_id}_{uuid.uuid4().hex[:6]}{ext}"
    dest = ISSUE_IMAGES_DIR / file_name

    with open(dest, "wb") as buf:
        shutil.copyfileobj(file.file, buf)

    store.issue_images[issue_id] = {
        "filename": file_name,
        "path": str(dest),
        "annotation": {
            "x": annotation_x,
            "y": annotation_y,
            "radius": annotation_radius,
        },
        "uploaded_at": store.now_iso(),
    }

    store.add_audit_log(
        project_id=store.issues[issue_id]["project_id"],
        action="image_uploaded",
        user_email=_get_user_email(user),
        issue_id=issue_id,
        details=f"Image '{file.filename}' uploaded with annotation at ({annotation_x}, {annotation_y})",
    )

    return {"message": "Image uploaded", "image": store.issue_images[issue_id]}


@router.get("/{issue_id}/image")
def get_issue_image(issue_id: str, _: dict = Depends(get_current_user)):
    """Return issue image metadata and serve the file."""
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    img_data = store.issue_images.get(issue_id)
    if not img_data:
        raise HTTPException(status_code=404, detail="No image uploaded for this issue")

    return img_data


@router.get("/{issue_id}/image/file")
def get_issue_image_file(issue_id: str, _: dict = Depends(get_current_user)):
    """Serve the actual image file."""
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")

    img_data = store.issue_images.get(issue_id)
    if not img_data or not os.path.exists(img_data["path"]):
        raise HTTPException(status_code=404, detail="No image found")

    return FileResponse(img_data["path"])


@router.get("/{issue_id}/versions")
def get_versions(issue_id: str, _: dict = Depends(get_current_user)):
    if issue_id not in store.issues:
        raise HTTPException(status_code=404, detail="Issue not found")
    return store.get_issue_versions(issue_id)
