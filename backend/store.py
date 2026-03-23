"""In-memory data store — swap to PostgreSQL later."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

import bcrypt


def _hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


# ── Seed Data ────────────────────────────────────────────────────────────────

_DEFAULT_PASSWORD = _hash_password("admin123")

users: dict[str, dict[str, Any]] = {
    "u1": {
        "id": "u1",
        "email": "admin@constructai.com",
        "name": "Admin User",
        "role": "admin",
        "hashed_password": _DEFAULT_PASSWORD,
    }
}

projects: dict[str, dict[str, Any]] = {}
project_files: dict[str, list[dict[str, Any]]] = {}      # project_id → file metadata list
project_chunks: dict[str, list[dict[str, str]]] = {}      # project_id → text chunk list
project_reviews: dict[str, dict[str, Any]] = {}            # project_id → review job
project_settings: dict[str, dict[str, Any]] = {}           # project_id → settings

issues: dict[str, dict[str, Any]] = {}                     # issue_id → issue
ncrs: dict[str, dict[str, Any]] = {}                       # ncr_id → NCR
rfis: dict[str, dict[str, Any]] = {}                       # rfi_id → RFI
review_progress: dict[str, dict[str, Any]] = {}            # project_id → per-agent progress
audit_logs: dict[str, list[dict[str, Any]]] = {}            # project_id → list of audit log entries
issue_versions: dict[str, list[dict[str, Any]]] = {}        # issue_id → list of version snapshots
issue_images: dict[str, dict[str, Any]] = {}                # issue_id → image metadata


# ── Helpers ──────────────────────────────────────────────────────────────────

def gen_id() -> str:
    return uuid.uuid4().hex[:12]


def now_iso() -> str:
    return datetime.utcnow().isoformat()


def find_user_by_email(email: str) -> dict[str, Any] | None:
    for u in users.values():
        if u["email"] == email:
            return u
    return None


def get_project_issues(project_id: str) -> list[dict[str, Any]]:
    return [i for i in issues.values() if i.get("project_id") == project_id]


def get_project_ncrs(project_id: str) -> list[dict[str, Any]]:
    return [n for n in ncrs.values() if n.get("project_id") == project_id]


def get_project_rfis(project_id: str) -> list[dict[str, Any]]:
    return [r for r in rfis.values() if r.get("project_id") == project_id]


def compute_health_score(project_id: str) -> float:
    """Simple health score: 100 minus weighted issue penalties."""
    proj_issues = get_project_issues(project_id)
    if not proj_issues:
        return 100.0
    penalty = 0.0
    for iss in proj_issues:
        sev = iss.get("severity", "Minor")
        if sev == "Critical":
            penalty += 10
        elif sev == "Major":
            penalty += 5
        else:
            penalty += 1
    return max(0.0, round(100.0 - penalty, 1))


def add_audit_log(
    project_id: str,
    action: str,
    user_email: str = "",
    issue_id: str = "",
    details: str = "",
) -> dict[str, Any]:
    entry = {
        "id": gen_id(),
        "project_id": project_id,
        "issue_id": issue_id,
        "action": action,
        "user_email": user_email,
        "details": details,
        "timestamp": now_iso(),
    }
    audit_logs.setdefault(project_id, []).append(entry)
    return entry


def add_version_entry(
    issue_id: str,
    field_changed: str,
    old_value: str,
    new_value: str,
    user_email: str = "",
) -> dict[str, Any]:
    versions = issue_versions.setdefault(issue_id, [])
    version_num = len(versions) + 1
    entry = {
        "version": version_num,
        "timestamp": now_iso(),
        "field_changed": field_changed,
        "old_value": old_value,
        "new_value": new_value,
        "user_email": user_email,
    }
    versions.append(entry)
    return entry


def get_issue_versions(issue_id: str) -> list[dict[str, Any]]:
    return issue_versions.get(issue_id, [])


def get_project_audit_logs(project_id: str) -> list[dict[str, Any]]:
    return audit_logs.get(project_id, [])
