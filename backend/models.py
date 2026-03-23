"""Pydantic schemas for all request/response models."""

from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, EmailStr, Field


# ── Enums ────────────────────────────────────────────────────────────────────

class Severity(str, Enum):
    CRITICAL = "Critical"
    MAJOR = "Major"
    MINOR = "Minor"


class IssueStatus(str, Enum):
    OPEN = "Open"
    ACCEPTED = "Accepted"
    REJECTED = "Rejected"
    ESCALATED = "Escalated"
    FIXED = "Fixed"


class ReviewStatus(str, Enum):
    PENDING = "Pending"
    IN_PROGRESS = "In Progress"
    COMPLETE = "Complete"
    FAILED = "Failed"


# ── Auth ─────────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: str
    email: str
    name: str
    role: str


# ── Projects ─────────────────────────────────────────────────────────────────

class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    building_codes: list[str] = Field(default_factory=list)


class ProjectOut(BaseModel):
    id: str
    name: str
    description: str
    building_codes: list[str]
    created_at: str
    file_count: int = 0
    issue_count: int = 0
    health_score: float = 100.0
    review_status: ReviewStatus = ReviewStatus.PENDING


# ── Findings / Issues ────────────────────────────────────────────────────────

class Finding(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    drawing_ref: str = ""
    location: str = ""
    issue_type: str = ""
    severity: Severity = Severity.MINOR
    description: str = ""
    suggested_fix: str = ""
    code_clause: str = ""
    agent_source: str = ""  # "groq" or "openai"
    status: IssueStatus = IssueStatus.OPEN
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class IssueUpdate(BaseModel):
    status: IssueStatus


# ── NCR / RFI ────────────────────────────────────────────────────────────────

class NCROut(BaseModel):
    id: str
    issue_id: str
    project_id: str
    drawing_ref: str
    description: str
    code_clause: str
    severity: Severity
    created_at: str


class RFIOut(BaseModel):
    id: str
    issue_id: str
    project_id: str
    drawing_ref: str
    question: str
    description: str
    created_at: str


# ── Versioning & Audit ───────────────────────────────────────────────────────

class VersionEntry(BaseModel):
    version: int
    timestamp: str
    field_changed: str
    old_value: str
    new_value: str
    user_email: str = ""


class AuditLogEntry(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:12])
    project_id: str = ""
    issue_id: str = ""
    action: str = ""  # e.g. "status_change", "ncr_created", "rfi_created", "fix_applied", "report_exported"
    user_email: str = ""
    details: str = ""
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


# ── Spec Generation ──────────────────────────────────────────────────────────

class SpecRequest(BaseModel):
    project_id: str
    discipline: str  # e.g. "Structural Concrete", "MEP Electrical"


# ── Word / Excel Review ─────────────────────────────────────────────────────

class WordReviewRequest(BaseModel):
    text: str
    project_id: Optional[str] = None


class ExcelReviewRequest(BaseModel):
    data: list[list[str]]
    sheet_name: str = "Sheet1"
    project_id: Optional[str] = None


class ITPGenerateRequest(BaseModel):
    project_id: str
    discipline: str


# ── Settings ─────────────────────────────────────────────────────────────────

class ChecklistRule(BaseModel):
    id: str = Field(default_factory=lambda: uuid.uuid4().hex[:8])
    category: str
    description: str
    severity: Severity = Severity.MAJOR


class ProjectSettings(BaseModel):
    building_codes: list[str] = Field(default_factory=list)
    checklist_rules: list[ChecklistRule] = Field(default_factory=list)
